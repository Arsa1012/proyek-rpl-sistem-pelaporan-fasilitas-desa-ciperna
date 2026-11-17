import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SignJWT } from 'jose';

const ROOT = process.cwd();
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-drawer-extra';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9904;
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
await prisma.$disconnect();
const token = await new SignJWT({ userId: admin.id, role: admin.role, email: admin.email })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('2h')
  .sign(new TextEncoder().encode(env.JWT_SECRET));

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
  await sleep(260);
}
async function key(key, code, vk, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await sleep(120);
}
async function goto(route) {
  await send('Page.navigate', { url: `${BASE}${route}` });
  await sleep(450);
  await waitReady();
  await sleep(1200);
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

  const result = {};

  await viewport(400, 771);
  await goto('/admin/dashboard');
  await ev(`window.scrollTo(0, 240)`);
  await sleep(150);
  result.scrollBeforeOpen = await ev('window.scrollY');

  await ev(`document.querySelector('.sidebar-toggle')?.click()`);
  await sleep(420);
  result.open = await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    const ov = document.querySelector('.sidebar-backdrop');
    const r = (el) => el ? el.getBoundingClientRect() : null;
    return {
      open: sb?.classList.contains('open'),
      bodyClass: document.body.className,
      bodyOverflow: getComputedStyle(document.body).overflowY,
      scrollY: window.scrollY,
      overlay: ov ? { left: Math.round(r(ov).left), top: Math.round(r(ov).top), width: Math.round(r(ov).width), height: Math.round(r(ov).height), z: getComputedStyle(ov).zIndex } : null,
      sidebarZ: sb ? getComputedStyle(sb).zIndex : null,
      active: document.activeElement?.getAttribute('aria-label'),
    };
  })()`);

  // Gulir menu ke bawah, tutup, lalu buka lagi: posisi menu harus kembali ke atas.
  await ev(`(() => { const n = document.querySelector('.sidebar-nav'); if (n) n.scrollTop = n.scrollHeight; })()`);
  await sleep(150);
  result.navScrolledBeforeClose = await ev(`document.querySelector('.sidebar-nav')?.scrollTop || 0`);
  await ev(`document.querySelector('.sidebar-close')?.click()`);
  await sleep(380);
  await ev(`document.querySelector('.sidebar-toggle')?.click()`);
  await sleep(420);
  result.navResetOnReopen = await ev(`document.querySelector('.sidebar-nav')?.scrollTop ?? null`);

  // Perangkap fokus: Shift+Tab dari tombol tutup (elemen pertama) harus ke tautan terakhir.
  await ev(`document.querySelector('.sidebar-close')?.focus()`);
  await key('Tab', 'Tab', 9, 8);
  result.focusTrapBackward = await ev(`({
    tag: document.activeElement?.tagName,
    href: document.activeElement?.getAttribute('href'),
    text: (document.activeElement?.textContent || '').trim().slice(0, 40),
    isLast: document.activeElement === [...document.querySelectorAll('.sidebar a[href], .sidebar button:not([disabled])')].filter((el) => el.offsetParent !== null).pop(),
  })`);

  // Tab dari elemen terakhir harus kembali ke tombol tutup (elemen pertama).
  await key('Tab', 'Tab', 9, 0);
  result.focusTrapForward = await ev(`({
    tag: document.activeElement?.tagName,
    cls: document.activeElement?.className,
    label: document.activeElement?.getAttribute('aria-label'),
    isFirst: document.activeElement === [...document.querySelectorAll('.sidebar a[href], .sidebar button:not([disabled])')].filter((el) => el.offsetParent !== null)[0],
  })`);

  // Klik tautan menu harus menutup drawer dan melepas kunci gulir.
  await ev(`document.querySelector('.sidebar-link[href="/admin/profile"]')?.click()`);
  for (let i = 0; i < 40; i++) {
    if ((await ev('location.pathname')) === '/admin/profile') break;
    await sleep(200);
  }
  await sleep(900);
  result.afterNav = await ev(`({
    path: location.pathname,
    drawerOpen: document.querySelector('.sidebar')?.classList.contains('open'),
    bodyClass: document.body.className,
    bodyOverflow: getComputedStyle(document.body).overflowY,
    canScroll: (() => { window.scrollTo({ top: 120, behavior: 'instant' }); return window.scrollY > 0; })(),
  })`);

  // Kembali, buka drawer, lalu resize ke desktop: drawer harus tertutup & body tidak terkunci.
  await goto('/admin/dashboard');
  await ev(`document.querySelector('.sidebar-toggle')?.click()`);
  await sleep(350);
  await viewport(1024, 768);
  await sleep(450);
  result.afterResize = await ev(`(() => {
    const sb = document.querySelector('.sidebar');
    const tgl = document.querySelector('.sidebar-toggle');
    const r = (el) => el ? el.getBoundingClientRect() : null;
    return {
      width: innerWidth,
      drawerOpen: sb?.classList.contains('open'),
      sidebarVisible: getComputedStyle(sb).visibility,
      sidebarWidth: Math.round(r(sb).width),
      toggleDisplay: getComputedStyle(tgl).display,
      bodyClass: document.body.className,
      bodyOverflow: getComputedStyle(document.body).overflowY,
    };
  })()`);

  // Buka lagi di mobile, tutup lewat tombol X: fokus harus kembali ke toggle.
  await viewport(400, 771);
  await sleep(300);
  await ev(`document.querySelector('.sidebar-toggle')?.click()`);
  await sleep(380);
  await ev(`document.querySelector('.sidebar-close')?.click()`);
  await sleep(380);
  result.afterCloseButton = await ev(`({
    open: document.querySelector('.sidebar')?.classList.contains('open'),
    bodyClass: document.body.className,
    bodyOverflow: getComputedStyle(document.body).overflowY,
    activeCls: document.activeElement?.className,
    activeLabel: document.activeElement?.getAttribute('aria-label'),
  })`);

  // Screenshot bukti visual drawer 400 dan desktop 1024.
  await ev(`document.querySelector('.sidebar-toggle')?.click()`);
  await sleep(400);
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT, 'drawer-400.png'), Buffer.from(shot.data, 'base64'));
  await ev(`document.querySelector('.sidebar-close')?.click()`);
  await sleep(350);
  await viewport(1024, 768);
  await sleep(350);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT, 'desktop-1024.png'), Buffer.from(shot.data, 'base64'));

  await fs.writeFile(path.join(OUT, 'drawer-extra.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
