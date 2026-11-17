/**
 * Tes KONTEKS LIVE CHATBOT.
 *
 * Fokus:
 * - Konteks selalu berisi identitas desa, user, statistik, dan laporan terbaru.
 * - Cakupan data mengikuti role (warga = milik sendiri, petugas = tugas sendiri).
 * - Tidak ada email/password/token yang masuk ke konteks.
 * - Konteks dapat diformat menjadi system prompt yang memuat fakta live.
 *
 * Jalankan: npm test
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

/**
 * Fixture: tes ini berfokus pada ISI PROMPT (konteks live), bukan pada
 * kebijakan model gratis. Modul `aiModelPolicy` dinonaktifkan agar SEMUA model
 * dianggap terverifikasi — tanpa menulis apa pun ke database produksi.
 *
 * Impor modul app dilakukan DINAMIS (setelah stub terpasang) karena impor
 * statis akan dieksekusi lebih dulu oleh loader.
 */
let prisma!: typeof import('../src/lib/prisma').prisma;
let loadLiveChatContext!: typeof import('../src/lib/aiContext').loadLiveChatContext;
let formatLiveChatContext!: typeof import('../src/lib/aiContext').formatLiveChatContext;
let synthesizeAnswer!: typeof import('../src/lib/aiChat').synthesizeAnswer;
let wibLabel!: typeof import('../src/lib/aiTools').wibLabel;

before(async () => {
  const policyPath = require.resolve(path.join(process.cwd(), 'src/lib/aiModelPolicy.ts'));
  const realPolicy = require(policyPath);
  const fakePolicy = Object.create(realPolicy);
  Object.defineProperty(fakePolicy, 'filterAllowedModels', {
    value: (_provider: string, models: string[]) => ({ allowed: [...models], blocked: [] }),
    configurable: true,
    writable: true,
  });
  const policyCache = require.cache[policyPath];
  if (policyCache) policyCache.exports = fakePolicy;

  prisma = (await import('../src/lib/prisma')).prisma;
  const ctx = await import('../src/lib/aiContext');
  loadLiveChatContext = ctx.loadLiveChatContext;
  formatLiveChatContext = ctx.formatLiveChatContext;
  synthesizeAnswer = (await import('../src/lib/aiChat')).synthesizeAnswer;
  wibLabel = (await import('../src/lib/aiTools')).wibLabel;
});

after(async () => {
  await prisma.$disconnect();
});

test('konteks masyarakat hanya memuat laporan miliknya sendiri', async () => {
  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN', reports: { some: {} } },
    select: { id: true, name: true },
  });
  assert.ok(citizen, 'fixture: butuh warga yang punya laporan');

  const context = await loadLiveChatContext('CITIZEN', citizen.id);

  assert.equal(context.user.name, citizen.name);
  assert.equal(context.user.role, 'CITIZEN');
  assert.ok(context.reportStats, 'statistik desa harus tersedia');
  assert.ok(context.myReports, 'statistik laporan pribadi harus tersedia');
  assert.equal(context.recentReportsScope, 'laporan milik pengguna yang sedang login');

  const ownRecent = await prisma.report.findMany({
    where: { userId: citizen.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { title: true, location: true, status: true, createdAt: true },
  });

  assert.equal(context.myReports!.total, await prisma.report.count({ where: { userId: citizen.id } }));
  assert.deepEqual(
    context.recentReports.map((r) => `${r.title}|${r.location}|${r.status}|${r.createdAtWib}`),
    ownRecent.map((r) => `${r.title}|${r.location}|${r.status}|${wibLabel(r.createdAt)}`),
    'daftar terbaru warga harus persis laporan miliknya, bukan laporan warga lain'
  );
});

test('konteks petugas hanya memuat tugas yang ditugaskan kepadanya', async () => {
  const officer = await prisma.user.findFirst({
    where: { role: 'OFFICER', assignments: { some: { cancelledAt: null } } },
    select: { id: true, name: true },
  });
  assert.ok(officer, 'fixture: butuh petugas dengan penugasan aktif');

  const context = await loadLiveChatContext('OFFICER', officer.id);

  assert.equal(context.user.name, officer.name);
  assert.equal(context.user.role, 'OFFICER');
  assert.ok(context.myTasks, 'ringkasan tugas harus tersedia');
  assert.ok(context.userStats, 'statistik akun harus tersedia untuk Petugas');
  assert.equal(
    context.userStats!.totalOfficers,
    await prisma.user.count({ where: { role: 'OFFICER' } })
  );
  assert.equal(context.myTasks!.total, await prisma.assignment.count({
    where: { officerId: officer.id, cancelledAt: null },
  }));
  assert.equal(context.recentReportsScope, 'tugas yang ditugaskan kepada petugas yang sedang login');

  const ownAssignments = await prisma.assignment.findMany({
    where: { officerId: officer.id, cancelledAt: null },
    orderBy: { assignedAt: 'desc' },
    take: 5,
    select: { report: { select: { title: true, location: true, status: true } } },
  });
  assert.deepEqual(
    context.recentReports.map((r) => `${r.title}|${r.location}|${r.status}`),
    ownAssignments.map((a) => `${a.report.title}|${a.report.location}|${a.report.status}`),
    'tugas terbaru petugas tidak boleh berisi laporan petugas lain'
  );
});

test('konteks admin memuat statistik desa dan antrean tindak lanjut', async () => {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true, name: true },
  });
  assert.ok(admin, 'fixture: butuh akun admin');

  const context = await loadLiveChatContext('ADMIN', admin.id);

  assert.equal(context.user.name, admin.name);
  assert.equal(context.user.role, 'ADMIN');
  assert.ok(context.reportStats, 'statistik desa harus tersedia');
  assert.equal(context.reportStats!.total, await prisma.report.count());
  const processing = context.reportStats!.byStatus
    .filter((s) => ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW'].includes(s.code))
    .reduce((sum, s) => sum + s.count, 0);
  assert.equal(context.reportStats!.processing, processing, 'total diproses harus mencakup seluruh status penanganan');
  assert.ok(context.adminQueues, 'antrean admin harus tersedia');
  assert.ok(context.userStats, 'statistik akun harus tersedia untuk Admin');
  assert.equal(
    context.userStats!.totalCitizens,
    await prisma.user.count({ where: { role: 'CITIZEN' } })
  );
  assert.equal(
    context.userStats!.totalOfficers,
    await prisma.user.count({ where: { role: 'OFFICER' } })
  );
  assert.equal(
    context.userStats!.inactiveAccounts,
    await prisma.user.count({
      where: { isActive: false, role: { in: ['CITIZEN', 'OFFICER'] } },
    })
  );
  assert.equal(
    context.recentReportsScope,
    'laporan desa yang paling membutuhkan tindakan Admin (verifikasi/penugasan/bukti)'
  );
  assert.equal(context.recentReports.length, Math.min(5, await prisma.report.count()));

  const adminPrompt = formatLiveChatContext(context);
  assert.ok(adminPrompt.includes('Statistik akun pengguna: total warga'));
  assert.ok(adminPrompt.includes('akun nonaktif (warga+petugas)'));
  assert.ok(adminPrompt.includes('yang paling membutuhkan tindakan Admin'));

  // Laporan prioritas harus berada di depan: SUBMITTED/REVIEW/VERIFIED lebih
  // dahulu daripada status lain yang hanya menjadi pelengkap.
  const actionStatuses = new Set(['SUBMITTED', 'REVIEW', 'VERIFIED']);
  const firstNonAction = context.recentReports.findIndex((r) => !actionStatuses.has(r.status));
  if (firstNonAction !== -1) {
    assert.equal(
      context.recentReports.slice(firstNonAction).every((r) => !actionStatuses.has(r.status)),
      true,
      'laporan non-tindakan tidak boleh mendahului laporan yang butuh tindakan'
    );
  }
});

test('prompt live memuat profil desa, user, statistik, dan laporan terbaru tanpa rahasia', async () => {
  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN', reports: { some: {} } },
    select: { id: true, name: true },
  });
  assert.ok(citizen, 'fixture: butuh warga yang punya laporan');

  const context = await loadLiveChatContext('CITIZEN', citizen.id);
  const prompt = formatLiveChatContext(context);

  assert.ok(prompt.includes('Desa Ciperna'), prompt);
  assert.ok(prompt.includes('Kecamatan Talun'), prompt);
  assert.ok(prompt.includes('Kabupaten Cirebon'), prompt);
  assert.ok(prompt.includes(context.village.adminWhatsapp), prompt);
  assert.ok(prompt.includes(citizen.name), prompt);
  assert.ok(prompt.includes('User Aktif'), prompt);
  assert.ok(prompt.includes('Statistik laporan desa: Total'), prompt);
  assert.ok(prompt.includes('diproses (VERIFIED/ASSIGNED/IN_PROGRESS/REVIEW)'), prompt);
  assert.ok(prompt.includes('Laporan/tugas terbaru'), prompt);
  assert.equal(/password|token|api key|secret|email/i.test(prompt), false, 'prompt tidak boleh memuat rahasia');
});

test('synthesizeAnswer mengirim KONTEKS LIVE di system prompt tanpa memanggil jaringan', async () => {
  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN', reports: { some: {} } },
    select: { id: true, name: true },
  });
  assert.ok(citizen, 'fixture: butuh warga yang punya laporan');

  const context = await loadLiveChatContext('CITIZEN', citizen.id);
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;
  let captured: any = null;

  process.env.OPENROUTER_API_KEY = 'test-key';
  global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body || '{}'));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Desa Ciperna berada di Kecamatan Talun, Kabupaten Cirebon.' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const result = await synthesizeAnswer(
      'CITIZEN',
      [],
      'Di mana Desa Ciperna dan bagaimana kondisi laporannya?',
      [],
      citizen.name,
      context
    );
    assert.ok(result.answer.includes('Kecamatan Talun'));

    const system = captured.messages[0];
    const user = captured.messages[1];
    assert.equal(system.role, 'system');
    // Prompt dapat dikirim dalam versi lengkap atau ringkas (hemat token),
    // tetapi KONTEKS LIVE dan identitas sesi WAJIB tetap berada di system prompt.
    assert.ok(system.content.includes('KONTEKS LIVE DATABASE'), 'konteks live harus berada di system prompt');
    // formatLiveChatContext outputs "Peran: Masyarakat / CITIZEN" (roleLabel/role)
    assert.ok(system.content.includes('Peran: Masyarakat'), 'peran pengguna harus berasal dari sesi');
    assert.ok(system.content.includes('Asisten AI'), 'identitas asisten harus ada di system prompt');
    assert.ok(system.content.includes('Kecamatan Talun'));
    assert.ok(system.content.includes('@syajehh'));
    assert.ok(system.content.includes(context.village.adminWhatsapp));
    assert.ok(system.content.includes(`Total ${context.reportStats!.total}`));
    assert.ok(system.content.includes(citizen.name));
    assert.ok(/read-only|READ-ONLY/i.test(system.content), 'batas baca-saja harus tetap dinyatakan');
    assert.ok(user.content.includes('Tidak ada query tool tambahan'));
    assert.equal(system.content.includes('test-key'), false, 'API key tidak boleh masuk prompt');
    assert.equal(system.content.includes('password123'), false, 'kata sandi tidak boleh masuk prompt');
    assert.equal(system.content.includes('JWT_SECRET'), false, 'secret tidak boleh masuk prompt');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});
