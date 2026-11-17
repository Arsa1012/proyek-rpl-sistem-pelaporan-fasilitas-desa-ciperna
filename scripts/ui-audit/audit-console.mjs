import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SignJWT } from 'jose';

const ROOT = 'C:\\xampp\\htdocs\\projeklatihan';
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-full-audit';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9900;
const BASE = 'http://localhost:3000';

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
const users = await prisma.user.findMany({
  where: { email: { in: ['admin@ciperna.id', 'citizen1@example.com', 'officer1@example.com'] } },
  select: { id: true, role: true, email: true, name: true, mustChangePassword: true },
});
const userByRole = Object.fromEntries(users.map((u) => [u.role, u]));
const secret = new TextEncoder().encode(env.JWT_SECRET);
const tokens = {};
for (const role of ['ADMIN', 'CITIZEN', 'OFFICER']) {
  const u = userByRole[role];
  tokens[role] = await new SignJWT({ userId: u.id, role: u.role, email: u.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(secret);
}
await prisma.$disconnect();

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, 'profile')}`,
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--hide-scrollbars',
  'about:blank',
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    try { if ((await ev('document.readyState')) === 'complete') return; } catch {}
    await sleep(200);
  }
}
async function goto(url) {
  await send('Page.navigate', { url });
  await sleep(500);
  await ready();
  await sleep(1800);
}
async function setRole(role) {
  await send('Network.setCookie', {
    name: 'session',
    value: tokens[role],
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    url: BASE,
  });
}

const events = [];
let currentPage = 'initial';
function add(evt) {
  if (events.length < 4000) events.push({ page: currentPage, ...evt });
}
const state = {};

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
    if (j.id && pending.has(j.id)) { pending.get(j.id)(j); return; }
    if (j.method === 'Runtime.consoleAPICalled') {
      const args = (j.params.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? a.type).join(' ');
      add({ kind: 'console', level: j.params.type, text: args });
    }
    if (j.method === 'Runtime.exceptionThrown') {
      const d = j.params.exceptionDetails;
      add({ kind: 'exception', text: d.text, description: d.exception?.description, url: d.url, line: d.lineNumber, column: d.columnNumber });
    }
    if (j.method === 'Log.entryAdded') {
      const e = j.params.entry;
      add({ kind: 'log', level: e.level, source: e.source, text: e.text, url: e.url, line: e.lineNumber });
    }
    if (j.method === 'Network.responseReceived') {
      const r = j.params.response;
      if (r.status >= 400) add({ kind: 'http', status: r.status, url: r.url, type: j.params.type, mime: r.mimeType });
    }
    if (j.method === 'Network.loadingFailed') {
      add({ kind: 'netfail', error: j.params.errorText, type: j.params.type, canceled: j.params.canceled });
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 771, deviceScaleFactor: 1, mobile: true });

  await setRole('ADMIN');
  currentPage = 'admin-dashboard';
  await goto(`${BASE}/admin/dashboard`);
  state.pageCheck = await ev(`({ href: location.href, title: document.title, hasSidebar: !!document.querySelector('.sidebar'), hasToggle: !!document.querySelector('.sidebar-toggle'), hasEmail: !!document.querySelector('input[type="email"]'), body: document.body.innerText.slice(0, 240) })`);
  console.log('PAGE CHECK', JSON.stringify(state.pageCheck, null, 2));
  state.adminDashboard = await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    const tgl = document.querySelector('.sidebar-toggle');
    const main = document.querySelector('.main-content');
    const pc = document.querySelector('.page-content');
    const r = (el) => el ? el.getBoundingClientRect() : null;
    const c = (el) => el ? getComputedStyle(el) : null;
    return {
      url: location.href,
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() || null,
      h2: document.querySelector('h2')?.textContent?.trim() || null,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebar: sb ? { position: c(sb).position, width: r(sb).width, left: r(sb).left, visibility: c(sb).visibility, transform: c(sb).transform, zIndex: c(sb).zIndex, overflowY: c(sb).overflowY, height: r(sb).height } : null,
      toggle: tgl ? { display: c(tgl).display, width: r(tgl).width, height: r(tgl).height } : null,
      main: main ? { marginLeft: c(main).marginLeft, width: r(main).width } : null,
      pageContent: pc ? { width: r(pc).width } : null,
      bodyScrollY: getComputedStyle(document.body).overflowY,
    };
  })()`);
  let s = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT, 'admin-400-closed.png'), Buffer.from(s.data, 'base64'));

  if (!state.pageCheck.hasToggle) {
    await fs.writeFile(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2));
    await fs.writeFile(path.join(OUT, 'events.json'), JSON.stringify(events, null, 2));
    console.log(JSON.stringify({ state, events: events.slice(0, 80) }, null, 2));
    throw new Error('Tidak ada .sidebar-toggle — halaman bukan dashboard (kemungkinan sesi tidak terpasang).');
  }

  await ev(`document.querySelector('.sidebar-toggle').click()`);
  await sleep(500);
  state.adminDrawer = await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    const nav = document.querySelector('.sidebar-nav');
    const foot = document.querySelector('.sidebar-user-section');
    const r = (el) => el ? el.getBoundingClientRect() : null;
    const c = (el) => el ? getComputedStyle(el) : null;
    const last = [...document.querySelectorAll('.sidebar-nav .sidebar-link')].pop();
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebar: { width: r(sb).width, left: r(sb).left, height: r(sb).height, visibility: c(sb).visibility, transform: c(sb).transform },
      bodyClass: document.body.className,
      bodyOverflowY: c(document.body).overflowY,
      nav: { clientH: nav.clientHeight, scrollH: nav.scrollHeight, overflowY: c(nav).overflowY, top: r(nav).top, bottom: r(nav).bottom },
      footer: { top: r(foot).top, bottom: r(foot).bottom },
      last: last ? { text: last.textContent.trim(), top: r(last).top, bottom: r(last).bottom } : null,
      toggleDisplay: c(document.querySelector('.sidebar-toggle')).display,
    };
  })()`);
  s = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT, 'admin-400-drawer.png'), Buffer.from(s.data, 'base64'));
  await ev(`document.querySelector('.sidebar-close').click()`);
  await sleep(500);

  // Klik menu "Daftar Laporan" untuk navigasi nyata.
  currentPage = 'admin-laporan-nav';
  await ev(`document.querySelector('.sidebar-toggle').click()`);
  await sleep(350);
  await ev(`[...document.querySelectorAll('.sidebar-nav .sidebar-link')].find(a => a.getAttribute('href') === '/admin/laporan').click()`);
  for (let i = 0; i < 30; i++) {
    if ((await ev('location.pathname')) === '/admin/laporan') break;
    await sleep(300);
  }
  await sleep(1500);
  state.afterNav = await ev(`({
    path: location.pathname,
    drawerOpen: document.querySelector('.sidebar')?.classList.contains('open'),
    bodyClass: document.body.className,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tabs: [...document.querySelectorAll('.report-view-tab')].map(a => a.textContent.trim()),
    table: (() => { const t = document.querySelector('.table-container'); return t ? { scrollW: t.scrollWidth, clientW: t.clientWidth, overflowX: getComputedStyle(t).overflowX } : null; })(),
  })`);

  currentPage = 'favicon-direct';
  await goto(`${BASE}/favicon.ico`);
  state.favicon = await ev(`({ url: location.href, body: document.body.innerText.slice(0, 120) })`);

  await fs.writeFile(path.join(OUT, 'state.json'), JSON.stringify(state, null, 2));
  await fs.writeFile(path.join(OUT, 'events.json'), JSON.stringify(events, null, 2));
  console.log(JSON.stringify({ state, events: events.slice(0, 120) }, null, 2));
} finally {
  try { await prisma.$disconnect(); } catch {}
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
