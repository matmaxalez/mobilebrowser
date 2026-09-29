// Captures README screenshots: the detection page with emulation off/on and
// the popup. Usage: node scripts/screenshots.mjs
import { launch, msg, tabIdOf, startServer } from '../test/helpers.js';

const srv = await startServer();
const url = srv.url.replace('/probe', '/detect');
const br = await launch();
try {
  await msg(br.ext, { type: 'saveSettings', settings: { mode: 'full', deviceId: 'pixel-9', viewport: 'tab', landscape: false } });
  const page = await br.context.newPage();
  await page.setViewportSize({ width: 1100, height: 620 });
  await page.goto(url);
  await page.screenshot({ path: 'docs/img/desktop.png' });

  const tabId = await tabIdOf(br.ext, url);
  const nav = page.waitForEvent('load');
  const res = await msg(br.ext, { type: 'toggle', tabId });
  if (!res.ok) throw new Error(res.error);
  await nav;
  await page.screenshot({ path: 'docs/img/mobile.png' });

  const popup = await br.context.newPage();
  await popup.setViewportSize({ width: 364, height: 600 });
  await popup.goto(`chrome-extension://${br.extId}/popup/popup.html?tab=${tabId}`);
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: 'docs/img/popup.png', fullPage: true });
  console.log('saved docs/img/{desktop,mobile,popup}.png');
} finally {
  await br.context.close();
  srv.server.close();
}
