import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-scan';
const PORT = 9666;
const profile = path.join(OUT, 'profile');
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

let ws, seq = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(script) {
  const r = await send('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try { if (await ev('document.readyState') === 'complete') return; } catch {}
    await sleep(250);
  }
}
async function goto(url) { await send('Page.navigate', { url }); await sleep(400); await waitReady(); await sleep(1100); }

const SCAN = `(() => {
  const vw = innerWidth;
  const bad = [];
  const inScroller = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
      p = p.parentElement;
    }
    return false;
  };
  for (const el of document.querySelectorAll('.page-content *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right <= vw + 1) continue;
    if (inScroller(el)) continue;
    bad.push({
      tag: el.tagName,
      cls: String(el.className || '').slice(0, 50),
      right: Math.round(r.right),
      w: Math.round(r.width),
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 45),
    });
    if (bad.length >= 10) break;
  }
  return { overflowX: document.documentElement.scrollWidth > vw + 1, vw, bad };
})()`;

const routes = {
  ADMIN: ['/admin/dashboard', '/admin/masyarakat', '/admin/petugas', '/admin/laporan', '/admin/reports', '/admin/assignments', '/admin/duplikat', '/admin/map', '/admin/statistik', '/admin/pengumuman', '/admin/layanan-desa', '/admin/pemerintahan', '/admin/wilayah', '/admin/profil-desa', '/admin/profile', '/admin/asisten'],
  CITIZEN: ['/masyarakat/dashboard', '/masyarakat/lacak', '/masyarakat/laporan', '/masyarakat/laporan/create', '/masyarakat/profile'],
  OFFICER: ['/petugas/dashboard', '/petugas/tugas', '/petugas/riwayat', '/petugas/profile'],
};
const creds = {
  ADMIN: { email: 'admin@ciperna.id', password: 'Admin123!' },
  CITIZEN: { email: 'citizen1@example.com', password: 'password123' },
  OFFICER: { email: 'officer1@example.com', password: 'password123' },
};

const out = {};
try {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const l = await r.json();
        const p = l.find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
      }
    } catch {}
    await sleep(250);
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pending.has(j.id)) pending.get(j.id)(j); };
  await send('Page.enable');
  await send('Runtime.enable');

  for (const [w, h] of [[320, 640], [390, 844], [768, 1024]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
    out[w] = {};
    for (const role of ['ADMIN', 'CITIZEN', 'OFFICER']) {
      await goto('http://localhost:3000/login');
      const st = await ev(`(async () => {
        const r = await fetch('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(${JSON.stringify(creds[role])}) });
        return r.status;
      })()`);
      out[w][role] = { login: st, pages: {} };
      for (const route of routes[role]) {
        await goto('http://localhost:3000' + route);
        await ev(`document.documentElement.dataset.theme='light'`);
        out[w][role].pages[route] = await ev(SCAN);
      }
    }
    await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('done', w);
  }
} catch (e) {
  out.error = String(e && e.stack ? e.stack : e);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ out: OUT, error: out.error || null }, null, 2));
}
