// Captures README screenshots (docs/img) and Chrome Web Store assets
// (store-assets/: 1280x800 screenshots, 440x280 promo tile).
// Usage: npm run screenshots
import fs from 'node:fs';
import path from 'node:path';
import { launch, msg, tabIdOf, startServer } from '../test/helpers.js';

const root = path.resolve(import.meta.dirname, '..');
const out = (...p) => path.join(root, ...p);
fs.mkdirSync(out('docs', 'img'), { recursive: true });
fs.mkdirSync(out('store-assets'), { recursive: true });

const srv = await startServer();
const url = srv.url.replace('/probe', '/detect');
const br = await launch();
try {
  await msg(br.ext, { type: 'saveSettings', settings: { mode: 'full', deviceId: 'pixel-9', viewport: 'tab', landscape: false } });
  const page = await br.context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url);
  await page.screenshot({ path: out('store-assets', 'screenshot-2-desktop.png') });
  await page.setViewportSize({ width: 1100, height: 620 });
  await page.screenshot({ path: out('docs', 'img', 'desktop.png') });

  const tabId = await tabIdOf(br.ext, url);
  const nav = page.waitForEvent('load');
  const res = await msg(br.ext, { type: 'toggle', tabId });
  if (!res.ok) throw new Error(res.error);
  await nav;
  await page.screenshot({ path: out('docs', 'img', 'mobile.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('store-assets', 'screenshot-1-mobile.png') });

  const popup = await br.context.newPage();
  await popup.setViewportSize({ width: 364, height: 600 });
  await popup.goto(`chrome-extension://${br.extId}/popup/popup.html?tab=${tabId}`);
  await popup.waitForSelector('#deviceMeta:not(:empty)');
  await popup.screenshot({ path: out('docs', 'img', 'popup.png'), fullPage: true });

  // Store screenshot 3: the popup presented on a plain background.
  const popupPng = fs.readFileSync(out('docs', 'img', 'popup.png')).toString('base64');
  const card = await br.context.newPage();
  await card.setViewportSize({ width: 1280, height: 800 });
  await card.setContent(`<body style="margin:0;height:800px;display:flex;align-items:center;justify-content:center;gap:64px;
    background:linear-gradient(135deg,#eff6ff,#dcfce7);font:18px/1.5 system-ui,sans-serif;color:#111827">
    <div style="max-width:520px"><h1 style="font-size:40px;margin:0 0 16px">Jedno kliknięcie – wersja mobilna</h1>
    <p>Wybierz telefon (Pixel, Galaxy, iPhone…), orientację i widok. Emulacja działa tylko w bieżącej karcie,
    pozostałe karty zostają bez zmian. Skrót: Alt+Shift+M.</p></div>
    <img src="data:image/png;base64,${popupPng}" style="height:700px;border-radius:12px;box-shadow:0 20px 50px #0003"></body>`);
  await card.screenshot({ path: out('store-assets', 'screenshot-3-popup.png') });

  // Small promo tile 440x280.
  const icon = fs.readFileSync(out('extension', 'icons', 'icon128.png')).toString('base64');
  await card.setViewportSize({ width: 440, height: 280 });
  await card.setContent(`<body style="margin:0;height:280px;display:flex;align-items:center;gap:20px;padding:0 32px;
    background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;font:16px/1.4 system-ui,sans-serif">
    <img src="data:image/png;base64,${icon}" width="112" height="112">
    <div><div style="font-size:30px;font-weight:700">Mobile Emulator</div>
    <div style="opacity:.9">Strony widzą telefon.<br>Karta zostaje normalna.</div></div></body>`);
  await card.screenshot({ path: out('store-assets', 'promo-small-440x280.png') });
  console.log('saved docs/img/*.png and store-assets/*.png');
} finally {
  await br.context.close();
  srv.server.close();
  fs.rmSync(br.userDataDir, { recursive: true, force: true });
}
