import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SignJWT } from 'jose';

const ROOT = process.cwd();
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-theme-audit';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9905;
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
const admin = await prisma.user.findUnique({ where: { email: 'admin@ciperna.id' }, select: { id: true, role: true, email: true } });
const citizen = await prisma.user.findUnique({ where: { email: 'citizen1@example.com' }, select: { id: true, role: true, email: true } });
await prisma.$disconnect();
const secret = new TextEncoder().encode(env.JWT_SECRET);
async function mint(user) {
  return new SignJWT({ userId: user.id, role: user.role, email: user.email })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('2h')
    .sign(secret);
}
const token = await mint(admin);
const citizenToken = await mint(citizen);

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(OUT, 'profile')}`,
  '--headless=new', '--enable-unsafe-swiftshader', '--no-first-run', '--hide-scrollbars', 'about:blank',
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
async function waitReady() {
  for (let i = 0; i < 160; i++) {
    if ((await ev('document.readyState')) === 'complete') return;
    await sleep(200);
  }
}
async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width <= 768,
    screenWidth: width, screenHeight: height,
  });
  await sleep(250);
}
async function goto(route) {
  await send('Page.navigate', { url: `${BASE}${route}` });
  await sleep(450);
  await waitReady();
  await sleep(1200);
}
async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}

const SELECTORS = [
  ['body', 'body'],
  ['title', 'h1'],
  ['topbar', '.topbar'],
  ['statCard', '.stat-card'],
  ['glassCard', '.glass'],
  ['tableHead', 'table thead th'],
  ['tableCell', 'table tbody td'],
  ['sidebar', '.sidebar'],
  ['sidebarLink', '.sidebar-link'],
  ['sidebarSection', '.sidebar-section-label'],
  ['badge', '.badge'],
  ['primaryBtn', '.btn-primary'],
  ['themeToggle', '.theme-toggle'],
  ['chatbotPanel', '.chatbot-panel'],
  ['chatbotAssistant', '.chatbot-msg-assistant'],
  ['chatbotChip', '.chatbot-chip'],
  ['loginCard', '.login-card'],
  ['loginInput', '.login-input'],
  ['loginBtn', '.login-button'],
  ['modalCard', '.modal-card'],
  ['modalText', '.modal-card p'],
  ['notifDropdown', '__NOTIF_DROPDOWN__'],
];

const snapshotExpr = `(() => {
  const out = {};
  const parse = (c) => c;
  const alpha = (c) => {
    if (!c || c === 'transparent') return 0;
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return 1;
    const parts = m[1].split(',').map((s) => s.trim());
    return parts.length === 4 ? Number(parts[3]) : 1;
  };
  const getNotif = () => {
    const btn = document.querySelector('button[aria-label="Notifikasi"]');
    if (!btn || !btn.parentElement) return null;
    return [...btn.parentElement.children].find((el) => el !== btn && getComputedStyle(el).position === 'absolute') || null;
  };
  for (const [key, sel] of ${JSON.stringify(SELECTORS)}) {
    let el = sel === '__NOTIF_DROPDOWN__' ? getNotif() : document.querySelector(sel);
    if (!el) { out[key] = null; continue; }
    const s = getComputedStyle(el);
    const chain = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const ns = getComputedStyle(n);
      chain.push({ bg: ns.backgroundColor, image: ns.backgroundImage });
      if (alpha(ns.backgroundColor) >= 0.999) break;
      n = n.parentElement;
    }
    const r = el.getBoundingClientRect();
    out[key] = {
      selector: sel,
      color: parse(s.color),
      bgChain: chain,
      backgroundImage: s.backgroundImage,
      borderColor: s.borderColor,
      fontSize: parseFloat(s.fontSize),
      fontWeight: Number(s.fontWeight) || 400,
      placeholder: (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
        ? getComputedStyle(el, '::placeholder').color
        : null,
      rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) },
    };
  }
  out.__theme = document.documentElement.dataset.theme || 'light';
  out.__storage = localStorage.getItem('ciperna-theme');
  out.__url = location.href;
  out.__vw = innerWidth;
  out.__docOverflow = document.documentElement.scrollWidth - innerWidth;
  return out;
})()`;

function parseColor(c) {
  if (!c) return null;
  if (c === 'transparent') return [0, 0, 0, 0];
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((s) => Number(s.trim()));
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}
function composite(fg, bg) {
  const a = fg[3];
  return [Math.round(fg[0] * a + bg[0] * (1 - a)), Math.round(fg[1] * a + bg[1] * (1 - a)), Math.round(fg[2] * a + bg[2] * (1 - a)), 1];
}
function luminance(rgb) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const a = Math.max(l1, l2);
  const b = Math.min(l1, l2);
  return (a + 0.05) / (b + 0.05);
}
function effectiveBg(info, theme) {
  const chain = info?.bgChain || [];
  let bg = theme === 'dark' ? [15, 23, 42, 1] : [240, 253, 244, 1];
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = parseColor(chain[i].bg);
    if (c && c[3] > 0) bg = composite(c, bg);
  }
  return bg;
}
function analyze(snap, theme, page, viewportLabel) {
  const rows = [];
  for (const [key] of SELECTORS) {
    const info = snap[key];
    if (!info) continue;
    let fg = parseColor(info.color);
    let bg = effectiveBg(info, theme);
    if (!fg) continue;
    const gradient = info.backgroundImage && info.backgroundImage !== 'none';
    if (['sidebar', 'sidebarLink', 'sidebarSection'].includes(key)) {
      bg = [15, 118, 110, 1];
    }
    if (gradient && ['primaryBtn', 'loginBtn'].includes(key)) {
      bg = [15, 118, 110, 1];
    }
    const ratio = contrast(fg, bg);
    const large = info.fontSize >= 24 || (info.fontSize >= 18.66 && info.fontWeight >= 700);
    rows.push({
      page, viewport: viewportLabel, key, selector: info.selector,
      color: info.color, bg: `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`,
      ratio: Number(ratio.toFixed(2)), large, gradient: Boolean(gradient),
      min: large ? 3 : 4.5, pass: ratio >= (large ? 3 : 4.5),
      placeholder: info.placeholder,
    });
    if (info.placeholder) {
      const p = parseColor(info.placeholder);
      if (p) {
        const pr = contrast(p, bg);
        rows.push({
          page, viewport: viewportLabel, key: key + '::placeholder', selector: info.selector,
          color: info.placeholder, bg: `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`,
          ratio: Number(pr.toFixed(2)), large: false, gradient: Boolean(gradient),
          min: 4.5, pass: pr >= 4.5,
        });
      }
    }
  }
  return rows;
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
  await send('Network.setCookie', {
    name: 'session', value: token, domain: 'localhost', path: '/',
    httpOnly: true, sameSite: 'Lax', secure: false, url: BASE,
  });

  const result = { snapshots: {}, contrast: [], checks: {} };

  await viewport(1366, 768);
  await goto('/admin/dashboard');
  // Mulai dari tema terang.
  await ev(`localStorage.setItem('ciperna-theme','light'); location.reload()`);
  await sleep(500);
  await waitReady();
  await sleep(1200);

  result.snapshots.dashboardLight = await ev(snapshotExpr);
  result.contrast.push(...analyze(result.snapshots.dashboardLight, 'light', 'admin-dashboard', '1366x768'));
  await screenshot('dashboard-light-1366.png');

  // Toggle nyata ke gelap.
  await ev(`document.querySelector('.theme-toggle')?.click()`);
  await sleep(500);
  result.snapshots.dashboardDark = await ev(snapshotExpr);
  result.contrast.push(...analyze(result.snapshots.dashboardDark, 'dark', 'admin-dashboard', '1366x768'));
  await screenshot('dashboard-dark-1366.png');

  // Persistensi setelah reload dan navigasi.
  await send('Page.reload');
  await sleep(500);
  await waitReady();
  await sleep(1200);
  const afterReload = await ev(snapshotExpr);
  result.checks.themePersistsReload = afterReload.__theme === 'dark' && afterReload.__storage === 'dark';
  await goto('/admin/laporan');
  const afterNav = await ev(snapshotExpr);
  result.checks.themePersistsNavigation = afterNav.__theme === 'dark' && afterNav.__storage === 'dark';
  result.checks.laporanDarkBody = afterNav.body?.color;

  // Dropdown notifikasi (mode gelap) desktop.
  await goto('/admin/dashboard');
  await ev(`document.querySelector('button[aria-label="Notifikasi"]')?.click()`);
  await sleep(400);
  result.snapshots.notifDark = await ev(snapshotExpr);
  result.contrast.push(...analyze(result.snapshots.notifDark, 'dark', 'notifikasi', '1366x768'));
  await screenshot('notification-dark-1366.png');
  await ev(`document.querySelector('button[aria-label="Notifikasi"]')?.click()`);
  await sleep(250);

  // Chatbot hanya tersedia untuk masyarakat. Uji dengan sesi CITIZEN.
  await send('Network.setCookie', {
    name: 'session', value: citizenToken, domain: 'localhost', path: '/',
    httpOnly: true, sameSite: 'Lax', secure: false, url: BASE,
  });
  await viewport(400, 771);
  await goto('/masyarakat/dashboard');
  await ev(`document.querySelector('.chatbot-fab')?.click()`);
  await sleep(500);
  result.snapshots.chatbotDark = await ev(snapshotExpr);
  result.contrast.push(...analyze(result.snapshots.chatbotDark, 'dark', 'chatbot', '400x771'));
  result.checks.chatbotFits = (() => {
    const r = result.snapshots.chatbotDark.chatbotPanel?.rect;
    return r ? r.left >= 0 && r.right <= 400 && r.top >= 0 && r.bottom <= 771 : false;
  })();
  await screenshot('chatbot-dark-400.png');
  // Tombol pertama ber-aria-label "Hapus percakapan"; tutup memakai tombol X.
  await ev(`document.querySelector('[aria-label="Tutup chatbot"]')?.click()`);
  await sleep(350);
  result.checks.chatbotClosed = !(await ev(`Boolean(document.querySelector('.chatbot-panel'))`));

  // Notifikasi gelap mobile.
  await ev(`document.querySelector('button[aria-label="Notifikasi"]')?.click()`);
  await sleep(400);
  result.snapshots.notifMobileDark = await ev(snapshotExpr);
  const nr = result.snapshots.notifMobileDark.notifDropdown?.rect;
  result.checks.notifFitsMobile = nr ? nr.left >= 0 && nr.right <= 400 : false;
  await screenshot('notification-dark-400.png');
  await ev(`document.querySelector('button[aria-label="Notifikasi"]')?.click()`);
  await sleep(250);

  // Modal pembatalan penugasan (tidak dikonfirmasi) di mode gelap.
  await send('Network.setCookie', {
    name: 'session', value: token, domain: 'localhost', path: '/',
    httpOnly: true, sameSite: 'Lax', secure: false, url: BASE,
  });
  await goto('/admin/assign');
  await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Batalkan Penugasan'))?.click()`);
  await sleep(500);
  result.snapshots.modalDark = await ev(snapshotExpr);
  result.contrast.push(...analyze(result.snapshots.modalDark, 'dark', 'modal', '400x771'));
  result.checks.modalFitsMobile = (() => {
    const r = result.snapshots.modalDark.modalCard?.rect;
    return r ? r.left >= 0 && r.right <= 400 && r.top >= 0 && r.bottom <= 771 : false;
  })();
  await screenshot('modal-dark-400.png');
  await ev(`[...document.querySelectorAll('.modal-card button')].find((b) => b.textContent.trim() === 'Batal')?.click()`);
  await sleep(300);

  // Halaman login gelap (tanpa cookie), lalu terang.
  await send('Network.deleteCookies', { name: 'session', domain: 'localhost', path: '/' });
  await goto('/login');
  result.snapshots.loginDark = await ev(snapshotExpr);
  result.contrast.push(...analyze(result.snapshots.loginDark, 'dark', 'login', '400x771'));
  await screenshot('login-dark-400.png');
  await ev(`document.querySelector('.theme-toggle')?.click()`);
  await sleep(400);
  result.snapshots.loginLight = await ev(snapshotExpr);
  result.contrast.push(...analyze(result.snapshots.loginLight, 'light', 'login', '400x771'));
  await screenshot('login-light-400.png');

  // Reduced motion: dashboard (sidebar/spinner) dan beranda (reveal).
  await send('Network.setCookie', {
    name: 'session', value: token, domain: 'localhost', path: '/',
    httpOnly: true, sameSite: 'Lax', secure: false, url: BASE,
  });
  await goto('/admin/dashboard');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(350);
  const pickExpr = `(() => {
    const pick = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    const reveal = document.querySelector('.reveal');
    return {
      revealAnimation: reveal ? getComputedStyle(reveal).animationName : 'no-reveal',
      sidebarTransition: pick('.sidebar', 'transitionDuration'),
      spinnerAnimation: pick('.spinner', 'animationName'),
      drawerToggleTransition: pick('.sidebar-toggle', 'transitionDuration'),
    };
  })()`;
  const reduceDashboard = await ev(pickExpr);
  await send('Network.deleteCookies', { name: 'session', domain: 'localhost', path: '/' });
  await goto('/');
  const reduceHome = await ev(`(() => {
    const el = document.querySelector('.reveal');
    const photo = document.querySelector('.hero-photo, .hero-illustration');
    return {
      revealAnimation: el ? getComputedStyle(el).animationName : null,
      revealOpacity: el ? getComputedStyle(el).opacity : null,
      heroAnimation: photo ? getComputedStyle(photo).animationName : null,
      dataReveal: document.documentElement.dataset.reveal || null,
    };
  })()`);
  result.checks.reducedMotion = { dashboard: reduceDashboard, home: reduceHome };
  await send('Emulation.setEmulatedMedia', { features: [] });

  result.failures = result.contrast.filter((r) => !r.pass);
  await fs.writeFile(path.join(OUT, 'theme.json'), JSON.stringify(result, null, 2));

  console.log('checks', JSON.stringify(result.checks, null, 2));
  console.log('theme', {
    light: result.snapshots.dashboardLight.__theme,
    dark: result.snapshots.dashboardDark.__theme,
    loginDark: result.snapshots.loginDark.__theme,
    loginLight: result.snapshots.loginLight.__theme,
  });
  console.log('contrast rows', result.contrast.length, 'failures', result.failures.length);
  for (const f of result.failures) console.log('FAIL', f.page, f.viewport, f.key, f.ratio, f.color, 'on', f.bg, f.min);
  console.log('saved', path.join(OUT, 'theme.json'));
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
