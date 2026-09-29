import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { chromium } from 'playwright';

export const EXT_PATH = path.resolve(import.meta.dirname, '..', 'extension');
const DETECT = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'detect.html'), 'utf8');

// Page that records what the server saw (headers) and what the page sees (JS).
const PROBE = headers => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
  window.__probe = {
    server: ${JSON.stringify(headers)},
    ua: navigator.userAgent,
    platform: navigator.platform,
    vendor: navigator.vendor,
    maxTouchPoints: navigator.maxTouchPoints,
    uad: navigator.userAgentData ? { mobile: navigator.userAgentData.mobile, platform: navigator.userAgentData.platform } : null,
    innerWidth: innerWidth,
    innerHeight: innerHeight,
    dpr: devicePixelRatio,
    screenWidth: screen.width,
    touch: 'ontouchstart' in window,
    coarse: matchMedia('(pointer: coarse)').matches,
    hoverNone: matchMedia('(hover: none)').matches
  };
</script></head><body>
<a id="blank" href="/probe?child=1" target="_blank">child</a>
</body></html>`;

export async function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/redirect')) {
      // 302 to another origin (localhost <-> 127.0.0.1): nothing on this origin
      // runs to delete a marker cookie set on the redirect response.
      const target = new URL(req.url, 'http://x').searchParams.get('to');
      res.writeHead(302, { location: target });
      res.end();
      return;
    }
    const h = {};
    for (const [k, v] of Object.entries(req.headers)) if (k === 'user-agent' || k.startsWith('sec-ch-ua')) h[k] = v;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'accept-ch': 'Sec-CH-UA-Model, Sec-CH-UA-Platform-Version',
      'cache-control': 'no-store'
    });
    if (req.url.startsWith('/detect')) {
      res.end(DETECT.replace('/*__SERVER__*/{}', JSON.stringify(h)));
      return;
    }
    res.end(PROBE(h));
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/probe` };
}

export async function launch({ ignoreHTTPSErrors = false, activated = true } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobemu-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: null,
    ignoreHTTPSErrors,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--window-size=1280,900'
    ]
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/popup/popup.html`);
  if (activated) await activateForTests(ext);
  return { context, sw, extId, ext, userDataDir };
}

// Real codes are secret (only their hashes ship), so tests store one of the
// valid hashes directly - exactly what a successful activation stores.
export async function activateForTests(ext) {
  await ext.evaluate(async () => {
    const { LICENSE_HASHES } = await import('../src/license-hashes.js');
    await chrome.storage.local.set({ license: { hash: LICENSE_HASHES[0], activatedAt: 'test' } });
  });
}

// Sends a message to the background worker from an extension page.
export function msg(ext, message) {
  return ext.evaluate(m => chrome.runtime.sendMessage(m), message);
}

export async function tabIdOf(ext, url) {
  return ext.evaluate(async u => {
    const tabs = await chrome.tabs.query({});
    return tabs.find(t => t.url === u)?.id;
  }, url);
}

// Retries when the page navigates/reloads mid-read (e.g. inherited tabs are
// reloaded once emulation is attached).
export async function probe(page) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForFunction(() => window.__probe, null, { timeout: 10000 });
      return await page.evaluate(() => window.__probe);
    } catch (e) {
      if (attempt >= 5 || !/context was destroyed|navigation/i.test(e.message)) throw e;
      await page.waitForLoadState('load').catch(() => {});
    }
  }
}

export async function reloadedProbe(page, action) {
  const nav = page.waitForEvent('load', { timeout: 15000 });
  await action();
  await nav;
  return probe(page);
}
