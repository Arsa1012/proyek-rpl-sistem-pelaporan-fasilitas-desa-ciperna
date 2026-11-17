import fs from 'node:fs/promises';
import path from 'node:path';
import { SignJWT } from 'jose';

const ROOT = process.cwd();
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
  where: { email: { in: ['admin@ciperna.id', 'citizen1@example.com', 'citizen2@example.com', 'officer1@example.com', 'officer2@example.com'] } },
  select: { id: true, role: true, email: true, name: true, isActive: true },
});
const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));

// Fallback: cari warga/petugas kedua dari database bila email fixture berbeda.
const anyCitizen = byEmail['citizen2@example.com'] || await prisma.user.findFirst({
  where: { role: 'CITIZEN', email: { not: 'citizen1@example.com' } },
  select: { id: true, role: true, email: true, name: true, isActive: true },
  orderBy: { createdAt: 'asc' },
});
const anyOfficer = byEmail['officer2@example.com'] || await prisma.user.findFirst({
  where: { role: 'OFFICER', email: { not: 'officer1@example.com' } },
  select: { id: true, role: true, email: true, name: true, isActive: true },
  orderBy: { createdAt: 'asc' },
});

const citizen2Report = anyCitizen ? await prisma.report.findFirst({
  where: { userId: anyCitizen.id },
  orderBy: { createdAt: 'desc' },
  select: { id: true, title: true, userId: true },
}) : null;
const officer1Assignment = byEmail['officer1@example.com'] ? await prisma.assignment.findFirst({
  where: { officerId: byEmail['officer1@example.com'].id, cancelledAt: null },
  orderBy: { assignedAt: 'desc' },
  select: { id: true, reportId: true, officerId: true },
}) : null;
const officer2Assignment = anyOfficer ? await prisma.assignment.findFirst({
  where: { officerId: anyOfficer.id, cancelledAt: null },
  orderBy: { assignedAt: 'desc' },
  select: { id: true, reportId: true, officerId: true },
}) : null;
const citizen1Report = byEmail['citizen1@example.com'] ? await prisma.report.findFirst({
  where: { userId: byEmail['citizen1@example.com'].id },
  orderBy: { createdAt: 'desc' },
  select: { id: true, userId: true },
}) : null;
const citizen2Notification = anyCitizen ? await prisma.notification.findFirst({
  where: { userId: anyCitizen.id },
  orderBy: { createdAt: 'desc' },
  select: { id: true, userId: true },
}) : null;
await prisma.$disconnect();

const secret = new TextEncoder().encode(env.JWT_SECRET);
async function mint(user) {
  if (!user) return null;
  return new SignJWT({ userId: user.id, role: user.role, email: user.email })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('2h')
    .sign(secret);
}
const tokens = {
  ADMIN: await mint(byEmail['admin@ciperna.id']),
  CITIZEN: await mint(byEmail['citizen1@example.com']),
  OFFICER: await mint(byEmail['officer1@example.com']),
  CITIZEN2: await mint(anyCitizen),
  OFFICER2: await mint(anyOfficer),
};

async function call(route, role, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (role && tokens[role]) headers.cookie = `session=${tokens[role]}`;
  const res = await fetch(`${BASE}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return {
    status: res.status,
    location: res.headers.get('location'),
    setCookie: res.headers.get('set-cookie'),
    contentType: res.headers.get('content-type'),
    text: text.slice(0, 500),
    json,
  };
}

const rows = [];
function record(name, result, expected, extra = {}) {
  const ok = Array.isArray(expected) ? expected.includes(result.status) : result.status === expected;
  rows.push({ name, status: result.status, location: result.location, ok, expected, ...extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${result.status}${result.location ? ` -> ${result.location}` : ''} | expected ${Array.isArray(expected) ? expected.join('/') : expected}`);
}

// ---------- Halaman ----------
for (const [route, label] of [
  ['/admin/dashboard', 'admin dashboard'],
  ['/petugas/dashboard', 'officer dashboard'],
  ['/masyarakat/dashboard', 'citizen dashboard'],
]) {
  record(`page ${label} tanpa login`, await call(route), [302, 307]);
}
record('page admin oleh citizen', await call('/admin/dashboard', 'CITIZEN'), [302, 307]);
record('page admin oleh officer', await call('/admin/dashboard', 'OFFICER'), [302, 307]);
record('page officer oleh citizen', await call('/petugas/dashboard', 'CITIZEN'), [302, 307]);
record('page citizen oleh officer', await call('/masyarakat/dashboard', 'OFFICER'), [302, 307]);
record('page admin oleh admin', await call('/admin/dashboard', 'ADMIN'), 200);
record('page officer oleh officer', await call('/petugas/dashboard', 'OFFICER'), 200);
record('page citizen oleh citizen', await call('/masyarakat/dashboard', 'CITIZEN'), 200);

// ---------- API inti ----------
record('API stats tanpa login', await call('/api/admin/stats'), 401);
record('API stats oleh citizen', await call('/api/admin/stats', 'CITIZEN'), 403);
record('API stats oleh officer', await call('/api/admin/stats', 'OFFICER'), 403);
record('API stats oleh admin', await call('/api/admin/stats', 'ADMIN'), 200);

record('API notifications tanpa login', await call('/api/notifications'), 401);
const notif = await call('/api/notifications', 'CITIZEN');
record('API notifications citizen', notif, 200);
const notifOwn = notif.json?.notifications?.every((n) => n.userId === byEmail['citizen1@example.com']?.id);
rows.push({ name: 'notifications hanya milik sendiri', ok: notifOwn !== false, detail: notifOwn });

record('API admin users tanpa login', await call('/api/admin/users'), 401);
record('API admin users citizen', await call('/api/admin/users', 'CITIZEN'), 403);
record('API admin users officer', await call('/api/admin/users', 'OFFICER'), 403);
record('API daftar petugas citizen', await call('/api/officers', 'CITIZEN'), 403);
record('API daftar petugas officer', await call('/api/officers', 'OFFICER'), 403);
const officersRes = await call('/api/officers', 'ADMIN');
record('API daftar petugas admin', officersRes, 200);
const officersLeak = JSON.stringify(officersRes.json || {}).match(/password|passwordHash/i);
rows.push({ name: 'respons daftar petugas tanpa password', ok: !officersLeak, leak: officersLeak?.[0] || null });
record('API admin wilayah citizen', await call('/api/admin/regions', 'CITIZEN'), 403);
record('API admin wilayah admin', await call('/api/admin/regions', 'ADMIN'), 200);
record('API admin map citizen', await call('/api/admin/map', 'CITIZEN'), [401, 403]);
record('API admin pengumuman citizen', await call('/api/admin/village/announcements', 'CITIZEN'), 403);
record('API admin pengumuman admin', await call('/api/admin/village/announcements', 'ADMIN'), 200);
record('API admin activation link citizen', anyOfficer ? await call(`/api/admin/officers/${anyOfficer.id}/activation-link`, 'CITIZEN', { method: 'POST' }) : { status: 403 }, 403);
record('API admin duplikat citizen', await call('/api/admin/duplicates', 'CITIZEN'), 403);
record('API admin duplikat admin', await call('/api/admin/duplicates', 'ADMIN'), 200);
const usersRes = await call('/api/admin/users', 'ADMIN');
record('API admin users admin', usersRes, 200);
const usersLeak = JSON.stringify(usersRes.json || {}).match(/password|passwordHash/i);
rows.push({ name: 'respons admin users tanpa password', ok: !usersLeak, leak: usersLeak?.[0] || null });

record('API whatsapp logs citizen', await call('/api/admin/whatsapp-logs', 'CITIZEN'), 403);
const waLogs = await call('/api/admin/whatsapp-logs', 'ADMIN');
record('API whatsapp logs admin', waLogs, 200);
const waLeak = JSON.stringify(waLogs.json || {}).match(/FONNTE|token|authorization/i);
rows.push({ name: 'respons WhatsApp logs tanpa token', ok: !waLeak, leak: waLeak?.[0] || null });

record('API admin AI status citizen', await call('/api/admin/ai/chat', 'CITIZEN'), 403);
const aiStatus = await call('/api/admin/ai/chat', 'ADMIN');
record('API admin AI status admin', aiStatus, 200);
// Nama provider boleh tampil; yang dilarang adalah nilai/field rahasia.
const aiLeak = JSON.stringify(aiStatus.json || {}).match(/sk-or-|api_?key|OPENROUTER_API_KEY/i);
rows.push({ name: 'respons status AI tanpa API key', ok: !aiLeak, leak: aiLeak?.[0] || null });

record('API test-wa tanpa login', await call('/api/test-wa'), 401);
record('API test-wa citizen', await call('/api/test-wa', 'CITIZEN'), 403);
record('API test-wa admin GET (tanpa kirim)', await call('/api/test-wa', 'ADMIN'), 200);

record('API cron tanpa secret/login', await call('/api/cron/village'), 401);
record('API cron oleh citizen', await call('/api/cron/village', 'CITIZEN'), 401);

// ---------- Laporan & assignment ----------
record('API reports tanpa login', await call('/api/reports'), 401);
const reportsCitizen = await call('/api/reports?limit=100', 'CITIZEN');
record('API reports citizen', reportsCitizen, 200);
const onlyOwn = reportsCitizen.json?.reports?.every((r) => r.userId === byEmail['citizen1@example.com']?.id);
rows.push({ name: 'daftar laporan citizen hanya milik sendiri', ok: onlyOwn !== false, detail: onlyOwn });

const reportsOfficer = await call('/api/reports?limit=100', 'OFFICER');
record('API reports officer', reportsOfficer, 200);
const officerReportIds = new Set(reportsOfficer.json?.reports?.map((r) => r.id) || []);
const allowedOfficerIds = new Set(
  (await (async () => {
    const p = new PrismaClient();
    const a = await p.assignment.findMany({
      where: { officerId: byEmail['officer1@example.com']?.id, cancelledAt: null },
      select: { reportId: true },
    });
    await p.$disconnect();
    return a.map((x) => x.reportId);
  })())
);
const officerScopeOk = [...officerReportIds].every((id) => allowedOfficerIds.has(id));
rows.push({ name: 'daftar laporan officer hanya yang ditugaskan', ok: officerScopeOk, count: officerReportIds.size });

const otherReport = citizen2Report?.id || '';
if (otherReport) {
  record('detail laporan warga lain oleh citizen1', await call(`/api/reports/${otherReport}`, 'CITIZEN'), 403);
  record('detail laporan warga lain oleh officer1', await call(`/api/reports/${otherReport}`, 'OFFICER'), 403);
  record('detail laporan warga lain oleh admin', await call(`/api/reports/${otherReport}`, 'ADMIN'), 200);
}
if (citizen1Report?.id) {
  record('detail laporan sendiri oleh citizen1', await call(`/api/reports/${citizen1Report.id}`, 'CITIZEN'), 200);
}
if (officer1Assignment?.reportId) {
  record('detail laporan yang ditugaskan ke officer1', await call(`/api/reports/${officer1Assignment.reportId}`, 'OFFICER'), 200);
}
if (officer2Assignment?.reportId) {
  record('detail laporan milik officer2 oleh officer1', await call(`/api/reports/${officer2Assignment.reportId}`, 'OFFICER'), 403);
}

record('API assignments citizen', await call('/api/assignments', 'CITIZEN'), 403);
const assignmentsOfficer = await call('/api/assignments?limit=100', 'OFFICER');
record('API assignments officer', assignmentsOfficer, 200);
const assignmentScopeOk = assignmentsOfficer.json?.assignments?.every((a) => a.officerId === byEmail['officer1@example.com']?.id);
rows.push({ name: 'daftar assignment officer hanya milik sendiri', ok: assignmentScopeOk !== false, detail: assignmentScopeOk });
record('API assignments admin', await call('/api/assignments?limit=5', 'ADMIN'), 200);

if (officer2Assignment?.id) {
  record('detail assignment officer2 oleh officer1', await call(`/api/assignments/${officer2Assignment.id}`, 'OFFICER'), 403);
  record('detail assignment officer2 oleh admin', await call(`/api/assignments/${officer2Assignment.id}`, 'ADMIN'), 200);
}
if (officer1Assignment?.id) {
  record('detail assignment sendiri oleh officer1', await call(`/api/assignments/${officer1Assignment.id}`, 'OFFICER'), 200);
  record('DELETE assignment oleh officer1', await call(`/api/assignments/${officer1Assignment.id}`, 'OFFICER', { method: 'DELETE' }), 403);
  record('PATCH COMPLETED oleh officer (harus lewat bukti)', await call(`/api/reports/${officer1Assignment.reportId}`, 'OFFICER', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'COMPLETED' }) }), 403);
}
if (citizen1Report?.id) {
  record('PATCH laporan oleh citizen', await call(`/api/reports/${citizen1Report.id}`, 'CITIZEN', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'COMPLETED' }) }), 403);
}
if (citizen2Notification?.id) {
  const notifCross = await call(`/api/notifications/${citizen2Notification.id}`, 'CITIZEN', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ read: true }),
  });
  record('PATCH notifikasi milik warga lain', notifCross, 403);
}

// ---------- Validasi auth tanpa mengirim WhatsApp ----------
const badLogin = await call('/api/auth/login', null, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'citizen1@example.com', password: 'salah-password' }),
});
record('login password salah', badLogin, 401);
const badLoginLeak = JSON.stringify(badLogin.json || {}).match(/passwordHash|password:/i);
rows.push({ name: 'respons login gagal tanpa hash', ok: !badLoginLeak, leak: badLoginLeak?.[0] || null });

const goodLogin = await call('/api/auth/login', null, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'citizen1@example.com', password: 'password123' }),
});
record('login citizen valid', goodLogin, 200);
rows.push({
  name: 'cookie login HttpOnly + SameSite',
  ok: /HttpOnly/i.test(goodLogin.setCookie || '') && /SameSite=Lax/i.test(goodLogin.setCookie || ''),
  setCookie: (goodLogin.setCookie || '').replace(/session=[^;]+/, 'session=<redacted>'),
});
const loginLeak = JSON.stringify(goodLogin.json || {}).match(/passwordHash|password:/i);
rows.push({ name: 'respons login sukses tanpa hash', ok: !loginLeak, leak: loginLeak?.[0] || null });
record('logout', await call('/api/auth/logout', 'CITIZEN', { method: 'POST' }), 200);

record('register body kosong', await call('/api/auth/register', null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), [400, 422]);
record('aktivasi token tidak valid', await call('/api/auth/activate', null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'invalid' }) }), [400, 404, 422]);
record('reset password token tidak valid', await call('/api/auth/reset-password', null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'invalid', password: 'Password123!' }) }), [400, 404, 422]);
record('lupa password email tidak dikenal', await call('/api/auth/forgot-password', null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'tidak-ada-xyz-12345@example.invalid' }) }), [200, 400, 404]);

// ---------- Ringkasan ----------
const failed = rows.filter((r) => !r.ok);
const out = {
  timestamp: new Date().toISOString(),
  fixtures: {
    citizen2: anyCitizen?.email || null,
    officer2: anyOfficer?.email || null,
    citizen2Report: citizen2Report?.id || null,
    officer1Assignment: officer1Assignment?.id || null,
    officer2Assignment: officer2Assignment?.id || null,
  },
  total: rows.length,
  passed: rows.length - failed.length,
  failed,
  rows,
};
await fs.mkdir('C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-security', { recursive: true });
await fs.writeFile('C:\\Users\\USER\\AppData\\Local\\Temp\\opencode\\ui-security\\matrix.json', JSON.stringify(out, null, 2));
console.log(`\n${out.passed}/${out.total} checks passed; failures=${failed.length}`);
for (const f of failed) console.log('FAILED:', f.name, f.status, f.expected, f.location || '');
