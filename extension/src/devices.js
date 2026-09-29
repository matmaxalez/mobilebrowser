// Device presets. Sizes are CSS pixels (portrait), dpr = devicePixelRatio.
// os: 'ios' | 'android'. tablet: true drops the "Mobile" token on Android.

export const DEVICES = [
  { id: 'iphone-16-pro', name: 'iPhone 16 Pro', os: 'ios', width: 402, height: 874, dpr: 3 },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', os: 'ios', width: 440, height: 956, dpr: 3 },
  { id: 'iphone-15', name: 'iPhone 15 / 14 Pro', os: 'ios', width: 393, height: 852, dpr: 3 },
  { id: 'iphone-se', name: 'iPhone SE', os: 'ios', width: 375, height: 667, dpr: 2 },
  { id: 'pixel-9', name: 'Google Pixel 9', os: 'android', model: 'Pixel 9', androidVersion: '15', width: 412, height: 923, dpr: 2.625 },
  { id: 'pixel-8', name: 'Google Pixel 8', os: 'android', model: 'Pixel 8', androidVersion: '14', width: 412, height: 915, dpr: 2.625 },
  { id: 'galaxy-s24', name: 'Samsung Galaxy S24', os: 'android', model: 'SM-S921B', androidVersion: '14', width: 360, height: 780, dpr: 3 },
  { id: 'galaxy-s24-ultra', name: 'Samsung Galaxy S24 Ultra', os: 'android', model: 'SM-S928B', androidVersion: '14', width: 384, height: 824, dpr: 3.75 },
  { id: 'galaxy-a55', name: 'Samsung Galaxy A55', os: 'android', model: 'SM-A556B', androidVersion: '14', width: 384, height: 832, dpr: 2.8125 },
  { id: 'ipad-mini', name: 'iPad Mini', os: 'ios', tablet: true, width: 768, height: 1024, dpr: 2 },
  { id: 'galaxy-tab-s9', name: 'Samsung Galaxy Tab S9', os: 'android', tablet: true, model: 'SM-X710', androidVersion: '14', width: 800, height: 1280, dpr: 2 },
  { id: 'custom', name: 'Własne urządzenie…', os: 'android', model: 'K', androidVersion: '10', width: 390, height: 844, dpr: 3 }
];

export const DEFAULT_CUSTOM = { os: 'android', width: 390, height: 844, dpr: 3, tablet: false, userAgent: '' };

export function resolveDevice(cfg) {
  const base = DEVICES.find(d => d.id === cfg.deviceId) || DEVICES[0];
  if (base.id !== 'custom') return base;
  const c = { ...DEFAULT_CUSTOM, ...(cfg.custom || {}) };
  return {
    ...base,
    os: c.os === 'ios' ? 'ios' : 'android',
    tablet: !!c.tablet,
    width: clampInt(c.width, 200, 3000, 390),
    height: clampInt(c.height, 200, 3000, 844),
    dpr: clampNum(c.dpr, 1, 5, 3),
    customUserAgent: (c.userAgent || '').trim()
  };
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function clampNum(v, min, max, def) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

// Chrome version info of the running browser, so the spoofed Android UA
// matches the real engine (sites that sniff versions keep working).
export async function getBrowserVersion() {
  let major = '140';
  let full = '140.0.0.0';
  const m = /Chrome\/(\d+)/.exec(navigator.userAgent);
  if (m) { major = m[1]; full = `${major}.0.0.0`; }
  let brands = null;
  let fullVersionList = null;
  try {
    const uad = navigator.userAgentData;
    if (uad) {
      brands = uad.brands.map(b => ({ brand: b.brand, version: b.version }));
      const he = await uad.getHighEntropyValues(['fullVersionList', 'uaFullVersion']);
      if (he.fullVersionList) fullVersionList = he.fullVersionList.map(b => ({ brand: b.brand, version: b.version }));
      if (he.uaFullVersion) full = he.uaFullVersion;
    }
  } catch (_) { /* ignore */ }
  if (!brands) {
    brands = [
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major },
      { brand: 'Not=A?Brand', version: '24' }
    ];
  }
  if (!fullVersionList) fullVersionList = brands.map(b => ({ brand: b.brand, version: b.brand.startsWith('Not') ? `${b.version}.0.0.0` : full }));
  return { major, full, brands, fullVersionList };
}

// Builds everything needed to impersonate the device: UA string, navigator
// values and User-Agent Client Hints metadata (null for iOS - Safari has none).
export function buildProfile(device, version) {
  const ios = device.os === 'ios';
  let userAgent;
  if (device.customUserAgent) {
    userAgent = device.customUserAgent;
  } else if (ios) {
    // Safari 26 freezes the OS version in the UA at 18_6.
    const kind = device.tablet ? 'iPad; CPU OS 18_6' : 'iPhone; CPU iPhone OS 18_6';
    userAgent = `Mozilla/5.0 (${kind} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1`;
  } else {
    // Chrome for Android uses the reduced UA: "Android 10; K".
    const mobile = device.tablet ? '' : ' Mobile';
    userAgent = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version.major}.0.0.0${mobile} Safari/537.36`;
  }

  const metadata = ios ? null : {
    brands: version.brands,
    fullVersionList: version.fullVersionList,
    fullVersion: version.full,
    platform: 'Android',
    platformVersion: `${device.androidVersion || '14'}.0.0`,
    architecture: '',
    model: device.model || '',
    mobile: !device.tablet,
    bitness: '',
    wow64: false
  };

  return {
    userAgent,
    appVersion: userAgent.replace(/^Mozilla\//, ''),
    platform: ios ? (device.tablet ? 'iPad' : 'iPhone') : 'Linux armv81',
    vendor: ios ? 'Apple Computer, Inc.' : 'Google Inc.',
    ios,
    metadata
  };
}

// Headers for Lite mode (declarativeNetRequest). Safari sends no client hints.
export function buildHeaders(profile) {
  const h = [{ header: 'user-agent', operation: 'set', value: profile.userAgent }];
  const ch = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version',
    'sec-ch-ua-model', 'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-arch',
    'sec-ch-ua-bitness', 'sec-ch-ua-wow64', 'sec-ch-ua-form-factors'];
  if (!profile.metadata) {
    for (const name of ch) h.push({ header: name, operation: 'remove' });
    return h;
  }
  const m = profile.metadata;
  const list = arr => arr.map(b => `"${b.brand}";v="${b.version}"`).join(', ');
  h.push(
    { header: 'sec-ch-ua', operation: 'set', value: list(m.brands) },
    { header: 'sec-ch-ua-mobile', operation: 'set', value: m.mobile ? '?1' : '?0' },
    { header: 'sec-ch-ua-platform', operation: 'set', value: '"Android"' },
    { header: 'sec-ch-ua-platform-version', operation: 'set', value: `"${m.platformVersion}"` },
    { header: 'sec-ch-ua-model', operation: 'set', value: `"${m.model}"` },
    { header: 'sec-ch-ua-full-version', operation: 'set', value: `"${m.fullVersion}"` },
    { header: 'sec-ch-ua-full-version-list', operation: 'set', value: list(m.fullVersionList) },
    { header: 'sec-ch-ua-arch', operation: 'set', value: '""' },
    { header: 'sec-ch-ua-bitness', operation: 'set', value: '""' },
    { header: 'sec-ch-ua-wow64', operation: 'set', value: '?0' },
    { header: 'sec-ch-ua-form-factors', operation: 'set', value: m.mobile ? '"Mobile"' : '"Tablet"' }
  );
  return h;
}

export function orientedSize(device, landscape) {
  return landscape
    ? { width: device.height, height: device.width }
    : { width: device.width, height: device.height };
}
