// Lite mode, MAIN world, document_start. The background worker marks pages
// loaded in an emulated tab with a short-lived cookie (declarativeNetRequest
// response header) carrying the device profile; nothing happens otherwise.
(() => {
  const spoof = globalThis.__mobileEmuSpoof;
  try { delete globalThis.__mobileEmuSpoof; } catch (_) { /* ignore */ }
  let raw = null;
  try {
    const m = /(?:^|;\s*)__mobemu=([^;]*)/.exec(document.cookie);
    if (!m) return;
    raw = m[1];
    document.cookie = '__mobemu=; Max-Age=0; Path=/';
  } catch (_) {
    return; // opaque origin / cookies disabled
  }
  try {
    if (spoof) spoof(JSON.parse(decodeURIComponent(raw)));
  } catch (_) { /* malformed */ }
})();
