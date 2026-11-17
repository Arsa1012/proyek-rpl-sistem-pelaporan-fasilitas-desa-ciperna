import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-mobile-fix';
const profile = path.join(OUT, 'profile');
const PORT = 9891;
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' }
);
let ws;
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(script) {
  const r = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await ev('document.readyState')) === 'complete') return;
    } catch {}
    await sleep(250);
  }
}
async function goto(url) {
  await send('Page.navigate', { url });
  await sleep(400);
  await ready();
  await sleep(700);
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT, name), Buffer.from(s.data, 'base64'));
}

const measure = `(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    vw: innerWidth, vh: innerHeight,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    topbar: r('.topbar'),
    heading: r('.page-content h2'),
    firstCard: r('.page-content .card'),
    toggle: r('.sidebar-toggle'),
    scrollY: Math.round(scrollY),
    docH: document.documentElement.scrollHeight,
  };
})()`;

const results = {};
try {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const p = (await r.json()).find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) {
          ws = new WebSocket(p.webSocketDebuggerUrl);
          break;
        }
      }
    } catch {}
    await sleep(250);
  }
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data);
    if (j.id && pending.has(j.id)) pending.get(j.id)(j);
  };
  await send('Page.enable');
  await send('Runtime.enable');

  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 771, deviceScaleFactor: 1, mobile: true });
  await goto(`${BASE}/login`);
  results.login = await ev(`fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'citizen1@example.com', password: 'password123' }) }).then((r) => r.status)`);
  await goto(`${BASE}/masyarakat/dashboard`);
  results.w400 = await ev(measure);
  await shot('citizen-400-light.png');
  results.w400.open = (await ev(`document.querySelector('.sidebar-toggle').click(); 1`), await sleep(450), await ev(measure));
  await shot('citizen-400-drawer.png');
  results.w400.menu = await ev(`(() => { const n = document.querySelector('.sidebar-nav'); const f = document.querySelector('.sidebar-user-section'); return { navScrollH: n.scrollHeight, navClientH: n.clientHeight, footerTop: Math.round(f.getBoundingClientRect().top), footerBottom: Math.round(f.getBoundingClientRect().bottom), lastLink: [...n.querySelectorAll('.sidebar-link')].pop().textContent.trim() }; })()`);
  await ev(`document.querySelector('.sidebar-close').click()`);
  await sleep(400);

  await ev(`document.documentElement.setAttribute('data-theme', 'dark'); 1`);
  await sleep(300);
  await shot('citizen-400-dark.png');
  await ev(`document.documentElement.removeAttribute('data-theme'); 1`);

  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  results.w320 = await ev(measure);
  await shot('citizen-320-light.png');
  results.w320.dark = await ev(`(async () => { document.documentElement.setAttribute('data-theme', 'dark'); await new Promise(r => setTimeout(r, 250)); return 1; })()`);
  await shot('citizen-320-dark.png');
  await ev(`document.documentElement.removeAttribute('data-theme')`);

  await ev(`fetch('/api/auth/logout', { method: 'POST' })`);
  await fs.writeFile(path.join(OUT, 'header.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  try {
    ws && ws.close();
  } catch {}
  chrome.kill();
}
