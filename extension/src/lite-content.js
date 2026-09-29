// Lite mode, MAIN world, document_start. The background worker tags document
// responses of an emulated tab with the device profile (Server-Timing entry
// "mobemu", plus a short-lived "__mobemu" cookie for plain-http pages).
// Pages in other tabs carry neither, so nothing happens there.
(() => {
  const spoof = globalThis.__mobileEmuSpoof;
  try { delete globalThis.__mobileEmuSpoof; } catch (_) { /* ignore */ }

  let raw = null;
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    const entry = nav?.serverTiming?.find(e => e.name === 'mobemu');
    if (entry) raw = entry.description;
  } catch (_) { /* not exposed */ }

  try {
    const m = /(?:^|;\s*)__mobemu=([^;]*)/.exec(document.cookie);
    if (m) {
      document.cookie = '__mobemu=; Max-Age=0; Path=/';
      // A cookie is per-host, not per-tab: only trust it when this document
      // has no Server-Timing channel at all (insecure context).
      if (!raw && !window.isSecureContext) raw = m[1];
    }
  } catch (_) { /* opaque origin / cookies disabled */ }

  if (!raw || !spoof) return;
  try {
    spoof(JSON.parse(decodeURIComponent(raw)));
  } catch (_) { /* malformed */ }
})();
