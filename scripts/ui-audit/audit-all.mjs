import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SignJWT } from 'jose';

const ROOT = process.cwd();
const OUT = process.env.AUDIT_OUT || 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-console-audit';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9901;
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
  select: { id: true, role: true, email: true },
});
const userByRole = Object.fromEntries(users.map((u) => [u.role, u]));
const [adminReport, citizenReport, officerAssignment, announcement] = await Promise.all([
  prisma.report.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } }),
  prisma.report.findFirst({ where: { user: { email: 'citizen1@example.com' } }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
  prisma.assignment.findFirst({ where: { officer: { email: 'officer1@example.com' } }, orderBy: { assignedAt: 'desc' }, select: { id: true, reportId: true } }),
  prisma.villageAnnouncement.findFirst({ where: { publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, select: { slug: true } }),
]);
await prisma.$disconnect();

const secret = new TextEncoder().encode(env.JWT_SECRET);
const tokens = {};
for (const [role, u] of Object.entries(userByRole)) {
  tokens[role] = await new SignJWT({ userId: u.id, role: u.role, email: u.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(secret);
}

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
  if (r.exceptionDetails) return { __evalError: r.exceptionDetails.text };
  return r.result.value;
}
async function waitReady() {
  for (let i = 0; i < 160; i++) {
    const state = await ev('document.readyState');
    if (state === 'complete') return;
    await sleep(200);
  }
}

let pageLabel = 'start';
let docResponses = [];
const events = [];
function add(evt) {
  if (events.length < 8000) events.push({ page: pageLabel, ...evt });
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
    if (j.id && pending.has(j.id)) { pending.get(j.id)(j); return; }
    if (j.method === 'Runtime.consoleAPICalled') {
      const args = (j.params.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? a.type).join(' ');
      add({ kind: 'console', level: j.params.type, text: args });
    }
    if (j.method === 'Runtime.exceptionThrown') {
      const d = j.params.exceptionDetails;
      add({ kind: 'exception', text: d.text, description: d.exception?.description, url: d.url, line: d.lineNumber });
    }
    if (j.method === 'Log.entryAdded') {
      const e = j.params.entry;
      add({ kind: 'log', level: e.level, source: e.source, text: e.text, url: e.url, line: e.lineNumber });
    }
    if (j.method === 'Network.responseReceived') {
      const r = j.params.response;
      if (j.params.type === 'Document') docResponses.push({ url: r.url, status: r.status });
      if (r.status >= 400) add({ kind: 'http', status: r.status, url: r.url, type: j.params.type, mime: r.mimeType });
    }
    if (j.method === 'Network.loadingFailed') {
      if (!j.params.canceled) add({ kind: 'netfail', error: j.params.errorText, type: j.params.type });
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });

  async function setRole(role) {
    if (!role) {
      await send('Network.deleteCookies', { name: 'session', domain: 'localhost', path: '/' });
      return;
    }
    await send('Network.setCookie', {
      name: 'session', value: tokens[role], domain: 'localhost', path: '/',
      httpOnly: true, sameSite: 'Lax', secure: false, url: BASE,
    });
  }

  async function visit(label, role, route) {
    pageLabel = label;
    docResponses = [];
    const start = events.length;
    await setRole(role);
    await send('Page.navigate', { url: `${BASE}${route}` });
    await sleep(500);
    await waitReady();
    await sleep(2200);
    const info = await ev(`(() => ({
      href: location.href,
      path: location.pathname,
      title: document.title,
      body: document.body?.innerText?.slice(0, 320) || '',
      hasError: /Internal Server Error|Application error|Unhandled Runtime Error/i.test(document.body?.innerText || ''),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewport: innerWidth + 'x' + innerHeight,
    }))()`);
    const pageEvents = events.slice(start);
    const significant = pageEvents.filter((e) => {
      if (e.kind === 'console') {
        if (e.level === 'error' || e.level === 'warning' || e.level === 'assert') return true;
        const t = String(e.text || '');
        if (t.includes('[Fast Refresh]') || t.includes('React DevTools') || t.includes('Download the React DevTools')) return false;
        return false;
      }
      if (e.kind === 'log') return e.level === 'error' || e.level === 'warning';
      return true;
    });
    return { label, role: role || 'PUBLIC', route, info, docResponses, events: significant };
  }

  const routes = [
    ['public-home', null, '/'],
    ['public-profil', null, '/profil-desa'],
    ['public-pemerintahan', null, '/pemerintahan'],
    ['public-layanan', null, '/layanan'],
    ['public-pengumuman', null, '/pengumuman'],
    ['public-pengumuman-detail', null, `/pengumuman/${announcement?.slug || 'pagi'}`],
    ['public-login', null, '/login'],
    ['public-register', null, '/register'],
    ['public-lupa-password', null, '/lupa-password'],
    ['public-reset-password', null, '/reset-password'],
    ['public-aktivasi', null, '/aktivasi'],

    ['admin-dashboard', 'ADMIN', '/admin/dashboard'],
    ['admin-asisten', 'ADMIN', '/admin/asisten'],
    ['admin-laporan', 'ADMIN', '/admin/laporan'],
    ['admin-laporan-verifikasi', 'ADMIN', '/admin/laporan?status=SUBMITTED'],
    ['admin-laporan-detail', 'ADMIN', `/admin/laporan/${adminReport.id}`],
    ['admin-duplikat', 'ADMIN', '/admin/duplikat'],
    ['admin-masyarakat', 'ADMIN', '/admin/masyarakat'],
    ['admin-wilayah', 'ADMIN', '/admin/wilayah'],
    ['admin-petugas', 'ADMIN', '/admin/petugas'],
    ['admin-profil-desa', 'ADMIN', '/admin/profil-desa'],
    ['admin-pemerintahan', 'ADMIN', '/admin/pemerintahan'],
    ['admin-layanan-desa', 'ADMIN', '/admin/layanan-desa'],
    ['admin-pengumuman', 'ADMIN', '/admin/pengumuman'],
    ['admin-assign', 'ADMIN', '/admin/assign'],
    ['admin-assignments', 'ADMIN', '/admin/assignments'],
    ['admin-statistik', 'ADMIN', '/admin/statistik'],
    ['admin-profile', 'ADMIN', '/admin/profile'],
    ['admin-map', 'ADMIN', '/admin/map'],
    ['admin-reports-legacy', 'ADMIN', '/admin/reports'],
    ['admin-reports-detail-legacy', 'ADMIN', `/admin/reports/${adminReport.id}`],

    ['citizen-dashboard', 'CITIZEN', '/masyarakat/dashboard'],
    ['citizen-lacak', 'CITIZEN', '/masyarakat/lacak'],
    ['citizen-laporan', 'CITIZEN', '/masyarakat/laporan'],
    ['citizen-laporan-create', 'CITIZEN', '/masyarakat/laporan/create'],
    ['citizen-laporan-detail', 'CITIZEN', `/masyarakat/laporan/${citizenReport.id}`],
    ['citizen-profile', 'CITIZEN', '/masyarakat/profile'],
    ['citizen-dashboard-legacy', 'CITIZEN', '/dashboard'],
    ['citizen-report-new-legacy', 'CITIZEN', '/dashboard/reports/new'],
    ['citizen-report-detail-legacy', 'CITIZEN', `/dashboard/reports/${citizenReport.id}`],

    ['officer-dashboard', 'OFFICER', '/petugas/dashboard'],
    ['officer-tugas', 'OFFICER', '/petugas/tugas'],
    ['officer-tugas-detail', 'OFFICER', `/petugas/tugas/${officerAssignment?.id || ''}`],
    ['officer-riwayat', 'OFFICER', '/petugas/riwayat'],
    ['officer-profile', 'OFFICER', '/petugas/profile'],
    ['officer-legacy', 'OFFICER', '/officer'],
    ['officer-task-legacy', 'OFFICER', `/officer/tasks/${officerAssignment?.id || ''}`],

    ['admin-ubah-password', 'ADMIN', '/ubah-password'],
  ];

  const results = [];
  const filter = process.env.AUDIT_FILTER ? new Set(process.env.AUDIT_FILTER.split(',')) : null;
  for (const [label, role, route] of routes) {
    if (filter && !filter.has(label)) continue;
    const result = await visit(label, role, route);
    results.push(result);
    console.log(`${label} | ${result.info.href} | ${result.docResponses.map((d) => d.status).join(',')} | overflow=${result.info.overflowX} | issues=${result.events.length}${result.info.hasError ? ' | ERROR PAGE' : ''}`);
  }

  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify({ results, events }, null, 2));
  console.log(`\nSaved ${results.length} page results; ${events.length} events.`);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
