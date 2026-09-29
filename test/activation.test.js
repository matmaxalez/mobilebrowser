import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, launch, msg, tabIdOf, probe, reloadedProbe, activateForTests } from './helpers.js';
import { hashCode, normalizeCode } from '../scripts/generate-codes.mjs';
import { LICENSE_SALT, LICENSE_HASHES } from '../extension/src/license-hashes.js';

let srv, br;

before(async () => {
  srv = await startServer();
  br = await launch({ activated: false });
});

after(async () => {
  await br?.context.close();
  srv?.server.close();
  if (br) fs.rmSync(br.userDataDir, { recursive: true, force: true });
});

test('ships 100+ unique hashes and no plain codes', () => {
  assert.ok(LICENSE_HASHES.length >= 100);
  assert.equal(new Set(LICENSE_HASHES).size, LICENSE_HASHES.length);
  const src = fs.readFileSync(new URL('../extension/src/license-hashes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /MOB-[A-Z0-9]{4}-/);
});

test('code normalization accepts spaces, lowercase and a missing prefix', () => {
  const n = normalizeCode('MOB-ABCD-EFGH-JKLM-NPQR');
  assert.equal(n, 'ABCDEFGHJKLMNPQR');
  assert.equal(normalizeCode(' mob abcd efgh jklm npqr '), n);
  assert.equal(normalizeCode('ABCD-EFGH-JKLM-NPQR'), n);
});

test('extension and generator hash codes identically', async () => {
  const code = 'mob-abcd-efgh-jklm-npqr';
  const inBrowser = await br.ext.evaluate(async c => (await import('../src/license.js')).hashCode(c), code);
  assert.equal(inBrowser, hashCode(LICENSE_SALT, code));
});

test('emulation is blocked until the extension is activated', async () => {
  const state = await msg(br.ext, { type: 'getState', tabId: null });
  assert.equal(state.activated, false);

  const page = await br.context.newPage();
  const url = `${srv.url}?locked=1`;
  await page.goto(url);
  const tabId = await tabIdOf(br.ext, url);
  const res = await msg(br.ext, { type: 'toggle', tabId });
  assert.equal(res.ok, false);
  assert.match(res.error, /nie jest aktywowana/);
  assert.doesNotMatch((await probe(page)).ua, /Android|iPhone/);

  // Popup shows the activation form only.
  const popup = await br.context.newPage();
  await popup.goto(`chrome-extension://${br.extId}/popup/popup.html?tab=${tabId}`);
  await popup.waitForSelector('#activation:not([hidden])');
  assert.equal(await popup.isHidden('#main'), true);

  // Wrong and malformed codes are rejected with a message.
  await popup.fill('#code', 'MOB-AAAA-BBBB-CCCC-DDDD');
  await popup.click('#activateBtn');
  await popup.waitForSelector('#error:not([hidden])');
  assert.match(await popup.textContent('#error'), /Nieprawidłowy kod/);
  const bad = await msg(br.ext, { type: 'activate', code: '123' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /MOB-XXXX/);
  assert.equal((await msg(br.ext, { type: 'getState', tabId })).activated, false);
  await popup.close();
  await page.close();
});

test('after activation emulation works; deactivation turns it off everywhere', async () => {
  await activateForTests(br.ext);
  assert.equal((await msg(br.ext, { type: 'getState', tabId: null })).activated, true);
  await msg(br.ext, { type: 'saveSettings', settings: { mode: 'full', deviceId: 'pixel-9', viewport: 'tab' } });

  const page = await br.context.newPage();
  const url = `${srv.url}?unlocked=1`;
  await page.goto(url);
  const tabId = await tabIdOf(br.ext, url);
  const on = await reloadedProbe(page, () => msg(br.ext, { type: 'toggle', tabId }));
  assert.match(on.ua, /Android/);

  const off = await reloadedProbe(page, async () => {
    const res = await msg(br.ext, { type: 'deactivate' });
    assert.ok(res.ok, res.error);
  });
  assert.doesNotMatch(off.ua, /Android/);
  const state = await msg(br.ext, { type: 'getState', tabId });
  assert.equal(state.activated, false);
  assert.equal(state.tabState, null);
  await page.close();
});
