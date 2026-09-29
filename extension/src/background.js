import {
  DEVICES, resolveDevice, getBrowserVersion, buildProfile, buildHeaders, orientedSize
} from './devices.js';
import { mobileSpoof } from './spoof.js';

// ---------------------------------------------------------------------------
// Settings & state
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  deviceId: 'iphone-16-pro',
  mode: 'full',          // 'full' = chrome.debugger (DevTools device mode), 'lite' = headers + JS
  landscape: false,
  zoom: 'fit',           // 'fit' or a number as string ('0.5', '1', ...) - full mode only
  inherit: true,         // tabs opened from an emulated tab are emulated too
  liteWindow: true,      // lite mode: move the tab into a phone-sized window
  custom: { os: 'android', width: 390, height: 844, dpr: 3, tablet: false, userAgent: '' }
};

const RESOURCE_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];

let tabsCache = null; // { [tabId]: cfg }
let versionPromise = null;

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}), custom: { ...DEFAULT_SETTINGS.custom, ...(settings?.custom || {}) } };
}

async function saveSettings(settings) {
  const merged = { ...(await getSettings()), ...settings };
  await chrome.storage.local.set({ settings: merged });
  return merged;
}

async function loadTabs() {
  if (!tabsCache) {
    const { tabs } = await chrome.storage.session.get('tabs');
    tabsCache = tabs || {};
  }
  return tabsCache;
}

async function setTabState(tabId, cfg) {
  const tabs = await loadTabs();
  if (cfg) tabs[tabId] = cfg; else delete tabs[tabId];
  await chrome.storage.session.set({ tabs });
}

async function getTabState(tabId) {
  return (await loadTabs())[tabId] || null;
}

function version() {
  if (!versionPromise) versionPromise = getBrowserVersion();
  return versionPromise;
}

async function profileFor(cfg) {
  const device = resolveDevice(cfg);
  const profile = buildProfile(device, await version());
  const { width, height } = orientedSize(device, cfg.landscape);
  return { device, profile, width, height };
}

function pageConfig(cfg, device, profile, width, height, lite) {
  return {
    lite,
    userAgent: profile.userAgent,
    appVersion: profile.appVersion,
    platform: profile.platform,
    vendor: profile.vendor,
    ios: profile.ios,
    metadata: profile.metadata,
    width, height, dpr: device.dpr,
    landscape: !!cfg.landscape
  };
}

// Per-tab operation queue, so fast clicks don't interleave attach/detach.
const queues = new Map();
function queued(tabId, fn) {
  const prev = queues.get(tabId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(tabId, next.finally(() => { if (queues.get(tabId) === next) queues.delete(tabId); }));
  return next;
}

// ---------------------------------------------------------------------------
// Restricted pages
// ---------------------------------------------------------------------------

export function isRestrictedUrl(url) {
  if (!url) return false;
  return /^(chrome|chrome-extension|chrome-untrusted|devtools|edge|brave|opera|vivaldi|about|view-source|chrome-search):/i.test(url)
    && !/^about:blank/i.test(url)
    || /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url);
}

// ---------------------------------------------------------------------------
// Full mode: chrome.debugger + Chrome DevTools Protocol
// ---------------------------------------------------------------------------

function cdp(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function isAttached(tabId) {
  const targets = await chrome.debugger.getTargets();
  return targets.some(t => t.tabId === tabId && t.attached);
}

async function ensureAttached(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    if (!/already attached/i.test(e.message || '')) throw e;
  }
}

async function computeScale(tabId, zoom, width, height) {
  if (zoom !== 'fit') {
    const z = parseFloat(zoom);
    return Number.isFinite(z) && z > 0 ? z : 1;
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.width || !tab.height) return 1;
    const s = Math.min(tab.width / width, (tab.height - 8) / height);
    return Math.max(0.25, Math.min(1, Math.round(s * 100) / 100));
  } catch (_) {
    return 1;
  }
}

async function applyMetrics(tabId, cfg, device, width, height) {
  const scale = await computeScale(tabId, cfg.zoom, width, height);
  await cdp(tabId, 'Emulation.setDeviceMetricsOverride', {
    width, height,
    deviceScaleFactor: device.dpr,
    mobile: true,
    scale,
    screenWidth: width,
    screenHeight: height,
    screenOrientation: cfg.landscape
      ? { type: 'landscapePrimary', angle: 90 }
      : { type: 'portraitPrimary', angle: 0 }
  });
}

async function applyFull(tabId, cfg) {
  const { device, profile, width, height } = await profileFor(cfg);
  await ensureAttached(tabId);

  await applyMetrics(tabId, cfg, device, width, height);
  await cdp(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    await cdp(tabId, 'Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  } catch (_) { /* experimental, optional */ }

  const ua = { userAgent: profile.userAgent, platform: profile.platform };
  if (profile.metadata) ua.userAgentMetadata = profile.metadata;
  await cdp(tabId, 'Emulation.setUserAgentOverride', ua);

  // Small extras CDP doesn't cover (navigator.vendor, no UA-CH on iOS).
  if (cfg.scriptId) {
    try { await cdp(tabId, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: cfg.scriptId }); } catch (_) { /* ignore */ }
  }
  const source = `(${mobileSpoof.toString()})(${JSON.stringify(pageConfig(cfg, device, profile, width, height, false))});`;
  const { identifier } = await cdp(tabId, 'Page.addScriptToEvaluateOnNewDocument', { source });
  return { scriptId: identifier };
}

async function disableFull(tabId) {
  try { await chrome.debugger.detach({ tabId }); } catch (_) { /* already detached */ }
}

// ---------------------------------------------------------------------------
// Lite mode: declarativeNetRequest headers + MAIN-world script + small window
// ---------------------------------------------------------------------------

async function applyLite(tabId, cfg, { moveWindow = true } = {}) {
  const { profile, width, height } = await profileFor(cfg);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [{
      id: tabId,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: buildHeaders(profile) },
      condition: { tabIds: [tabId], resourceTypes: RESOURCE_TYPES }
    }]
  });

  const extra = {};
  if (cfg.liteWindow && moveWindow) {
    try {
      Object.assign(extra, await placeInPhoneWindow(tabId, cfg, width, height));
    } catch (e) {
      console.warn('Mobile Emulator: could not create phone window', e);
    }
  }
  return extra;
}

async function placeInPhoneWindow(tabId, cfg, width, height) {
  const tab = await chrome.tabs.get(tabId);
  const current = await chrome.windows.get(tab.windowId);
  let windowId = tab.windowId;
  const originWindowId = cfg.originWindowId ?? (current.type === 'normal' ? current.id : undefined);

  if (current.type !== 'popup') {
    const win = await chrome.windows.create({ tabId, type: 'popup', width: width + 16, height: height + 60, focused: true });
    windowId = win.id;
  }
  await fitWindowToViewport(windowId, tabId, width, height);
  return { phoneWindowId: windowId, originWindowId };
}

async function fitWindowToViewport(windowId, tabId, width, height) {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 120));
    const [win, tab] = await Promise.all([chrome.windows.get(windowId), chrome.tabs.get(tabId)]);
    if (!tab.width || !tab.height) continue;
    const dw = width - tab.width;
    const dh = height - tab.height;
    if (Math.abs(dw) <= 1 && Math.abs(dh) <= 1) return;
    await chrome.windows.update(windowId, { width: win.width + dw, height: win.height + dh });
  }
}

async function disableLite(tabId, cfg) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
  if (!cfg?.phoneWindowId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId !== cfg.phoneWindowId) return;
    let target = null;
    if (cfg.originWindowId != null) {
      try { target = await chrome.windows.get(cfg.originWindowId); } catch (_) { target = null; }
    }
    // Tabs can't be moved out of popup windows, so reopen the page in a normal window.
    if (target) {
      await chrome.tabs.create({ windowId: target.id, url: tab.url, active: true });
      await chrome.windows.update(target.id, { focused: true });
    } else {
      await chrome.windows.create({ url: tab.url, type: 'normal', focused: true });
    }
    await chrome.tabs.remove(tabId);
    return { closed: true };
  } catch (_) { /* tab gone */ }
}

async function injectLite(tabId, frameId, cfg) {
  const { device, profile, width, height } = await profileFor(cfg);
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      injectImmediately: true,
      func: mobileSpoof,
      args: [pageConfig(cfg, device, profile, width, height, true)]
    });
  } catch (_) { /* restricted frame, ignore */ }
}

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId }) => {
  const cfg = await getTabState(tabId);
  if (cfg?.mode === 'lite') await injectLite(tabId, frameId, cfg);
});

// ---------------------------------------------------------------------------
// Enable / disable
// ---------------------------------------------------------------------------

function snapshot(settings) {
  const { deviceId, mode, landscape, zoom, liteWindow, custom } = settings;
  return { deviceId, mode, landscape, zoom, liteWindow, custom: { ...custom } };
}

async function enableTab(tabId, cfg, { reload = true, moveWindow = true } = {}) {
  const tab = await chrome.tabs.get(tabId);
  if (isRestrictedUrl(tab.url || tab.pendingUrl)) {
    throw new Error('Tej strony nie można emulować (strona wewnętrzna Chrome lub Chrome Web Store).');
  }
  let extra;
  if (cfg.mode === 'lite') {
    // Store state first so the navigation listener injects on the reload.
    await setTabState(tabId, cfg);
    extra = await applyLite(tabId, cfg, { moveWindow });
  } else {
    await setTabState(tabId, cfg);
    try {
      extra = await applyFull(tabId, cfg);
    } catch (e) {
      await setTabState(tabId, null);
      await disableFull(tabId);
      throw e;
    }
  }
  const state = { ...cfg, ...extra };
  await setTabState(tabId, state);
  await updateBadge(tabId);
  if (reload) await chrome.tabs.reload(tabId, { bypassCache: true });
  return state;
}

async function disableTab(tabId, { reload = true } = {}) {
  const cfg = await getTabState(tabId);
  await setTabState(tabId, null);
  let result;
  if (cfg?.mode === 'lite') result = await disableLite(tabId, cfg);
  else await disableFull(tabId);
  if (result?.closed) return;
  await updateBadge(tabId);
  if (reload) {
    try { await chrome.tabs.reload(tabId, { bypassCache: true }); } catch (_) { /* tab gone */ }
  }
}

async function toggleTab(tabId) {
  return queued(tabId, async () => {
    if (await getTabState(tabId)) {
      await disableTab(tabId);
      return null;
    }
    return enableTab(tabId, snapshot(await getSettings()));
  });
}

// Re-apply after the user changed settings while the tab is emulated.
async function reapplyTab(tabId, settings) {
  return queued(tabId, async () => {
    const old = await getTabState(tabId);
    if (!old) return null;
    const cfg = snapshot(settings);
    const uaChanged = old.deviceId !== cfg.deviceId || old.mode !== cfg.mode
      || JSON.stringify(old.custom) !== JSON.stringify(cfg.custom);

    if (old.mode !== cfg.mode) {
      await disableTab(tabId, { reload: false });
      try { await chrome.tabs.get(tabId); } catch (_) { return null; }
      return enableTab(tabId, cfg);
    }
    if (cfg.mode === 'full') {
      const state = { ...cfg, ...(await applyFull(tabId, { ...cfg, scriptId: old.scriptId })) };
      await setTabState(tabId, state);
      if (uaChanged) await chrome.tabs.reload(tabId, { bypassCache: true });
      return state;
    }
    // lite
    const keep = { phoneWindowId: old.phoneWindowId, originWindowId: old.originWindowId };
    await setTabState(tabId, { ...cfg, ...keep });
    const extra = await applyLite(tabId, { ...cfg, ...keep });
    const state = { ...cfg, ...keep, ...extra };
    await setTabState(tabId, state);
    await chrome.tabs.reload(tabId, { bypassCache: true });
    return state;
  });
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

async function updateBadge(tabId) {
  const cfg = await getTabState(tabId);
  try {
    if (cfg) {
      const device = resolveDevice(cfg);
      await chrome.action.setBadgeText({ tabId, text: cfg.mode === 'lite' ? 'LITE' : 'ON' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: cfg.mode === 'lite' ? '#f59e0b' : '#16a34a' });
      await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
      await chrome.action.setTitle({ tabId, title: `Mobile Emulator: WŁĄCZONY (${device.name})` });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await chrome.action.setTitle({ tabId, title: 'Mobile Emulator: wyłączony' });
    }
  } catch (_) { /* tab closed */ }
}

// ---------------------------------------------------------------------------
// Browser events
// ---------------------------------------------------------------------------

chrome.debugger.onDetach.addListener(async (source, reason) => {
  const tabs = await loadTabs();
  if (reason === 'canceled_by_user') {
    // The user pressed "Cancel" on the debugging infobar - Chrome detaches every session.
    for (const [id, cfg] of Object.entries(tabs)) {
      if (cfg.mode === 'full') {
        await setTabState(Number(id), null);
        await updateBadge(Number(id));
      }
    }
    return;
  }
  if (source.tabId != null && tabs[source.tabId]?.mode === 'full') {
    await setTabState(source.tabId, null);
    await updateBadge(source.tabId);
  }
});

chrome.tabs.onRemoved.addListener(async tabId => {
  if (await getTabState(tabId)) {
    await setTabState(tabId, null);
    try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }); } catch (_) { /* ignore */ }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === 'loading' && await getTabState(tabId)) await updateBadge(tabId);
});

// Tabs/popups opened from an emulated tab inherit emulation.
chrome.tabs.onCreated.addListener(async tab => {
  if (tab.openerTabId == null) return;
  const parent = await getTabState(tab.openerTabId);
  if (!parent) return;
  const settings = await getSettings();
  if (!settings.inherit) return;
  const cfg = { ...snapshot(parent), liteWindow: false };
  queued(tab.id, async () => {
    try {
      // Give the new tab a moment to receive its URL.
      await new Promise(r => setTimeout(r, 50));
      await enableTab(tab.id, cfg, { reload: cfg.mode === 'full', moveWindow: false });
    } catch (_) { /* restricted or closed */ }
  });
});

// Keep "fit" zoom right when the window is resized.
chrome.windows.onBoundsChanged?.addListener(async win => {
  const tabs = await loadTabs();
  for (const [id, cfg] of Object.entries(tabs)) {
    if (cfg.mode !== 'full' || cfg.zoom !== 'fit') continue;
    const tabId = Number(id);
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId !== win.id) continue;
      const { device, width, height } = await profileFor(cfg);
      await applyMetrics(tabId, cfg, device, width, height);
    } catch (_) { /* ignore */ }
  }
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-emulation') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null) {
    try { await toggleTab(tab.id); } catch (e) { console.warn('Mobile Emulator:', e.message); }
  }
});

// ---------------------------------------------------------------------------
// Popup messaging
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(
    result => sendResponse({ ok: true, ...result }),
    err => sendResponse({ ok: false, error: err?.message || String(err) })
  );
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'getState': {
      const settings = await getSettings();
      let tab = null;
      try { tab = await chrome.tabs.get(msg.tabId); } catch (_) { /* none */ }
      return {
        settings,
        devices: DEVICES,
        tabState: tab ? await getTabState(tab.id) : null,
        restricted: tab ? isRestrictedUrl(tab.url || tab.pendingUrl) : true
      };
    }
    case 'toggle': {
      const tabState = await toggleTab(msg.tabId);
      return { tabState };
    }
    case 'saveSettings': {
      const settings = await saveSettings(msg.settings);
      let tabState = null;
      if (msg.tabId != null && await getTabState(msg.tabId)) tabState = await reapplyTab(msg.tabId, settings);
      return { settings, tabState };
    }
    default:
      throw new Error(`Unknown message: ${msg.type}`);
  }
}

// ---------------------------------------------------------------------------
// Service worker (re)start: restore emulation that was active before the
// worker was suspended.
// ---------------------------------------------------------------------------

async function restore() {
  const tabs = await loadTabs();
  for (const [id, cfg] of Object.entries(tabs)) {
    const tabId = Number(id);
    try {
      await chrome.tabs.get(tabId);
    } catch (_) {
      await setTabState(tabId, null);
      continue;
    }
    if (cfg.mode === 'full' && !(await isAttached(tabId))) {
      try {
        const extra = await applyFull(tabId, cfg);
        await setTabState(tabId, { ...cfg, ...extra });
      } catch (_) {
        await setTabState(tabId, null);
      }
    }
    await updateBadge(tabId);
  }
}

restore();
