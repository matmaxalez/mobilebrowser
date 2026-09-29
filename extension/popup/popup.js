const $ = id => document.getElementById(id);

const els = {
  card: $('statusCard'), label: $('statusLabel'), detail: $('statusDetail'), toggle: $('toggle'),
  error: $('error'), device: $('device'), meta: $('deviceMeta'), viewport: $('viewport'), viewportField: $('viewportField'),
  customBox: $('customBox'), cWidth: $('cWidth'), cHeight: $('cHeight'), cDpr: $('cDpr'), cOs: $('cOs'),
  cTablet: $('cTablet'), cUa: $('cUa'), liteWindow: $('liteWindow'), liteWindowRow: $('liteWindowRow'),
  inherit: $('inherit')
};

let tabId = null;
let settings = null;
let devices = [];
let tabState = null;
let restricted = false;
let busy = false;

function send(msg) {
  return chrome.runtime.sendMessage(msg).then(res => {
    if (!res?.ok) throw new Error(res?.error || 'Nieznany błąd');
    return res;
  });
}

function showError(message) {
  els.error.textContent = message || '';
  els.error.hidden = !message;
}

function groupOf(d) {
  if (d.id === 'custom') return 'Inne';
  if (d.tablet) return 'Tablety';
  return d.os === 'ios' ? 'iPhone' : 'Android';
}

function renderDevices() {
  els.device.textContent = '';
  const groups = new Map();
  for (const d of devices) {
    const g = groupOf(d);
    if (!groups.has(g)) {
      const og = document.createElement('optgroup');
      og.label = g;
      groups.set(g, og);
      els.device.append(og);
    }
    const opt = new Option(d.name, d.id);
    groups.get(g).append(opt);
  }
}

function currentDevice() {
  const d = devices.find(x => x.id === settings.deviceId) || devices[0];
  if (d.id !== 'custom') return d;
  const c = settings.custom;
  return { ...d, width: +c.width, height: +c.height, dpr: +c.dpr, os: c.os, tablet: c.tablet };
}

function render() {
  const on = !!tabState;
  const lite = (tabState?.mode || settings.mode) === 'lite';
  els.card.classList.toggle('on', on);
  els.card.classList.toggle('lite', on && lite);
  els.card.classList.toggle('disabled', restricted && !on);
  els.toggle.checked = on;
  els.toggle.disabled = busy || (restricted && !on);

  const active = on ? devices.find(d => d.id === tabState.deviceId) : null;
  if (restricted && !on) {
    els.label.textContent = 'Niedostępne';
    els.detail.textContent = 'Strony wewnętrzne Chrome nie mogą być emulowane';
  } else if (on) {
    els.label.textContent = lite ? 'Włączony · tryb lekki' : 'Włączony';
    els.detail.textContent = active ? active.name : '';
  } else {
    els.label.textContent = 'Wyłączony';
    els.detail.textContent = 'Strona zobaczy telefon, karta zostaje normalna';
  }

  els.device.value = settings.deviceId;
  els.customBox.hidden = settings.deviceId !== 'custom';
  const c = settings.custom;
  els.cWidth.value = c.width; els.cHeight.value = c.height; els.cDpr.value = c.dpr;
  els.cOs.value = c.os; els.cTablet.checked = !!c.tablet; els.cUa.value = c.userAgent || '';

  for (const b of document.querySelectorAll('[data-orient]')) {
    b.classList.toggle('active', (b.dataset.orient === 'landscape') === !!settings.landscape);
  }
  els.viewport.value = settings.viewport;
  els.viewportField.hidden = settings.mode !== 'full';
  for (const r of document.querySelectorAll('input[name=mode]')) r.checked = r.value === settings.mode;
  els.liteWindowRow.hidden = settings.mode !== 'lite';
  els.liteWindow.checked = !!settings.liteWindow;
  els.inherit.checked = !!settings.inherit;

  const d = currentDevice();
  const w = settings.landscape ? d.height : d.width;
  const h = settings.landscape ? d.width : d.height;
  els.meta.textContent = `${w} × ${h} px · DPR ${d.dpr} · ${d.os === 'ios' ? 'iOS / Safari' : 'Android / Chrome'}${d.tablet ? ' · tablet' : ''}`;
}

async function update(patch) {
  settings = { ...settings, ...patch, custom: { ...settings.custom, ...(patch.custom || {}) } };
  render();
  showError('');
  try {
    const res = await send({ type: 'saveSettings', settings, tabId });
    settings = res.settings;
    if (tabState) tabState = res.tabState;
    render();
  } catch (e) {
    showError(e.message);
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  const res = await send({ type: 'getState', tabId });
  ({ settings, devices, tabState, restricted } = res);
  renderDevices();
  render();

  els.toggle.addEventListener('change', async () => {
    busy = true; render(); showError('');
    try {
      const r = await send({ type: 'toggle', tabId });
      tabState = r.tabState;
    } catch (e) {
      showError(e.message);
      try { tabState = (await send({ type: 'getState', tabId })).tabState; } catch (_) { tabState = null; }
    }
    busy = false; render();
  });

  els.device.addEventListener('change', () => update({ deviceId: els.device.value }));
  els.viewport.addEventListener('change', () => update({ viewport: els.viewport.value }));
  for (const b of document.querySelectorAll('[data-orient]')) {
    b.addEventListener('click', () => update({ landscape: b.dataset.orient === 'landscape' }));
  }
  for (const r of document.querySelectorAll('input[name=mode]')) {
    r.addEventListener('change', () => r.checked && update({ mode: r.value }));
  }
  els.liteWindow.addEventListener('change', () => update({ liteWindow: els.liteWindow.checked }));
  els.inherit.addEventListener('change', () => update({ inherit: els.inherit.checked }));

  const customChanged = () => update({
    custom: {
      width: els.cWidth.value, height: els.cHeight.value, dpr: els.cDpr.value,
      os: els.cOs.value, tablet: els.cTablet.checked, userAgent: els.cUa.value
    }
  });
  for (const el of [els.cWidth, els.cHeight, els.cDpr, els.cUa]) el.addEventListener('change', customChanged);
  for (const el of [els.cOs, els.cTablet]) el.addEventListener('change', customChanged);

  $('shortcuts').addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

init().catch(e => showError(e.message));
