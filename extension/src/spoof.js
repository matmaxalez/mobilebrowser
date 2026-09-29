// Runs inside the page (MAIN world) before the site's own scripts.
// Must stay self-contained: it is serialized and injected as a string
// (full mode, via Page.addScriptToEvaluateOnNewDocument), used by the
// lite-mode content script, or passed to chrome.scripting.executeScript.
// Classic script on purpose (no `export`), so it can be listed as a content
// script and imported by the module service worker alike.
Object.defineProperty(globalThis, '__mobileEmuSpoof', {
  configurable: true,
  enumerable: false,
  writable: true,
  value: function mobileSpoof(cfg) {
    if (window.__mobileEmuApplied) return;
    Object.defineProperty(window, '__mobileEmuApplied', { value: true, enumerable: false });

    const define = (obj, prop, value) => {
      try {
        Object.defineProperty(obj, prop, { get: () => value, configurable: true, enumerable: true });
      } catch (_) { /* ignore */ }
    };
    const nav = Navigator.prototype;

    // Identity (lite mode only – full mode gets these from the CDP UA override).
    if (cfg.lite) {
      define(nav, 'userAgent', cfg.userAgent);
      define(nav, 'appVersion', cfg.appVersion);
      define(nav, 'platform', cfg.platform);
      define(nav, 'maxTouchPoints', 5);
    }
    define(nav, 'vendor', cfg.vendor);

    // User-Agent Client Hints: Safari has none, Android gets a mobile profile.
    if (cfg.ios) {
      try { delete nav.userAgentData; } catch (_) { /* ignore */ }
    } else if (cfg.lite && cfg.metadata) {
      const m = cfg.metadata;
      const low = { brands: m.brands, mobile: m.mobile, platform: m.platform };
      const uad = {
        brands: m.brands.map(b => ({ ...b })),
        mobile: m.mobile,
        platform: m.platform,
        getHighEntropyValues: hints => Promise.resolve({
          ...low,
          ...Object.fromEntries((hints || []).map(h => {
            const map = {
              architecture: m.architecture, bitness: m.bitness, model: m.model,
              platformVersion: m.platformVersion, uaFullVersion: m.fullVersion,
              fullVersionList: m.fullVersionList, wow64: m.wow64,
              formFactors: [m.mobile ? 'Mobile' : 'Tablet']
            };
            return [h, map[h]];
          }).filter(([, v]) => v !== undefined))
        }),
        toJSON: () => low
      };
      define(nav, 'userAgentData', uad);
    }

    if (!cfg.lite) return;

    // Touch support detection ('ontouchstart' in window, TouchEvent, etc.).
    for (const target of [window, Document.prototype, HTMLElement.prototype]) {
      for (const ev of ['ontouchstart', 'ontouchmove', 'ontouchend', 'ontouchcancel']) {
        if (!(ev in target)) {
          try { Object.defineProperty(target, ev, { value: null, writable: true, configurable: true }); } catch (_) { /* ignore */ }
        }
      }
    }

    // Screen metrics.
    define(window, 'devicePixelRatio', cfg.dpr);
    const sp = Screen.prototype;
    define(sp, 'width', cfg.width);
    define(sp, 'height', cfg.height);
    define(sp, 'availWidth', cfg.width);
    define(sp, 'availHeight', cfg.height);
    try {
      const so = screen.orientation;
      if (so) {
        define(so, 'type', cfg.landscape ? 'landscape-primary' : 'portrait-primary');
        define(so, 'angle', cfg.landscape ? 90 : 0);
      }
    } catch (_) { /* ignore */ }

    // matchMedia: pretend to have a coarse pointer without hover.
    const origMatchMedia = window.matchMedia;
    if (origMatchMedia) {
      const T = '(min-width: 0px)';
      const F = '((min-width: 1px) and (max-width: 0px))'; // always false, even in 0-width frames
      const rewrite = q => String(q)
        .replace(/\(\s*(any-)?pointer\s*:\s*coarse\s*\)/gi, T)
        .replace(/\(\s*(any-)?pointer\s*:\s*(fine|none)\s*\)/gi, F)
        .replace(/\(\s*(any-)?pointer\s*\)/gi, T)
        .replace(/\(\s*(any-)?hover\s*:\s*none\s*\)/gi, T)
        .replace(/\(\s*(any-)?hover\s*:\s*hover\s*\)/gi, F)
        .replace(/\(\s*(any-)?hover\s*\)/gi, F);
      const patched = function matchMedia(query) {
        const mql = origMatchMedia.call(this, rewrite(query));
        try { Object.defineProperty(mql, 'media', { value: String(query) }); } catch (_) { /* ignore */ }
        return mql;
      };
      Object.defineProperty(patched, 'toString', { value: () => 'function matchMedia() { [native code] }' });
      window.matchMedia = patched;
    }
  }
});
