import {
  DEVICES, resolveDevice, getBrowserVersion, buildProfile, buildHeaders, orientedSize
} from './devices.js';
import './spoof.js';

const mobileSpoof = globalThis.__mobileEmuSpoof;

// ---------------------------------------------------------------------------
// Settings & state
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  deviceId: 'pixel-9',
  mode: 'full',          // 'full' = chrome.debugger (DevTools device mode), 'lite' = headers + JS
  landscape: false,
  viewport: 'tab',       // full mode: 'tab' = whole tab, 'stretch' = phone width scaled to tab, 'device' = phone size 1:1
  inherit: true,         // tabs opened from an emulated tab are emulated too
  liteWindow: false,     // lite mode: move the tab into a phone-sized window
  custom: { os: 'android', width: 390, height: 844, dpr: 3, tablet: false, userAgent: '' }
};

const RESOURCE_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];

// Short-lived: the cookie only has to survive until document_start of the
// response it came with (lite-content.js deletes it right away).
const COOKIE_MAX_AGE = 5;

// Lite-mode DNR rule ids handed out but maybe not yet stored in tab state.
const reservedRuleIds = new Set();

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

// Viewport modes:
//  - 'tab':     the page fills the whole tab at its real size (no phone frame);
//               only identity/touch/screen say "mobile".
//  - 'stretch': phone layout width, scaled up so it fills the tab width.
//  - 'device':  exact phone viewport (1:1) in the top-left corner.
async function viewportMetrics(tabId, cfg, device, width, height) {
  if (cfg.viewport === 'device') return { width, height, deviceScaleFactor: device.dpr, scale: 1 };
  if (cfg.viewport === 'stretch') {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.width && tab.height) {
        const scale = Math.round((tab.width / width) * 1000) / 1000;
        return { width, height: Math.max(100, Math.floor(tab.height / scale)), deviceScaleFactor: device.dpr, scale };
      }
    } catch (_) { /* fall through */ }
    return { width, height, deviceScaleFactor: device.dpr, scale: 1 };
  }
  // 0 = keep the tab's own size and pixel ratio. mobile:false avoids mobile
  // text autosizing and meta-viewport zooming, so the page renders like a
  // normal tab while identity, touch and screen still report a phone.
  return { width: 0, height: 0, deviceScaleFactor: 0, scale: 1, mobile: false };
}

async function applyMetrics(tabId, cfg, device, width, height) {
  const vp = await viewportMetrics(tabId, cfg, device, width, height);
  await cdp(tabId, 'Emulation.setDeviceMetricsOverride', {
    mobile: true,
    ...vp,
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
  await cdp(tabId, 'Page.enable');
  const { identifier } = await cdp(tabId, 'Page.addScriptToEvaluateOnNewDocument', { source, runImmediately: true });
  return { scriptId: identifier };
}

async function disableFull(tabId) {
  // Detaching should drop the overrides, but clear them explicitly: the
  // visible size can otherwise stick when another client is attached.
  for (const [method, params] of [
    ['Emulation.clearDeviceMetricsOverride', {}],
    ['Emulation.setTouchEmulationEnabled', { enabled: false }],
    ['Emulation.setEmitTouchEventsForMouse', { enabled: false }]
  ]) {
    try { await cdp(tabId, method, params); } catch (_) { /* not attached */ }
  }
  try { await chrome.debugger.detach({ tabId }); } catch (_) { /* already detached */ }
}

// ---------------------------------------------------------------------------
// Lite mode: declarativeNetRequest headers + MAIN-world script + small window
// ---------------------------------------------------------------------------

async function applyLite(tabId, cfg, { moveWindow = true } = {}) {
  const { device, profile, width, height } = await profileFor(cfg);
  const [reqRuleId, cookieRuleId] = cfg.ruleIds || await allocateRuleIds();
  const marker = encodeURIComponent(JSON.stringify(pageConfig(cfg, device, profile, width, height, true)));
  const headerRule = {
    id: reqRuleId,
    priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: buildHeaders(profile) },
    condition: { tabIds: [tabId], resourceTypes: RESOURCE_TYPES }
  };
  // The device profile rides on each document response of this tab and is
  // read synchronously by lite-content.js at document_start, so the spoof runs
  // before any page script:
  //  - Server-Timing (per response, so it can never leak to other tabs),
  //    readable via performance navigation timing in secure contexts;
  //  - a short-lived cookie as fallback for plain http:// pages, where
  //    serverTiming isn't exposed. The script deletes it right away.
  const cookieRule = {
    id: cookieRuleId,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'server-timing', operation: 'append', value: `mobemu;desc="${marker}"` },
        {
          header: 'set-cookie',
          operation: 'append',
          value: `__mobemu=${marker}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`
        }
      ]
    },
    condition: { tabIds: [tabId], resourceTypes: ['main_frame', 'sub_frame'] }
  };
  const removeRuleIds = [reqRuleId, cookieRuleId];
  try {
    // Chrome 128+: mark only HTML documents (not redirects, downloads, ...),
    // so the cookie doesn't linger where no page script would delete it.
    const htmlOnly = {
      ...cookieRule,
      condition: { ...cookieRule.condition, responseHeaders: [{ header: 'content-type', values: ['text/html*'] }] }
    };
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: [headerRule, htmlOnly] });
  } catch (_) {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: [headerRule, cookieRule] });
    } catch (e) {
      if (!cfg.ruleIds) for (const id of removeRuleIds) reservedRuleIds.delete(id);
      throw e;
    }
  }

  const extra = { ruleIds: [reqRuleId, cookieRuleId] };
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

// Two session rules per lite tab: request headers + marker cookie on documents.
// Ids are reserved synchronously (after the last await), so concurrent
// enables in different tabs can never pick the same ids.
async function allocateRuleIds() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const tabs = await loadTabs();
  const used = new Set([...rules.map(r => r.id), ...reservedRuleIds]);
  for (const cfg of Object.values(tabs)) for (const id of cfg.ruleIds || []) used.add(id);
  const ids = [];
  for (let id = 1; ids.length < 2; id++) if (!used.has(id)) ids.push(id);
  for (const id of ids) reservedRuleIds.add(id);
  return ids;
}

async function removeLiteRules(cfg) {
  if (!cfg?.ruleIds) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: cfg.ruleIds });
  } finally {
    for (const id of cfg.ruleIds) reservedRuleIds.delete(id);
  }
}

async function disableLite(tabId, cfg) {
  await removeLiteRules(cfg);
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
  } catch (e) { console.debug('Mobile Emulator: inject failed', e.message); }
}

// Fallback for documents the marker cookie can't reach (e.g. third-party
// frames with cookies blocked). The spoof is idempotent.
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId }) => {
  const cfg = await getTabState(tabId);
  if (cfg?.mode === 'lite') await injectLite(tabId, frameId, cfg);
});

// ---------------------------------------------------------------------------
// Enable / disable
// ---------------------------------------------------------------------------

async function tabExists(tabId) {
  try { await chrome.tabs.get(tabId); return true; } catch (_) { return false; }
}

function snapshot(settings) {
  const { deviceId, mode, landscape, viewport, liteWindow, custom } = settings;
  return { deviceId, mode, landscape, viewport, liteWindow, custom: { ...custom } };
}

async function enableTab(tabId, cfg, { reload = true, moveWindow = true } = {}) {
  const tab = await chrome.tabs.get(tabId);
  if (isRestrictedUrl(tab.url || tab.pendingUrl)) {
    throw new Error('Tej strony nie można emulować (strona wewnętrzna Chrome lub Chrome Web Store).');
  }
  let extra;
  // Store state first so the navigation listener already sees the tab.
  await setTabState(tabId, cfg);
  try {
    extra = cfg.mode === 'lite' ? await applyLite(tabId, cfg, { moveWindow }) : await applyFull(tabId, cfg);
  } catch (e) {
    await setTabState(tabId, null);
    if (cfg.mode === 'full') await disableFull(tabId);
    await updateBadge(tabId);
    throw e;
  }
  const state = { ...cfg, ...extra };
  if (!(await tabExists(tabId))) {
    // Closed while we were enabling it: don't resurrect its state.
    await setTabState(tabId, null);
    if (cfg.mode === 'lite') await removeLiteRules(state);
    return null;
  }
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
    if (JSON.stringify(snapshot(old)) === JSON.stringify(cfg)) return old;
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
    const keep = { phoneWindowId: old.phoneWindowId, originWindowId: old.originWindowId, ruleIds: old.ruleIds };
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

chrome.tabs.onRemoved.addListener(tabId => {
  queued(tabId, async () => {
    const cfg = await getTabState(tabId);
    if (cfg) {
      await setTabState(tabId, null);
      try { await removeLiteRules(cfg); } catch (_) { /* ignore */ }
    }
  });
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
      const t = await chrome.tabs.get(tab.id);
      const url = t.pendingUrl || t.url || '';
      // The first request may already be on its way without our overrides, so
      // reload real pages. Never reload blank popups the opener writes into
      // (window.open('') + document.write) - that would wipe their content.
      const reload = /^(https?|file):/i.test(url);
      await enableTab(tab.id, cfg, { reload, moveWindow: false });
    } catch (_) { /* restricted or closed */ }
  });
});

// Keep the 'stretch' viewport filling the tab when the window is resized.
chrome.windows.onBoundsChanged?.addListener(async win => {
  const tabs = await loadTabs();
  for (const [id, cfg] of Object.entries(tabs)) {
    if (cfg.mode !== 'full' || cfg.viewport !== 'stretch') continue;
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
    if (!(await tabExists(tabId))) {
      await setTabState(tabId, null);
      try { await removeLiteRules(cfg); } catch (_) { /* ignore */ }
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
