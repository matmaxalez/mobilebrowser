import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, launch, msg, tabIdOf, probe, reloadedProbe } from './helpers.js';

let srv, br;

before(async () => {
  srv = await startServer();
  br = await launch();
});

after(async () => {
  await br?.context.close();
  srv?.server.close();
  if (br) fs.rmSync(br.userDataDir, { recursive: true, force: true });
});

async function openProbe(suffix = '') {
  const page = await br.context.newPage();
  const url = `${srv.url}?t=${Date.now()}${suffix}`;
  await page.goto(url);
  const tabId = await tabIdOf(br.ext, url);
  assert.ok(tabId, 'tab id found');
  return { page, tabId };
}

test('full mode, whole tab: Android identity without a phone frame', async () => {
  await msg(br.ext, { type: 'saveSettings', settings: { mode: 'full', deviceId: 'pixel-9', landscape: false, viewport: 'tab' } });
  const { page, tabId } = await openProbe('&tab=1');
  const desktop = await probe(page);
  const p = await reloadedProbe(page, async () => {
    const res = await msg(br.ext, { type: 'toggle', tabId });
    assert.ok(res.ok, res.error);
  });
  assert.match(p.ua, /Linux; Android 10; K.*Chrome\/\d+\.0\.0\.0 Mobile Safari/);
  assert.match(p.server['user-agent'], /Android.*Mobile/);
  assert.equal(p.server['sec-ch-ua-mobile'], '?1');
  assert.equal(p.server['sec-ch-ua-platform'], '"Android"');
  assert.deepEqual(p.uad, { mobile: true, platform: 'Android' });
  // Page keeps the full tab size...
  assert.equal(p.innerWidth, desktop.innerWidth);
  // ...but screen, touch and pointer say "phone".
  assert.equal(p.screenWidth, 412);
  assert.equal(p.maxTouchPoints, 5);
  assert.equal(p.touch, true);
  assert.equal(p.coarse, true);
  assert.equal(p.hoverNone, true);

  const off = await reloadedProbe(page, () => msg(br.ext, { type: 'toggle', tabId }));
  assert.doesNotMatch(off.ua, /Android/);
  await page.close();
});

test('full mode, device viewport: iPhone 1:1 (viewport, DPR, touch, UA, no client hints)', async () => {
  await msg(br.ext, { type: 'saveSettings', settings: { mode: 'full', deviceId: 'iphone-16-pro', landscape: false, viewport: 'device' } });
  const { page, tabId } = await openProbe();
  const before = await probe(page);
  assert.match(before.ua, /HeadlessChrome|Chrome/);
  assert.equal(before.touch, false);

  const p = await reloadedProbe(page, async () => {
    const res = await msg(br.ext, { type: 'toggle', tabId });
    assert.ok(res.ok, res.error);
    assert.equal(res.tabState.mode, 'full');
  });
  assert.match(p.ua, /iPhone; CPU iPhone OS/);
  assert.match(p.server['user-agent'], /iPhone/);
  assert.equal(p.server['sec-ch-ua-mobile'], undefined);
  assert.equal(p.uad, null);
  assert.equal(p.innerWidth, 402);
  assert.equal(p.screenWidth, 402);
  assert.equal(p.dpr, 3);
  assert.equal(p.maxTouchPoints, 5);
  assert.equal(p.touch, true);
  assert.equal(p.coarse, true);
  assert.equal(p.vendor, 'Apple Computer, Inc.');
  assert.equal(p.platform, 'iPhone');

  // Emulation survives navigation within the tab.
  await page.goto(`${srv.url}?again=1`);
  const p2 = await probe(page);
  assert.match(p2.ua, /iPhone/);
  assert.equal(p2.innerWidth, 402);

  // Switch device while active -> Android with client hints.
  const p3 = await reloadedProbe(page, async () => {
    const res = await msg(br.ext, { type: 'saveSettings', settings: { deviceId: 'pixel-8' }, tabId });
    assert.ok(res.ok, res.error);
  });
  assert.match(p3.ua, /Android 10; K.*Mobile Safari/);
  assert.equal(p3.server['sec-ch-ua-mobile'], '?1');
  assert.equal(p3.server['sec-ch-ua-platform'], '"Android"');
  assert.deepEqual(p3.uad, { mobile: true, platform: 'Android' });
  assert.equal(p3.innerWidth, 412);
  assert.equal(p3.dpr, 2.625);

  // Landscape without reload.
  const land = await msg(br.ext, { type: 'saveSettings', settings: { landscape: true }, tabId });
  assert.ok(land.ok, land.error);
  await page.waitForFunction(() => innerWidth === 915);
  await msg(br.ext, { type: 'saveSettings', settings: { landscape: false }, tabId });

  // Tabs opened from the emulated tab inherit emulation.
  const [child] = await Promise.all([br.context.waitForEvent('page'), page.evaluate(() => document.getElementById('blank').click())]);
  await child.waitForLoadState('load');
  await child.waitForFunction(() => window.__probe && /Android/.test(navigator.userAgent), null, { timeout: 15000 });
  const pc = await probe(child);
  assert.match(pc.server['user-agent'], /Android/);
  await child.close();

  // Turning off restores desktop.
  const off = await reloadedProbe(page, async () => {
    const res = await msg(br.ext, { type: 'toggle', tabId });
    assert.ok(res.ok, res.error);
    assert.equal(res.tabState, null);
  });
  assert.doesNotMatch(off.ua, /Android|iPhone/);
  assert.equal(off.touch, false);
  assert.ok(off.innerWidth > 600, `innerWidth ${off.innerWidth}`);
  await page.close();
});

test('lite mode in the same tab: headers + navigator, no debugger', async () => {
  await msg(br.ext, { type: 'saveSettings', settings: { mode: 'lite', deviceId: 'galaxy-s24', liteWindow: false, landscape: false } });
  const { page, tabId } = await openProbe('&same=1');
  const p = await reloadedProbe(page, async () => {
    const res = await msg(br.ext, { type: 'toggle', tabId });
    assert.ok(res.ok, res.error);
    assert.equal(res.tabState.phoneWindowId, undefined);
  });
  assert.match(p.server['user-agent'], /Android/);
  assert.match(p.ua, /Android/);
  assert.equal(p.touch, true);
  assert.equal(p.screenWidth, 360);
  const cookie = await page.evaluate(() => document.cookie);
  assert.doesNotMatch(cookie, /__mobemu/);
  const off = await reloadedProbe(page, () => msg(br.ext, { type: 'toggle', tabId }));
  assert.doesNotMatch(off.ua, /Android/);
  assert.equal(off.touch, false);
  await page.close();
});

test('lite mode can move the tab into a phone-sized window', async () => {
  await msg(br.ext, { type: 'saveSettings', settings: { mode: 'lite', deviceId: 'galaxy-s24', liteWindow: true, landscape: false } });
  const { page, tabId } = await openProbe('&lite=1');
  const p = await reloadedProbe(page, async () => {
    const res = await msg(br.ext, { type: 'toggle', tabId });
    assert.ok(res.ok, res.error);
    assert.equal(res.tabState.mode, 'lite');
    assert.ok(res.tabState.phoneWindowId);
  });
  assert.match(p.server['user-agent'], /Android 10; K.*Mobile Safari/);
  assert.equal(p.server['sec-ch-ua-mobile'], '?1');
  assert.equal(p.server['sec-ch-ua-platform'], '"Android"');
  assert.match(p.ua, /Android/);
  assert.equal(p.platform, 'Linux armv81');
  assert.equal(p.maxTouchPoints, 5);
  assert.equal(p.touch, true);
  assert.equal(p.coarse, true);
  assert.equal(p.hoverNone, true);
  assert.equal(p.dpr, 3);
  assert.deepEqual(p.uad, { mobile: true, platform: 'Android' });

  const win = await br.ext.evaluate(async id => {
    const t = await chrome.tabs.get(id);
    const w = await chrome.windows.get(t.windowId);
    return { type: w.type, tabWidth: t.width };
  }, tabId);
  assert.equal(win.type, 'popup');
  console.log('lite window viewport width:', win.tabWidth, 'page innerWidth:', p.innerWidth);

  const res = await msg(br.ext, { type: 'toggle', tabId });
  assert.ok(res.ok, res.error);
  assert.equal(res.tabState, null);
});

test('restricted pages are refused', async () => {
  const page = await br.context.newPage();
  await page.goto('chrome://version');
  const tabId = await tabIdOf(br.ext, 'chrome://version/');
  const res = await msg(br.ext, { type: 'toggle', tabId });
  assert.equal(res.ok, false);
  assert.match(res.error, /nie można emulować/);
  await page.close();
});
