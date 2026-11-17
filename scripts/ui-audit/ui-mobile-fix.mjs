import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-mobile-fix';
const PORT = 9888;
const BASE = 'http://localhost:3000';
const profile = path.join(OUT, 'profile');
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
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
  const r = await send('Runtime.evaluate', {
    expression: script,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
async function ready() {
  for (let i = 0; i < 160; i++) {
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
async function waitFor(expr, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await ev(expr)) return true;
    } catch {}
    await sleep(200);
  }
  return false;
}
async function viewport(width, height, mobile = width <= 768) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  await sleep(350);
}

const results = {};

const measure = `(() => {
  const doc = document.documentElement;
  const sb = document.querySelector('.sidebar');
  const nav = document.querySelector('.sidebar-nav');
  const footer = document.querySelector('.sidebar-user-section');
  const toggle = document.querySelector('.sidebar-toggle');
  const close = document.querySelector('.sidebar-close');
  const rect = (el) => el ? el.getBoundingClientRect() : null;
  const cs = (el) => el ? getComputedStyle(el) : null;
  const links = [...document.querySelectorAll('.sidebar-nav .sidebar-link')];
  const last = links[links.length - 1];
  const s = rect(sb), n = rect(nav), f = rect(footer), t = rect(toggle), c = rect(close), l = rect(last);
  return {
    vw: innerWidth,
    vh: innerHeight,
    docScrollW: doc.scrollWidth,
    docClientW: doc.clientWidth,
    docScrollH: doc.scrollHeight,
    bodyOverflowY: cs(document.body).overflowY,
    bodyClass: document.body.className,
    sidebar: s && { left: Math.round(s.left), right: Math.round(s.right), width: Math.round(s.width), height: Math.round(s.height), top: Math.round(s.top), bottom: Math.round(s.bottom), visibility: cs(sb).visibility, transform: cs(sb).transform },
    nav: n && { top: Math.round(n.top), bottom: Math.round(n.bottom), clientH: nav.clientHeight, scrollH: nav.scrollHeight, scrollTop: Math.round(nav.scrollTop), overflowY: cs(nav).overflowY },
    footer: f && { top: Math.round(f.top), bottom: Math.round(f.bottom), height: Math.round(f.height) },
    toggle: t && { display: cs(toggle).display, w: Math.round(t.width), h: Math.round(t.height), top: Math.round(t.top), left: Math.round(t.left) },
    close: c && { display: cs(close).display, w: Math.round(c.width), h: Math.round(c.height), right: Math.round(c.right), top: Math.round(c.top) },
    lastLink: last && { text: last.textContent.trim(), top: Math.round(l.top), bottom: Math.round(l.bottom) },
    open: sb.classList.contains('open'),
  };
})()`;

async function openDrawer() {
  await ev(`document.querySelector('.sidebar-toggle').click()`);
  await sleep(450);
}

async function closeDrawer() {
  await ev(`document.querySelector('.sidebar-close').click()`);
  await sleep(450);
}

async function auditViewport(w, h, opts = {}) {
  await viewport(w, h);
  await goto(`${BASE}/admin/dashboard`);
  const out = { closed: await ev(measure) };

  if (w <= 768) {
    await openDrawer();
    out.open = await ev(measure);

    // Scroll menu sampai paling bawah lalu ukur keterjangkauan item terakhir.
    out.scroll = await ev(`(() => {
      const nav = document.querySelector('.sidebar-nav');
      const footer = document.querySelector('.sidebar-user-section');
      const links = [...nav.querySelectorAll('.sidebar-link')];
      const last = links[links.length - 1];
      nav.scrollTop = nav.scrollHeight;
      const nr = nav.getBoundingClientRect();
      const fr = footer.getBoundingClientRect();
      const lr = last.getBoundingClientRect();
      return {
        navScrollTop: Math.round(nav.scrollTop),
        maxScroll: Math.round(nav.scrollHeight - nav.clientHeight),
        lastText: last.textContent.trim(),
        lastBottom: Math.round(lr.bottom),
        navBottom: Math.round(nr.bottom),
        footerTop: Math.round(fr.top),
        lastVisible: lr.top >= nr.top - 1 && lr.bottom <= fr.top + 1,
        footerBelowNav: fr.top >= nr.bottom - 1,
        footerInsideDrawer: Math.round(fr.bottom) <= Math.round(document.querySelector('.sidebar').getBoundingClientRect().bottom) + 1,
      };
    })()`);
    await sleep(200);

    await closeDrawer();
    out.afterClose = await ev(measure);
    out.pageScroll = await ev(`(() => { window.scrollTo(0, 240); return { y: Math.round(window.scrollY), max: document.documentElement.scrollHeight - innerHeight }; })()`);
    await sleep(250);
    out.pageScrollAfter = await ev('Math.round(window.scrollY)');
    await ev('window.scrollTo(0, 0)');

    if (opts.escape) {
      await openDrawer();
      await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await sleep(450);
      out.escape = await ev(`({ open: document.querySelector('.sidebar').classList.contains('open'), bodyClass: document.body.className, overflowY: getComputedStyle(document.body).overflowY })`);
    }

    if (opts.overlay) {
      await openDrawer();
      await ev(`document.querySelector('.sidebar-backdrop').click()`);
      await sleep(450);
      out.overlay = await ev(`({ open: document.querySelector('.sidebar').classList.contains('open'), bodyClass: document.body.className })`);
    }

    if (opts.resize) {
      await openDrawer();
      out.beforeResize = await ev(`({ open: document.querySelector('.sidebar').classList.contains('open'), bodyClass: document.body.className })`);
      await viewport(1024, 768);
      await sleep(600);
      out.afterResize = await ev(`({ open: document.querySelector('.sidebar').classList.contains('open'), bodyClass: document.body.className, overflowY: getComputedStyle(document.body).overflowY, toggle: getComputedStyle(document.querySelector('.sidebar-toggle')).display, sidebarVisibility: getComputedStyle(document.querySelector('.sidebar')).visibility })`);
    }
  } else {
    out.desktop = await ev(`(() => {
      const sb = document.querySelector('.sidebar');
      const st = getComputedStyle(sb);
      const tg = getComputedStyle(document.querySelector('.sidebar-toggle'));
      return { position: st.position, visibility: st.visibility, width: Math.round(sb.getBoundingClientRect().width), toggle: tg.display, overflowY: getComputedStyle(document.body).overflowY };
    })()`);
  }

  return out;
}

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

  await viewport(400, 771);
  await goto(`${BASE}/login`);
  const login = await ev(`(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@ciperna.id', password: 'Admin123!' }) });
    return { status: r.status, body: await r.text() };
  })()`);
  results.login = login.status;

  // Menu audit: tidak boleh ada href duplikat.
  await goto(`${BASE}/admin/dashboard`);
  results.menuAudit = await ev(`(() => {
    const links = [...document.querySelectorAll('.sidebar-nav .sidebar-link')];
    const hrefs = links.map((a) => a.getAttribute('href'));
    const dup = hrefs.filter((h, i) => hrefs.indexOf(h) !== i);
    return { count: hrefs.length, hrefs, duplicates: [...new Set(dup)], labels: links.map((a) => a.textContent.trim()) };
  })()`);

  results.viewports = {};
  for (const [w, h] of [
    [320, 640],
    [360, 800],
    [375, 667],
    [400, 771],
    [768, 1024],
    [1024, 768],
    [1366, 768],
  ]) {
    results.viewports[`${w}x${h}`] = await auditViewport(w, h, {
      escape: w === 400,
      overlay: w === 400,
      resize: w === 400,
    });
  }

  // Uji navigasi menu: drawer harus tertutup dan halaman tujuan tampil.
  await viewport(400, 771);
  await goto(`${BASE}/admin/dashboard`);
  await openDrawer();
  await ev(`[...document.querySelectorAll('.sidebar-nav .sidebar-link')].find((a) => a.getAttribute('href') === '/admin/masyarakat').click()`);
  const navOk = await waitFor(`location.pathname === '/admin/masyarakat'`);
  await sleep(700);
  results.navClick = await ev(`({
    path: location.pathname,
    open: document.querySelector('.sidebar')?.classList.contains('open'),
    bodyClass: document.body.className,
    overflowY: getComputedStyle(document.body).overflowY,
    heading: document.querySelector('h2')?.textContent?.trim() || null,
    toggleVisible: getComputedStyle(document.querySelector('.sidebar-toggle')).display,
  })`);
  results.navClick.navigated = navOk;

  // Uji halaman laporan: satu menu, tab verifikasi tetap berfungsi.
  await goto(`${BASE}/admin/laporan?status=SUBMITTED`);
  results.reportTabs = await ev(`(() => {
    const tabs = [...document.querySelectorAll('.report-view-tab')].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href'), active: a.classList.contains('active'), aria: a.getAttribute('aria-current') }));
    return {
      tabs,
      heading: document.querySelector('h2')?.textContent?.trim() || null,
      sidebarLinks: [...document.querySelectorAll('.sidebar-nav .sidebar-link')].map((a) => a.getAttribute('href')),
      rows: document.querySelectorAll('table tbody tr').length,
      hasTableScroll: (() => { const t = document.querySelector('.table-container'); return t ? { scrollW: t.scrollWidth, clientW: t.clientWidth, overflowX: getComputedStyle(t).overflowX } : null; })(),
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);

  // Screenshot drawer terbuka 400x771 (terang) dan 390x844 (gelap).
  await viewport(400, 771);
  await goto(`${BASE}/admin/dashboard`);
  await openDrawer();
  await ev(`(() => { const n = document.querySelector('.sidebar-nav'); n.scrollTop = 0; })()`);
  await sleep(250);
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT, 'drawer-400-light.png'), Buffer.from(shot.data, 'base64'));
  await ev(`document.querySelector('.sidebar-nav').scrollTop = 9999`);
  await sleep(250);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT, 'drawer-400-light-bottom.png'), Buffer.from(shot.data, 'base64'));
  await ev(`document.querySelector('.sidebar-close').click()`);
  await sleep(300);

  await ev(`(async () => { await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@ciperna.id', password: 'Admin123!' }) }); return 1; })()`);
  await ev(`localStorage.setItem('theme', 'dark'); document.documentElement.setAttribute('data-theme', 'dark'); 1`);
  await viewport(390, 844);
  await goto(`${BASE}/admin/dashboard`);
  await ev(`document.documentElement.setAttribute('data-theme', 'dark')`);
  await openDrawer();
  await sleep(250);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(OUT, 'drawer-390-dark.png'), Buffer.from(shot.data, 'base64'));

  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  try {
    ws && ws.close();
  } catch {}
  chrome.kill();
}
