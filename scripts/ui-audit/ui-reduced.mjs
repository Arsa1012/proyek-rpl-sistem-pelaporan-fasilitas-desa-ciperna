import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-mobile-fix';
const profile = path.join(OUT, 'profile');
const PORT = 9893;
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--enable-unsafe-swiftshader', '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) { return new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(script) { const r = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; }
async function ready() { for (let i = 0; i < 120; i++) { try { if ((await ev('document.readyState')) === 'complete') return; } catch {} await sleep(250); } }
async function goto(url) { await send('Page.navigate', { url }); await sleep(400); await ready(); await sleep(700); }

const result = {};
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) { const p = (await r.json()).find((t) => t.type === 'page'); if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } } catch {} await sleep(250); }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pending.has(j.id)) pending.get(j.id)(j); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 771, deviceScaleFactor: 1, mobile: true });
  await goto(`${BASE}/login`);
  result.login = await ev(`fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@ciperna.id', password: 'Admin123!' }) }).then((r) => r.status)`);
  await goto(`${BASE}/admin/dashboard`);

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  result.reduce = await ev(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  await ev(`document.querySelector('.sidebar-toggle').click()`);
  await sleep(120);
  result.open = await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    return {
      open: sb.classList.contains('open'),
      visibility: getComputedStyle(sb).visibility,
      transform: getComputedStyle(sb).transform,
      transition: getComputedStyle(sb).transitionDuration,
      body: document.body.className,
      overflowY: getComputedStyle(document.body).overflowY,
    };
  })()`);
  await ev(`document.querySelector('.sidebar-close').click()`);
  await sleep(120);
  result.close = await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    return {
      open: sb.classList.contains('open'),
      visibility: getComputedStyle(sb).visibility,
      transform: getComputedStyle(sb).transform,
      body: document.body.className,
      overflowY: getComputedStyle(document.body).overflowY,
    };
  })()`);

  // Tabs laporan di 320px (setelah min-height 44px).
  await send('Emulation.setEmulatedMedia', { features: [] });
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  await goto(`${BASE}/admin/laporan?status=SUBMITTED`);
  result.tabs320 = await ev(`(() => {
    const wrap = document.querySelector('.report-view-tabs');
    const tabs = [...document.querySelectorAll('.report-view-tab')];
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wrap: { clientW: wrap.clientWidth, scrollW: wrap.scrollWidth, h: Math.round(wrap.getBoundingClientRect().height) },
      tabs: tabs.map((a) => { const r = a.getBoundingClientRect(); return { text: a.textContent.trim(), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), active: a.classList.contains('active') }; }),
      table: (() => { const t = document.querySelector('.table-container'); return t ? { scrollW: t.scrollWidth, clientW: t.clientWidth, overflowX: getComputedStyle(t).overflowX } : null; })(),
      heading: document.querySelector('h2')?.textContent?.trim() || null,
    };
  })()`);

  await ev(`fetch('/api/auth/logout', { method: 'POST' })`);
  await fs.writeFile(path.join(OUT, 'reduced.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
