import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SignJWT } from 'jose';

const ROOT = process.cwd();
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-responsive-audit';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9902;
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
  prisma.assignment.findFirst({ where: { officer: { email: 'officer1@example.com' } }, orderBy: { assignedAt: 'desc' }, select: { id: true } }),
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
    if ((await ev('document.readyState')) === 'complete') return;
    await sleep(200);
  }
}

const VIEWPORTS = [
  { label: '320x700', width: 320, height: 700, mobile: true },
  { label: '360x800', width: 360, height: 800, mobile: true },
  { label: '375x812', width: 375, height: 812, mobile: true },
  { label: '400x771', width: 400, height: 771, mobile: true },
  { label: '768x1024', width: 768, height: 1024, mobile: true },
  { label: '1024x768', width: 1024, height: 768, mobile: false },
  { label: '1366x768', width: 1366, height: 768, mobile: false },
];

const ROUTES = [
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
  ['citizen-dashboard', 'CITIZEN', '/masyarakat/dashboard'],
  ['citizen-laporan', 'CITIZEN', '/masyarakat/laporan'],
  ['citizen-laporan-create', 'CITIZEN', '/masyarakat/laporan/create'],
  ['citizen-laporan-detail', 'CITIZEN', `/masyarakat/laporan/${citizenReport.id}`],
  ['citizen-profile', 'CITIZEN', '/masyarakat/profile'],
  ['officer-dashboard', 'OFFICER', '/petugas/dashboard'],
  ['officer-tugas', 'OFFICER', '/petugas/tugas'],
  ['officer-tugas-detail', 'OFFICER', `/petugas/tugas/${officerAssignment?.id || ''}`],
  ['officer-riwayat', 'OFFICER', '/petugas/riwayat'],
  ['officer-profile', 'OFFICER', '/petugas/profile'],
];

const DRAWER_PAGES = new Set(['admin-dashboard', 'admin-laporan', 'citizen-dashboard', 'officer-dashboard', 'admin-map']);

const measureExpr = `(() => {
  const vw = innerWidth;
  const vh = innerHeight;
  const sb = document.querySelector('.sidebar');
  const toggle = document.querySelector('.sidebar-toggle');
  const close = document.querySelector('.sidebar-close');
  const main = document.querySelector('.main-content');
  const pc = document.querySelector('.page-content');
  const nav = document.querySelector('.sidebar-nav');
  const footer = document.querySelector('.sidebar-user-section');
  const overlay = document.querySelector('.sidebar-backdrop');
  const cs = (el) => el ? getComputedStyle(el) : null;
  const rect = (el) => el ? el.getBoundingClientRect() : null;

  const tables = [...document.querySelectorAll('.table-container')].map((t) => {
    const s = getComputedStyle(t);
    return {
      scrollW: t.scrollWidth, clientW: t.clientWidth,
      overflowX: s.overflowX, rectRight: Math.round(t.getBoundingClientRect().right),
    };
  }).filter((t) => t.scrollW > t.clientW + 1 || t.rectRight > vw + 1);

  const inputs = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
    .filter((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0; })
    .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; })
    .filter((i) => i.right > vw + 2 || i.left < -2);

  const offscreen = [];
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
    offscreen.push({
      tag: el.tagName,
      cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
      left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
    });
    if (offscreen.length >= 6) break;
  }

  const visibleButtons = [...document.querySelectorAll('button:not([disabled]), a.btn, .sidebar-link, .sidebar-toggle, .sidebar-close')]
    .filter((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; })
    .map((el) => { const r = el.getBoundingClientRect(); return { text: (el.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((b) => b.w < 24 || b.h < 24);

  return {
    vw, vh,
    href: location.href,
    path: location.pathname,
    title: document.title,
    errorPage: /Internal Server Error|Application error|Unhandled Runtime Error/i.test(document.body?.innerText || ''),
    docOverflow: document.documentElement.scrollWidth - vw,
    bodyOverflow: document.body.scrollWidth - vw,
    bodyClass: document.body.className,
    bodyOverflowY: cs(document.body)?.overflowY,
    sidebar: sb ? {
      display: cs(sb).display, position: cs(sb).position, visibility: cs(sb).visibility,
      width: Math.round(rect(sb).width), left: Math.round(rect(sb).left),
      height: Math.round(rect(sb).height), transform: cs(sb).transform, open: sb.classList.contains('open'),
    } : null,
    toggle: toggle ? { display: cs(toggle).display, w: Math.round(rect(toggle).width), h: Math.round(rect(toggle).height) } : null,
    close: close ? { display: cs(close).display, w: Math.round(rect(close).width), h: Math.round(rect(close).height) } : null,
    overlay: overlay ? { display: cs(overlay).display, zIndex: cs(overlay).zIndex } : null,
    main: main ? { marginLeft: cs(main).marginLeft, width: Math.round(rect(main).width) } : null,
    pageContent: pc ? { left: Math.round(rect(pc).left), right: Math.round(rect(pc).right), width: Math.round(rect(pc).width) } : null,
    nav: nav ? { clientH: nav.clientHeight, scrollH: nav.scrollHeight, scrollTop: nav.scrollTop, overflowY: cs(nav).overflowY } : null,
    footer: footer ? { top: Math.round(rect(footer).top), bottom: Math.round(rect(footer).bottom), height: Math.round(rect(footer).height) } : null,
    tables, inputs, offscreen, smallTargets: visibleButtons.slice(0, 8),
  };
})()`;

const drawerExpr = `(() => {
  const vw = innerWidth;
  const vh = innerHeight;
  const sb = document.querySelector('.sidebar');
  const nav = document.querySelector('.sidebar-nav');
  const footer = document.querySelector('.sidebar-user-section');
  const close = document.querySelector('.sidebar-close');
  const overlay = document.querySelector('.sidebar-backdrop');
  const rect = (el) => el ? el.getBoundingClientRect() : null;
  const links = [...document.querySelectorAll('.sidebar-nav .sidebar-link')];
  const last = links[links.length - 1];
  return {
    vw, vh,
    open: sb?.classList.contains('open'),
    role: sb?.getAttribute('role'),
    ariaModal: sb?.getAttribute('aria-modal'),
    width: Math.round(rect(sb).width),
    left: Math.round(rect(sb).left),
    height: Math.round(rect(sb).height),
    navClientH: nav?.clientHeight,
    navScrollH: nav?.scrollHeight,
    navScrollTop: nav?.scrollTop,
    lastLink: last ? { text: last.textContent.trim().slice(0, 30), top: Math.round(rect(last).top), bottom: Math.round(rect(last).bottom) } : null,
    navRect: nav ? { top: Math.round(rect(nav).top), bottom: Math.round(rect(nav).bottom) } : null,
    footerTop: footer ? Math.round(rect(footer).top) : null,
    footerBottom: footer ? Math.round(rect(footer).bottom) : null,
    overlay: overlay ? { display: getComputedStyle(overlay).display, zIndex: getComputedStyle(overlay).zIndex } : null,
    bodyClass: document.body.className,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    active: document.activeElement ? { tag: document.activeElement.tagName, cls: document.activeElement.className, label: document.activeElement.getAttribute('aria-label') } : null,
    linksCount: links.length,
    linkOverflow: links.filter((a) => { const r = a.getBoundingClientRect(); return r.left < -1 || r.right > vw + 1; }).length,
  };
})()`;

async function setViewport(vp) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile,
    screenWidth: vp.width, screenHeight: vp.height,
  });
  await sleep(220);
}

async function closeDrawer() {
  const open = await ev(`document.querySelector('.sidebar')?.classList.contains('open')`);
  if (open) {
    await ev(`document.querySelector('.sidebar-close')?.click()`);
    await sleep(320);
  }
}

async function testDrawer() {
  await closeDrawer();
  await ev(`document.querySelector('.sidebar-toggle')?.click()`);
  await sleep(380);
  const opened = await ev(drawerExpr);

  // Gulir daftar menu sampai bawah dan pastikan tautan terakhir terjangkau.
  await ev(`(() => { const n = document.querySelector('.sidebar-nav'); if (n) n.scrollTop = n.scrollHeight; })()`);
  await sleep(180);
  const scrolled = await ev(drawerExpr);

  // Escape harus menutup dan mengembalikan fokus ke tombol menu.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(380);
  const afterEscape = await ev(`(() => ({
    open: document.querySelector('.sidebar')?.classList.contains('open'),
    bodyClass: document.body.className,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    active: document.activeElement ? { tag: document.activeElement.tagName, cls: document.activeElement.className, label: document.activeElement.getAttribute('aria-label') } : null,
  }))()`);

  // Buka lagi lalu tutup lewat backdrop.
  await ev(`document.querySelector('.sidebar-toggle')?.click()`);
  await sleep(320);
  await ev(`document.querySelector('.sidebar-backdrop')?.click()`);
  await sleep(320);
  const afterBackdrop = await ev(`(() => ({
    open: document.querySelector('.sidebar')?.classList.contains('open'),
    bodyClass: document.body.className,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
  }))()`);

  const widthOk = opened.width <= Math.round(opened.vw * 0.85) + 1;
  const heightOk = Math.abs(opened.height - opened.vh) <= 2;
  const navScrollable = opened.navScrollH >= opened.navClientH;
  const lastReachable = scrolled.lastLink && scrolled.navRect && scrolled.lastLink.top >= scrolled.navRect.top - 1 && scrolled.lastLink.bottom <= scrolled.navRect.bottom + 1;
  const footerInside = opened.footerBottom <= opened.vh + 1 && opened.footerTop >= 0;
  return {
    opened: { ...opened, vw: undefined, vh: undefined },
    scrolled,
    afterEscape,
    afterBackdrop,
    checks: {
      widthOk, heightOk, navScrollable, lastReachable, footerInside,
      overlayVisible: opened.overlay?.display !== 'none',
      bodyLocked: opened.bodyOverflowY === 'hidden' && opened.bodyClass.includes('drawer-open'),
      escapeClosed: !afterEscape.open && afterEscape.bodyOverflowY !== 'hidden' && !afterEscape.bodyClass.includes('drawer-open'),
      focusReturned: afterEscape.active?.cls?.includes('sidebar-toggle') || afterEscape.active?.label === 'Buka menu',
      backdropClosed: !afterBackdrop.open && afterBackdrop.bodyOverflowY !== 'hidden' && !afterBackdrop.bodyClass.includes('drawer-open'),
      noHorizontalLinkOverflow: opened.linkOverflow === 0,
      dialogSemantics: opened.role === 'dialog' && opened.ariaModal === 'true',
    },
  };
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
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

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

  const results = [];
  for (const [label, role, route] of ROUTES) {
    await setRole(role);
    await setViewport(VIEWPORTS[6]);
    await send('Page.navigate', { url: `${BASE}${route}` });
    await sleep(400);
    await waitReady();
    await sleep(1100);

    const perViewport = {};
    for (const vp of VIEWPORTS) {
      await setViewport(vp);
      await closeDrawer();
      const m = await ev(measureExpr);
      const drawer = DRAWER_PAGES.has(label) && vp.width <= 768 ? await testDrawer() : null;
      perViewport[vp.label] = { ...m, drawer };
    }
    results.push({ label, role: role || 'PUBLIC', route, perViewport });

    const parts = VIEWPORTS.map((vp) => {
      const m = perViewport[vp.label];
      const dbg = m.drawer ? (Object.values(m.drawer.checks).every(Boolean) ? 'drawer=ok' : 'DRAWER=FAIL') : '';
      const bad = [];
      const badTables = m.tables.filter((t) => !['auto', 'scroll'].includes(t.overflowX) || t.rectRight > vp.width + 1);
      if (m.docOverflow > 0) bad.push(`overflow=${m.docOverflow}`);
      if (badTables.length) bad.push(`tablesBad=${badTables.length}`);
      if (m.inputs.length) bad.push(`inputs=${m.inputs.length}`);
      if (m.offscreen.length) bad.push(`offscreen=${m.offscreen.length}`);
      if (m.errorPage) bad.push('ERRORPAGE');
      if (m.smallTargets.length) bad.push(`smallTargets=${m.smallTargets.length}`);
      return `${vp.width}:${bad.length ? bad.join(',') : 'ok'}${dbg ? ',' + dbg : ''}`;
    });
    console.log(`${label} | ${parts.join(' | ')}`);
  }

  await setViewport(VIEWPORTS[6]);
  await fs.writeFile(path.join(OUT, 'responsive.json'), JSON.stringify({ viewports: VIEWPORTS, results }, null, 2));
  console.log(`\nSaved ${results.length} routes to ${OUT}\\responsive.json`);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
