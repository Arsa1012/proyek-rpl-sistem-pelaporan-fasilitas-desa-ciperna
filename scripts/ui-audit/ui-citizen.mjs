import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-citizen';
const PORT = 9555;
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
async function goto(url) { await send('Page.navigate', { url }); await sleep(500); await waitReady(); await sleep(900); }
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, name + '.png');
  await fs.writeFile(file, Buffer.from(r.data, 'base64'));
  return file;
}

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
    await goto('http://localhost:3000/login');
    out[w] = {};
    out[w].login = await ev(`(async () => {
      const r = await fetch('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email:'citizen1@example.com', password:'password123' }) });
      return r.status;
    })()`);
    await goto('http://localhost:3000/masyarakat/dashboard');
    await ev(`document.documentElement.dataset.theme='light'; localStorage.setItem('ciperna-theme','light')`);

    // Pastikan chatbot ter-mount sebelum diklik.
    for (let i = 0; i < 10; i++) {
      if (await ev(`!!document.querySelector('.chatbot-fab')`)) break;
      await sleep(300);
    }
    out[w].fab = await ev(`(() => { const f = document.querySelector('.chatbot-fab'); if (!f) return null; const r = f.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), inVP: r.right <= innerWidth && r.bottom <= innerHeight }; })()`);

    for (let i = 0; i < 8; i++) {
      if (await ev(`!!document.querySelector('.chatbot-panel')`)) break;
      await ev(`document.querySelector('.chatbot-fab')?.click()`);
      await sleep(350);
    }
    await sleep(400);
    out[w].panel = await ev(`(() => {
      const p = document.querySelector('.chatbot-panel');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      const close = p.querySelector('.chatbot-close');
      const cr = close ? close.getBoundingClientRect() : null;
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
        inVP: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
        closeInside: cr ? cr.right <= innerWidth && cr.top >= 0 : null,
        docOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
        zIndex: getComputedStyle(document.querySelector('.chatbot-root')).zIndex,
      };
    })()`);
    // Scroll halaman penuh dan pastikan widget tetap terlihat (fixed).
    await ev(`window.scrollTo(0, document.body.scrollHeight)`);
    await sleep(250);
    out[w].afterScroll = await ev(`(() => { const p = document.querySelector('.chatbot-panel'); const r = p?.getBoundingClientRect(); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), inVP: r.bottom <= innerHeight } : null; })()`);
    await ev(`window.scrollTo(0, 0)`);

    out[w].shot = await shot(`citizen-chatbot-${w}`);

    // Tutup chatbot, lakukan pemeriksaan overflow halaman warga.
    await ev(`document.querySelector('.chatbot-close')?.click()`);
    out[w].pages = {};
    for (const p of ['/masyarakat/laporan', '/masyarakat/laporan/create', '/masyarakat/profile']) {
      await goto('http://localhost:3000' + p);
      out[w].pages[p] = await ev(`({ overflowX: document.documentElement.scrollWidth > innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, innerWidth })`);
    }
    // Kembali ke dashboard untuk screenshot terang/gelap mobile.
    await goto('http://localhost:3000/masyarakat/dashboard');
    out[w].lightShot = await shot(`citizen-dash-${w}-light`);
    await ev(`document.documentElement.dataset.theme='dark'; localStorage.setItem('ciperna-theme','dark')`);
    await sleep(250);
    out[w].darkShot = await shot(`citizen-dash-${w}-dark`);
    await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(out, null, 2), 'utf8');
  }
} catch (e) {
  out.error = String(e && e.stack ? e.stack : e);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ out: OUT, error: out.error || null }, null, 2));
}
