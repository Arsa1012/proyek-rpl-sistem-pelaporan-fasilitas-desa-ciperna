import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SignJWT } from 'jose';

const ROOT = process.cwd();
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-dom-inspect';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.PORT || 9903);
const BASE = 'http://localhost:3000';
const PAGE = process.env.PAGE || '/admin/laporan';
const WIDTH = Number(process.env.WIDTH || 400);
const HEIGHT = Number(process.env.HEIGHT || 771);
const MODE = process.env.MODE || 'offscreen';
const ROLE = process.env.ROLE || 'ADMIN';

const env = {};
for (const line of (await fs.readFile(path.join(ROOT, '.env'), 'utf8')).split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const admin = await prisma.user.findUnique({ where: { email: 'admin@ciperna.id' }, select: { id: true, role: true, email: true } });
await prisma.$disconnect();
const token = await new SignJWT({ userId: admin.id, role: admin.role, email: admin.email })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('2h')
  .sign(new TextEncoder().encode(env.JWT_SECRET));

await fs.mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, 'profile-' + Date.now())}`,
  '--headless=new', '--enable-unsafe-swiftshader', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

try {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const p = (await r.json()).find((t) => t.type === 'page');
        if (p?.webSocketDebuggerUrl) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
      }
    } catch {}
    await sleep(200);
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data);
    if (j.id && pending.has(j.id)) pending.get(j.id)(j);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  if (ROLE !== 'NONE') {
    await send('Network.setCookie', {
      name: 'session', value: token, domain: 'localhost', path: '/',
      httpOnly: true, sameSite: 'Lax', secure: false, url: BASE,
    });
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 768,
    screenWidth: WIDTH, screenHeight: HEIGHT,
  });
  await send('Page.navigate', { url: `${BASE}${PAGE}` });
  await sleep(500);
  for (let i = 0; i < 100; i++) {
    if ((await ev('document.readyState')) === 'complete') break;
    await sleep(200);
  }
  await sleep(1500);

  const result = await ev(`(() => {
    const out = [];
    const vw = innerWidth;
    const describe = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        tag: el.tagName,
        cls: typeof el.className === 'string' ? el.className : '',
        id: el.id || '',
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 140),
        html: el.outerHTML.slice(0, 700),
        rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) },
        display: s.display, position: s.position, width: s.width, minWidth: s.minWidth, maxWidth: s.maxWidth,
        padding: s.padding, border: s.borderWidth, boxSizing: s.boxSizing, overflowX: s.overflowX,
        parent: el.parentElement ? { tag: el.parentElement.tagName, cls: el.parentElement.className, width: Math.round(el.parentElement.getBoundingClientRect().width), display: getComputedStyle(el.parentElement).display, overflowX: getComputedStyle(el.parentElement).overflowX } : null,
        grand: el.parentElement?.parentElement ? { tag: el.parentElement.parentElement.tagName, cls: el.parentElement.parentElement.className, width: Math.round(el.parentElement.parentElement.getBoundingClientRect().width), display: getComputedStyle(el.parentElement.parentElement).display, grid: getComputedStyle(el.parentElement.parentElement).gridTemplateColumns, overflowX: getComputedStyle(el.parentElement.parentElement).overflowX } : null,
      };
    };
    if ('${MODE}' === 'raw') {
      const els = [...document.querySelectorAll('.theme-toggle, .theme-toggle *')];
      const chain = [];
      let n = els[0];
      while (n && n !== document.documentElement) {
        const s = getComputedStyle(n);
        chain.push({
          tag: n.tagName,
          cls: typeof n.className === 'string' ? n.className : '',
          color: s.color,
          opacity: s.opacity,
          display: s.display,
          background: s.backgroundColor,
          filter: s.filter,
        });
        n = n.parentElement;
      }
      return {
        url: location.href,
        vw,
        html: els[0]?.outerHTML || null,
        els: els.map((el) => {
          const s = getComputedStyle(el);
          return {
            tag: el.tagName,
            cls: typeof el.className === 'string' ? el.className : '',
            color: s.color,
            opacity: s.opacity,
            stroke: s.stroke,
            fill: s.fill,
            width: s.width,
            height: s.height,
          };
        }),
        chain,
        rootVars: {
          textPrimary: getComputedStyle(document.documentElement).getPropertyValue('--text-primary'),
          theme: document.documentElement.dataset.theme || null,
        },
      };
    }
    if ('${MODE}' === 'small') {
      for (const el of document.querySelectorAll('button:not([disabled]), a.btn, .sidebar-link, .sidebar-toggle, .sidebar-close')) {
        const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        if (s.display === 'none' || s.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
        if (r.width < 24 || r.height < 24) out.push(describe(el));
        if (out.length >= 12) break;
      }
    } else {
      for (const el of document.querySelectorAll('main *')) {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
        if (s.pointerEvents === 'none') continue;
        if (el.closest('.sidebar,.sidebar-backdrop,.landing-mobile-menu,.chatbot-panel,.modal-overlay,.leaflet-container,.hero-parallax-ring')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right <= vw + 2 && r.left >= -2) continue;
        let scroller = false;
        let p = el.parentElement;
        while (p && p !== document.body) {
          const ps = getComputedStyle(p);
          if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') { scroller = true; break; }
          p = p.parentElement;
        }
        if (scroller) continue;
        out.push(describe(el));
        if (out.length >= 12) break;
      }
    }
    return { url: location.href, vw, docOverflow: document.documentElement.scrollWidth - vw, out };
  })()`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
