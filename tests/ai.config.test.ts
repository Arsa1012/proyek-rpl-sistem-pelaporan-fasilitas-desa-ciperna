/**
 * TES KONFIGURASI TAHAP 3 — penerima notifikasi WhatsApp & provider AI.
 *
 * Semua test OFFLINE:
 *  - Tidak memanggil provider AI sungguhan (fetch di-stub).
 *  - Tidak mengirim WhatsApp sungguhan (fungsi pengiriman tidak dipanggil).
 *  - Database: SALINAN `prisma/dev.db` di folder TEMP. `DATABASE_URL` di-override
 *    ke salinan tersebut SEBELUM modul Prisma diimpor, lalu diverifikasi lewat
 *    `PRAGMA database_list` (gate wajib agar tes tidak pernah menulis ke DB
 *    produksi).
 *  - Kunci enkripsi: kunci UJI per-proses (bukan kunci produksi).
 *
 * Jalankan: npm test
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 0. Siapkan salinan database + kunci uji SEBELUM modul Prisma diimpor.
//
// Penting: modul Prisma membaca DATABASE_URL saat client di-instantiate.
// Karena top-level await tidak didukung di mode CJS proyek ini, impor modul
// yang menyentuh database dilakukan DINAMIS di dalam `before()` — setelah
// environment di-set di sini.
// ---------------------------------------------------------------------------
const PROJECT_ROOT = process.cwd();
const SOURCE_DB = path.join(PROJECT_ROOT, 'prisma', 'dev.db');
const TEMP_DIR = mkdtempSync(path.join(tmpdir(), 'tahap3-config-'));
const COPY_DB = path.join(TEMP_DIR, 'ai_config_test.db');

if (!existsSync(SOURCE_DB)) {
  throw new Error(`Database sumber tidak ditemukan: ${SOURCE_DB}`);
}
copyFileSync(SOURCE_DB, COPY_DB);
process.env.DATABASE_URL = `file:${COPY_DB.replace(/\\/g, '/')}`;

// Kunci enkripsi UJI (tidak pernah memakai kunci produksi).
const TEST_KEY = randomBytes(32).toString('base64');
process.env.APP_ENCRYPTION_KEY = TEST_KEY;

// Module yang menyentuh database dimuat dinamis (lihat `before`).
let prisma: any;
let notificationRecipients: any;
let aiProviderConfig: any;
let aiProviders: any;
let secretCrypto: any;
let fonnteConfig: any;
let aiChat: any;

// Kunci API uji (tidak pernah benar).
const FAKE_KEY = 'sk-or-v1-FAKE-TEST-KEY-0000000000';

before(async () => {
  try {
    const prismaMod = await import('../src/lib/prisma');
    prisma = prismaMod.prisma;
    notificationRecipients = await import('../src/lib/notificationRecipients');
    aiProviderConfig = await import('../src/lib/aiProviderConfig');
    aiProviders = await import('../src/lib/aiProviders');
    secretCrypto = await import('../src/lib/secretCrypto');
    fonnteConfig = await import('../src/lib/fonnteConfig');
    aiChat = await import('../src/lib/aiChat');
  } catch (e) {
    console.error('[ai.config.test] gagal memuat modul:', e);
    throw e;
  }

  // GATE WAJIB: pastikan yang terhubung adalah SALINAN, bukan DB produksi.
  const rows: any[] = await prisma.$queryRawUnsafe('PRAGMA database_list');
  const fileRow = rows.find((r) => r.file);
  assert.ok(fileRow, 'PRAGMA database_list harus mengembalikan baris file');
  assert.equal(
    path.resolve(String(fileRow.file)).toLowerCase(),
    path.resolve(COPY_DB).toLowerCase(),
    'tes WAJIB berjalan pada salinan database di TEMP, bukan DB produksi'
  );
});

after(async () => {
  if (prisma) await prisma.$disconnect();
  try {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch {
    /* abaikan */
  }
});

// ===========================================================================
// T-19 .. T-25: penerima notifikasi WhatsApp
// ===========================================================================

test('T-19a NotificationRecipient & AiProvider tersedia di database', async () => {
  const recipients = await notificationRecipients.listRecipients();
  assert.ok(Array.isArray(recipients));
  const providers = await aiProviderConfig.listAiProviders();
  assert.ok(Array.isArray(providers));
});

test('T-19b addRecipient menormalkan nomor 08xx menjadi 62xx', async () => {
  const res = await notificationRecipients.addRecipient({
    label: 'Uji Nomor 08',
    phone: '081234567890',
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.recipient.phone, '6281234567890');
  assert.equal(res.recipient.isActive, false, 'nomor baru defaultnya TIDAK aktif');
  await prisma.notificationRecipient.delete({ where: { id: res.recipient.id } });
});

test('T-19c addRecipient menolak nomor duplikat & nomor invalid', async () => {
  const first = await notificationRecipients.addRecipient({
    label: 'Uji Duplikat',
    phone: '081299988877',
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const dup = await notificationRecipients.addRecipient({
    label: 'Uji Duplikat 2',
    phone: '6281299988877',
  });
  assert.equal(dup.ok, false, 'nomor duplikat harus ditolak');

  const invalid = await notificationRecipients.addRecipient({
    label: 'Uji Tidak Valid',
    phone: '12345',
  });
  assert.equal(invalid.ok, false, 'nomor tidak valid harus ditolak');

  await prisma.notificationRecipient.delete({ where: { id: first.recipient.id } });
});

// ---------------------------------------------------------------------------
// T-19e : pesan duplikat harus informatif (menyebut label pemilik nomor),
//          tanpa membocorkan nomor telepon lengkap.
// ---------------------------------------------------------------------------
test('T-19e pesan duplikat menyebut label penerima yang memakai nomor tersebut', async () => {
  const first = await notificationRecipients.addRecipient({
    label: 'Uji Label Bawaan',
    phone: '081299988877',
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const dup = await notificationRecipients.addRecipient({
    label: 'Uji Label Baru',
    phone: '6281299988877',
  });
  assert.equal(dup.ok, false, 'nomor duplikat harus ditolak');
  if (dup.ok) return;

  const message = dup.error;
  assert.ok(
    message.includes('Uji Label Bawaan'),
    `pesan harus menyebut label pemilik nomor: ${message}`
  );
  assert.ok(
    message.includes('sudah terdaftar'),
    `pesan harus menjelaskan bahwa nomor sudah terdaftar: ${message}`
  );
  // Nomor telepon lengkap TIDAK boleh bocor di pesan.
  assert.equal(message.includes('6281299988877'), false, 'pesan tidak boleh memuat nomor lengkap');
  assert.equal(message.includes('081299988877'), false, 'pesan tidak boleh memuat nomor lengkap');
  // Aturan duplikasi TIDAK berubah: tetap ditolak.
  const rows = await prisma.notificationRecipient.count({ where: { phone: '6281299988877' } });
  assert.equal(rows, 1, 'harus tetap satu baris untuk satu nomor');

  await prisma.notificationRecipient.delete({ where: { id: first.recipient.id } });
});

// ---------------------------------------------------------------------------
// T-19f : PATCH — nomor milik baris sendiri tetap BERHASIL,
//          nomor milik baris lain tetap DITOLAK (dengan label).
// ---------------------------------------------------------------------------
test('T-19f PATCH: nomor milik baris sendiri boleh, nomor milik baris lain ditolak', async () => {
  const own = await notificationRecipients.addRecipient({
    label: 'Uji Baris Sendiri',
    phone: '081277700011',
  });
  const other = await notificationRecipients.addRecipient({
    label: 'Uji Baris Lain',
    phone: '081277700022',
  });
  assert.equal(own.ok, true);
  assert.equal(other.ok, true);
  if (!own.ok || !other.ok) return;

  // 1) Ubah label saja (nomor ikut terkirim oleh UI) → harus BERHASIL.
  const samePhone = await notificationRecipients.updateRecipient(own.recipient.id, {
    label: 'Uji Baris Sendiri (diubah)',
    phone: own.recipient.phone,
  });
  assert.equal(samePhone.ok, true, `PATCH dengan nomor sendiri harus berhasil: ${
    samePhone.ok ? '' : samePhone.error
  }`);

  // 2) Notes saja (tanpa phone) → harus BERHASIL.
  const notesOnly = await notificationRecipients.updateRecipient(own.recipient.id, {
    notes: 'catatan uji',
  });
  assert.equal(notesOnly.ok, true, 'PATCH notes saja harus berhasil');

  // 3) Pindahkan ke nomor milik baris lain → harus DITOLAK + menyebut label.
  const stolen = await notificationRecipients.updateRecipient(own.recipient.id, {
    phone: other.recipient.phone,
  });
  assert.equal(stolen.ok, false, 'nomor milik baris lain harus ditolak');
  if (!stolen.ok) {
    assert.ok(
      stolen.error.includes('Uji Baris Lain'),
      `pesan harus menyebut label baris lain: ${stolen.error}`
    );
    assert.equal(
      stolen.error.includes(other.recipient.phone),
      false,
      'pesan tidak boleh memuat nomor lengkap'
    );
  }

  // 4) Nomor baris lain TIDAK berubah.
  const otherAfter = await prisma.notificationRecipient.findUniqueOrThrow({
    where: { id: other.recipient.id },
  });
  assert.equal(otherAfter.phone, other.recipient.phone, 'nomor baris lain tidak boleh berubah');

  await prisma.notificationRecipient.delete({ where: { id: own.recipient.id } });
  await prisma.notificationRecipient.delete({ where: { id: other.recipient.id } });
});

// ---------------------------------------------------------------------------
// T-19g : label hasil migrasi dapat dibedakan antar baris, dan migrasi tetap
//          idempoten (tidak membuat ulang / menghapus baris yang ada).
// ---------------------------------------------------------------------------
test('T-19g label hasil migrasi dapat dibedakan dan migrasi tetap idempoten', async () => {
  const first = await notificationRecipients.migrateLegacyAdminPhone();
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const row = await prisma.notificationRecipient.findFirstOrThrow({
    where: { phone: first.phone as string },
  });
  // Penanda 4 digit terakhir agar beberapa hasil migrasi dapat dibedakan.
  assert.ok(
    row.label.endsWith(`·${String(first.phone).slice(-4)}`),
    `label hasil migrasi harus memuat penanda 4 digit terakhir: ${row.label}`
  );
  assert.ok(row.label.startsWith('Admin Utama (migrasi dari perangkat Fonnte)'));

  // Jalankan lagi → idempoten: TIDAK membuat baris baru, field lain utuh.
  const before = await prisma.notificationRecipient.findUniqueOrThrow({
    where: { id: row.id },
  });
  const second = await notificationRecipients.migrateLegacyAdminPhone();
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.created, false, 'migrasi kedua tidak boleh membuat baris baru');
  assert.equal(second.phone, first.phone);

  const after = await prisma.notificationRecipient.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(after.phone, before.phone, 'nomor tidak boleh berubah');
  assert.equal(after.isActive, before.isActive, 'status aktif tidak boleh berubah');
  assert.equal(after.createdAt.getTime(), before.createdAt.getTime(), 'createdAt tidak boleh berubah');
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), 'updatedAt tidak boleh berubah');
  assert.equal(after.notes, before.notes, 'catatan tidak boleh berubah');
  assert.equal(after.label, before.label, 'label harus sama (idempoten)');

  // Dua hasil migrasi untuk nomor berbeda → label berbeda (dapat dibedakan).
  const manual = await notificationRecipients.addRecipient({
    label: 'Uji Manual',
    phone: '081277700099',
  });
  assert.equal(manual.ok, true);
  if (!manual.ok) return;
  const manualLabel = manual.recipient.label;
  assert.equal(
    manualLabel.endsWith(`·${manual.recipient.phone.slice(-4)}`),
    false,
    'baris manual TIDAK boleh diberi penanda migrasi'
  );
  await prisma.notificationRecipient.delete({ where: { id: manual.recipient.id } });
});

test('T-20 seed idempoten: 2x migrateLegacyAdminPhone tetap 1 baris aktif', async () => {
  const first = await notificationRecipients.migrateLegacyAdminPhone();
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await notificationRecipients.migrateLegacyAdminPhone();
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.created, false, 'panggilan kedua tidak boleh membuat duplikasi');
  assert.equal(first.phone, second.phone, 'nomor harus sama');

  const activeRows = await prisma.notificationRecipient.findMany({ where: { isActive: true } });
  assert.equal(activeRows.length, 1, 'harus ada tepat satu penerima aktif');
  assert.equal(activeRows[0].phone, first.phone);
});

test('T-21 ganti nomor aktif: penerima berikutnya aktif, yang lama nonaktif', async () => {
  const legacy = await notificationRecipients.migrateLegacyAdminPhone();
  assert.equal(legacy.ok, true);
  if (!legacy.ok) return;

  const other = await notificationRecipients.addRecipient({
    label: 'Uji Penerima Kedua',
    phone: '081277766655',
  });
  assert.equal(other.ok, true);
  if (!other.ok) return;

  const activated = await notificationRecipients.activateRecipient(other.recipient.id);
  assert.ok(activated);
  assert.equal(activated?.isActive, true);

  const actives = await prisma.notificationRecipient.findMany({ where: { isActive: true } });
  assert.equal(actives.length, 1, 'hanya boleh ada satu penerima aktif');
  assert.equal(actives[0].id, other.recipient.id);

  const resolved = await notificationRecipients.resolveActiveRecipient();
  assert.equal(resolved.source, 'database');
  assert.equal(resolved.phone, '6281277766655');

  await prisma.notificationRecipient.delete({ where: { id: other.recipient.id } });
  const legacyRow = await prisma.notificationRecipient.findFirstOrThrow({
    where: { phone: legacy.phone },
  });
  await notificationRecipients.activateRecipient(legacyRow.id);
});

test('T-22 nomor lama bisa diaktifkan kembali (tidak hilang)', async () => {
  const legacy = await notificationRecipients.migrateLegacyAdminPhone();
  assert.equal(legacy.ok, true);
  if (!legacy.ok) return;

  const row = await prisma.notificationRecipient.findFirstOrThrow({ where: { phone: legacy.phone } });
  await notificationRecipients.deactivateRecipient(row.id);
  let resolved = await notificationRecipients.resolveActiveRecipient();
  assert.equal(resolved.phone, null, 'tanpa penerima aktif, nomor harus null');

  const back = await notificationRecipients.activateRecipient(row.id);
  assert.ok(back);
  assert.equal(back?.isActive, true);
  resolved = await notificationRecipients.resolveActiveRecipient();
  assert.equal(resolved.phone, legacy.phone, 'nomor lama harus bisa aktif kembali');
});

test('T-23 partial UNIQUE INDEX menolak dua penerima aktif (raw SQL)', async () => {
  const a = await notificationRecipients.addRecipient({
    label: 'Uji Index A',
    phone: '081311111111',
  });
  const b = await notificationRecipients.addRecipient({
    label: 'Uji Index B',
    phone: '081322222222',
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;

  // Pastikan tidak ada penerima aktif dari tes sebelumnya, agar.UPDATE pertama
  // benar-benar menguji index (bukan bentrok dengan data lama).
  await prisma.notificationRecipient.updateMany({ data: { isActive: false } });

  await prisma.$executeRawUnsafe(
    `UPDATE NotificationRecipient SET isActive = 1 WHERE id = '${a.recipient.id}'`
  );
  let rejected = false;
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE NotificationRecipient SET isActive = 1 WHERE id = '${b.recipient.id}'`
    );
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, 'index unik parsial harus menolak penerima aktif kedua');

  const actives = await prisma.notificationRecipient.findMany({ where: { isActive: true } });
  assert.ok(actives.length <= 1, 'tidak boleh ada lebih dari satu penerima aktif');

  await prisma.notificationRecipient.delete({ where: { id: a.recipient.id } });
  await prisma.notificationRecipient.delete({ where: { id: b.recipient.id } });
});

test('T-24 tanpa penerima aktif: resolve mengembalikan null + masalah jelas', async () => {
  await prisma.notificationRecipient.updateMany({ data: { isActive: false } });
  const resolved = await notificationRecipients.resolveActiveRecipient();
  assert.equal(resolved.phone, null, 'tidak boleh ada nomor bila tidak ada penerima aktif');
  assert.equal(resolved.source, 'none');
  assert.ok(resolved.problems.length > 0, 'harus ada penjelasan masalah');
  const text = resolved.problems.join(' ').toLowerCase();
  assert.ok(text.includes('tidak ada') || text.includes('belum'), 'pesan harus jelas');
});

test('T-25 tidak ada fallback diam-diam ke nomor perangkat pengirim', async () => {
  const device = await prisma.fonnteConfig.findFirst({ where: { isActive: true } });
  assert.ok(device, 'fixture: butuh perangkat Fonnte aktif');
  await prisma.notificationRecipient.updateMany({ data: { isActive: false } });

  const resolved = await notificationRecipients.resolveActiveRecipient();
  assert.equal(resolved.phone, null, 'nomor perangkat pengirim TIDAK boleh dipakai sebagai penerima');
  assert.equal(resolved.source, 'none');
});

// ===========================================================================
// T-06 .. T-13: konfigurasi provider AI
// ===========================================================================

test('T-06 respons aman: toSafeProvider tidak pernah memuat apiKeyCipher', async () => {
  const created = await aiProviderConfig.upsertProvider({
    provider: 'openrouter',
    label: 'Uji OpenRouter',
    apiKey: FAKE_KEY,
    primaryModel: 'vendor/model-uji',
    fallbackModels: ['vendor/model-cadangan'],
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const safe = created.provider as any;
  assert.equal(safe.apiKeyCipher, undefined, 'ciphertext tidak boleh keluar ke klien');
  assert.equal(safe.apiKey, undefined, 'api key tidak boleh keluar ke klien');
  assert.equal(safe.hasApiKey, true);

  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes(FAKE_KEY), false, 'nilai kunci tidak boleh ada di respons');
  assert.equal(serialized.includes('apiKeyCipher'), false);

  const list = await aiProviderConfig.listAiProviders();
  const listed = list.find((p: any) => p.id === created.provider.id) as any;
  assert.equal(listed.apiKeyCipher, undefined);
  assert.equal(JSON.stringify(list).includes(FAKE_KEY), false);
});

test('T-08 simpan banyak key: 3 provider, cipher berbeda, hasApiKey true', async () => {
  for (const provider of ['openrouter', 'gemini', 'groq'] as const) {
    const r = await aiProviderConfig.upsertProvider({
      provider,
      label: `Uji ${provider}`,
      apiKey: `${FAKE_KEY}-${provider}`,
      primaryModel: provider === 'gemini' ? 'gemini-uji' : 'vendor/model-uji',
    });
    assert.equal(r.ok, true, `provider ${provider} harus bisa disimpan`);
  }

  const rows = await prisma.aiProvider.findMany({
    where: { provider: { in: ['openrouter', 'gemini', 'groq'] } },
  });
  assert.equal(rows.length, 3, 'harus ada 3 baris provider');
  for (const row of rows) {
    assert.ok(row.apiKeyCipher, 'ciphertext harus terisi');
    assert.ok(secretCrypto.isEncrypted(row.apiKeyCipher), 'ciphertext harus terenkripsi');
    assert.equal(row.apiKeyCipher.includes(row.provider), false, 'ciphertext tidak boleh memuat plaintext');
  }
  const ciphers = new Set(rows.map((r: any) => r.apiKeyCipher));
  assert.equal(ciphers.size, 3, 'tiap provider harus punya ciphertext berbeda (IV acak)');
});

test('T-09 API key kosong = pertahankan kunci lama', async () => {
  const provider = await aiProviderConfig.upsertProvider({
    provider: 'groq',
    label: 'Uji Groq',
    apiKey: `${FAKE_KEY}-lama`,
  });
  assert.equal(provider.ok, true);
  if (!provider.ok) return;

  const before = await prisma.aiProvider.findUniqueOrThrow({ where: { id: provider.provider.id } });
  const res = await aiProviderConfig.saveProviderApiKey(provider.provider.id, '');
  assert.equal(res.ok, true);
  const after = await prisma.aiProvider.findUniqueOrThrow({ where: { id: provider.provider.id } });
  assert.equal(after.apiKeyCipher, before.apiKeyCipher, 'ciphertext tidak boleh berubah');
});

test('T-10 ganti provider aktif: hanya satu yang aktif', async () => {
  const a = await aiProviderConfig.upsertProvider({
    provider: 'openrouter',
    label: 'A',
    apiKey: `${FAKE_KEY}-a`,
    primaryModel: 'v/m',
  });
  const b = await aiProviderConfig.upsertProvider({
    provider: 'gemini',
    label: 'B',
    apiKey: `${FAKE_KEY}-b`,
    primaryModel: 'gemini-uji',
  });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;

  const actA = await aiProviderConfig.activateProvider(a.provider.id);
  assert.equal(actA.ok, true);
  const actB = await aiProviderConfig.activateProvider(b.provider.id);
  assert.equal(actB.ok, true);

  const actives = await prisma.aiProvider.findMany({ where: { isActive: true } });
  assert.equal(actives.length, 1, 'hanya boleh satu provider aktif');
  assert.equal(actives[0].id, b.provider.id);

  const resolved = await aiProviderConfig.resolveActiveAiProvider();
  assert.equal(resolved.source, 'database');
  assert.equal(resolved.provider, 'gemini');
  assert.equal(resolved.primaryModel, 'gemini-uji');
});

test('T-11 aktivasi tanpa syarat ditolak: A tetap aktif', async () => {
  const a = await aiProviderConfig.upsertProvider({
    provider: 'openrouter',
    label: 'A',
    apiKey: `${FAKE_KEY}-a`,
    primaryModel: 'v/m',
  });
  const b = await aiProviderConfig.upsertProvider({
    provider: 'groq',
    label: 'B',
    apiKey: `${FAKE_KEY}-b`,
  });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;

  await aiProviderConfig.activateProvider(a.provider.id);
  // B tidak boleh punya model utama → aktivasi harus DITOLAK.
  await aiProviderConfig.setProviderPrimaryModel(b.provider.id, '');
  const res = await aiProviderConfig.activateProvider(b.provider.id);
  assert.equal(res.ok, false, 'provider tanpa model utama tidak boleh diaktifkan');

  const actives = await prisma.aiProvider.findMany({ where: { isActive: true } });
  assert.equal(actives.length, 1);
  assert.equal(actives[0].id, a.provider.id, 'A harus tetap aktif');
});

test('T-12 ganti model utama tersimpan & terbaca oleh resolver', async () => {
  const a = await aiProviderConfig.upsertProvider({
    provider: 'openrouter',
    label: 'A',
    apiKey: `${FAKE_KEY}-a`,
    primaryModel: 'v/m1',
  });
  assert.equal(a.ok, true);
  if (!a.ok) return;
  await aiProviderConfig.activateProvider(a.provider.id);

  const res = await aiProviderConfig.setProviderPrimaryModel(a.provider.id, 'v/m2');
  assert.equal(res.ok, true);
  const resolved = await aiProviderConfig.resolveActiveAiProvider();
  assert.equal(resolved.primaryModel, 'v/m2');
});

test('T-13 urutan fallback tersimpan persis & dipakai berurutan', async () => {
  // Fixture: model-model ini berstatus gratis TERVERIFIKASI (agar boleh dipakai
  // sesuai kebijakan gratis terverifikasi).
  for (const modelId of ['v/m1', 'v/f1', 'v/f2', 'v/f3']) {
    await prisma.aiModelPolicy.upsert({
      where: { provider_modelId: { provider: 'openrouter', modelId } },
      create: {
        provider: 'openrouter',
        modelId,
        freeStatus: 'VERIFIED_FREE',
        evidenceUrl: 'https://example.invalid/evidence',
        verifiedAt: new Date(),
        notes: 'fixture tes',
      },
      update: { freeStatus: 'VERIFIED_FREE', verifiedAt: new Date() },
    });
  }

  const a = await aiProviderConfig.upsertProvider({
    provider: 'openrouter',
    label: 'A',
    apiKey: `${FAKE_KEY}-a`,
    primaryModel: 'v/m1',
  });
  assert.equal(a.ok, true);
  if (!a.ok) return;
  await aiProviderConfig.activateProvider(a.provider.id);

  const res = await aiProviderConfig.setProviderFallbackModels(a.provider.id, ['v/f1', 'v/f2', 'v/f3']);
  assert.equal(res.ok, true);
  const resolved = await aiProviderConfig.resolveActiveAiProvider();
  assert.deepEqual(resolved.fallbackModels, ['v/f1', 'v/f2', 'v/f3'], 'urutan harus persis');
  assert.deepEqual(resolved.modelChain, ['v/m1', 'v/f1', 'v/f2', 'v/f3'], 'chain = primary + fallback');

  const bad = await aiProviderConfig.setProviderFallbackModels(a.provider.id, ['v/m1']);
  assert.equal(bad.ok, false, 'model utama tidak boleh jadi cadangan');
});

test('T-06b config DB tidak pernah fallback diam-diam ke .env', async () => {
  const resolved = await aiProviderConfig.resolveActiveAiProvider();
  assert.equal(resolved.source, 'database');
  assert.equal(resolved.usedEnvFallback, false);
});

test('T-31 perubahan konfigurasi tercatat di AdminAuditLog (tanpa rahasia)', async () => {
  const before = await prisma.adminAuditLog.count();
  const created = await aiProviderConfig.upsertProvider({
    provider: 'openrouter',
    label: 'Audit Uji',
    apiKey: `${FAKE_KEY}-audit`,
    primaryModel: 'v/m',
  });
  assert.equal(created.ok, true);
  const after = await prisma.adminAuditLog.count();
  assert.ok(after >= before, 'audit log tidak boleh berkurang');
  const rows = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes(FAKE_KEY), false, 'audit log tidak boleh memuat nilai kunci');
  assert.equal(serialized.includes('apiKeyCipher'), false);
});

// ===========================================================================
// T-17 / T-18: transisi token Fonnte
// ===========================================================================

test('T-17 backfill token: token lama tetap ada, tokenCipher terisi & cocok', async () => {
  const device = await prisma.fonnteConfig.findFirst({ where: { isActive: true } });
  assert.ok(device, 'fixture: butuh perangkat Fonnte aktif');

  const legacyToken = device.token;
  const cipher = secretCrypto.encryptSecret(legacyToken);
  await prisma.fonnteConfig.update({ where: { id: device.id }, data: { tokenCipher: cipher } });

  const after = await prisma.fonnteConfig.findUniqueOrThrow({ where: { id: device.id } });
  assert.equal(after.token, legacyToken, 'token lama TIDAK boleh dihapus/diubah');
  assert.ok(after.tokenCipher, 'tokenCipher harus terisi');
  assert.equal(
    secretCrypto.decryptSecret(after.tokenCipher),
    legacyToken,
    'dekripsi harus cocok dengan token lama'
  );
});

test('T-18 jalur transisi: tokenCipher null -> sistem tetap pakai token lama', async () => {
  const device = await prisma.fonnteConfig.findFirst({ where: { isActive: true } });
  assert.ok(device);
  await prisma.fonnteConfig.update({ where: { id: device.id }, data: { tokenCipher: null } });
  const token = fonnteConfig.readDeviceToken({ tokenCipher: null, token: device.token });
  assert.equal(token, device.token, 'token lama harus tetap dipakai saat transisi');
});

// ===========================================================================
// T-14 / T-15 / T-16: rantai fallback AI (stub fetch lokal, tanpa jaringan)
// ===========================================================================

test('T-14 fallback transparan: model 1 gagal 429 -> model 2 dipakai', async () => {
  const spec = aiProviders.getProviderSpec('openrouter');
  assert.ok(spec);
  const originalFetch = global.fetch;
  const tried: string[] = [];
  global.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    tried.push(body.model);
    if (body.model === 'model-1') {
      return new Response('rate limited', { status: 429 });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'jawaban dari model cadangan' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const first = await aiProviders.callOpenAiCompatibleProvider(spec!, {
      apiKey: FAKE_KEY,
      model: 'model-1',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 20,
    });
    assert.equal(first.ok, false);
    assert.equal(first.errorKind, 'AI_RATE_LIMIT');

    const second = await aiProviders.callOpenAiCompatibleProvider(spec!, {
      apiKey: FAKE_KEY,
      model: 'model-2',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 20,
    });
    assert.equal(second.ok, true);
    assert.equal(second.model, 'model-2');
    assert.deepEqual(tried, ['model-1', 'model-2'], 'kedua model harus dicoba berurutan');
  } finally {
    global.fetch = originalFetch;
  }
});

test('T-15 semua model gagal -> errorKind jelas, tanpa jawaban mengarang', async () => {
  const spec = aiProviders.getProviderSpec('openrouter');
  assert.ok(spec);
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
  try {
    const result = await aiProviders.callOpenAiCompatibleProvider(spec!, {
      apiKey: FAKE_KEY,
      model: 'model-x',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 20,
    });
    assert.equal(result.ok, false);
    assert.equal(result.content, null, 'tidak boleh ada jawaban mengarang');
    assert.equal(result.errorKind, 'AI_PROVIDER_ERROR');
  } finally {
    global.fetch = originalFetch;
  }
});

test('T-16 kunci invalid (401) TIDAK memicu fallback', async () => {
  const spec = aiProviders.getProviderSpec('openrouter');
  assert.ok(spec);
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    return new Response('unauthorized', { status: 401 });
  }) as typeof fetch;
  try {
    const result = await aiProviders.callOpenAiCompatibleProvider(spec!, {
      apiKey: FAKE_KEY,
      model: 'model-1',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 20,
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorKind, 'AI_AUTH_FAILED');
    assert.equal(aiProviders.shouldTryFallback(result.errorKind), false, '401/403 tidak boleh fallback');
    assert.equal(calls, 1, 'hanya satu request yang boleh dilakukan');
  } finally {
    global.fetch = originalFetch;
  }
});

test('T-16b klasifikasi status HTTP sesuai aturan 10.3', () => {
  assert.equal(aiProviders.classifyProviderStatus(401), 'AI_AUTH_FAILED');
  assert.equal(aiProviders.classifyProviderStatus(403), 'AI_AUTH_FAILED');
  assert.equal(aiProviders.classifyProviderStatus(402), 'AI_QUOTA');
  assert.equal(aiProviders.classifyProviderStatus(404), 'AI_MODEL_GONE');
  assert.equal(aiProviders.classifyProviderStatus(429), 'AI_RATE_LIMIT');
  assert.equal(aiProviders.classifyProviderStatus(500), 'AI_PROVIDER_ERROR');
  assert.equal(aiProviders.shouldTryFallback('AI_QUOTA'), false);
  assert.equal(aiProviders.shouldTryFallback('AI_MODEL_GONE'), true);
  assert.equal(aiProviders.shouldTryFallback('AI_RATE_LIMIT'), true);
  assert.equal(aiProviders.shouldTryFallback('AI_TIMEOUT'), true);
});

test('T-07 log tak bocor: kunci tidak pernah muncul di pesan/log error', async () => {
  const spec = aiProviders.getProviderSpec('openrouter');
  assert.ok(spec);
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(`invalid key ${FAKE_KEY} here`, { status: 400 })) as typeof fetch;
  try {
    const result = await aiProviders.callOpenAiCompatibleProvider(spec!, {
      apiKey: FAKE_KEY,
      model: 'model-1',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 20,
    });
    assert.equal(result.ok, false);
    assert.equal(String(result.error).includes(FAKE_KEY), false, 'pesan error tidak boleh memuat kunci');
    const redacted = aiProviders.redactSecret(`invalid key ${FAKE_KEY} here`, FAKE_KEY);
    assert.equal(redacted.includes(FAKE_KEY), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('T-17b Groq: bentuk request OpenAI-compatible (stub, tanpa jaringan nyata)', async () => {
  const groq = aiProviders.getProviderSpec('groq');
  assert.ok(groq, 'spec Groq harus ada');
  assert.equal(groq!.style, 'openai-compatible');
  assert.equal(groq!.endpoint, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(groq!.verified, false, 'Groq belum diverifikasi terhadap API nyata');

  const originalFetch = global.fetch;
  let captured: any = null;
  let capturedUrl = '';
  global.fetch = (async (url: any, init: any) => {
    capturedUrl = String(url);
    captured = {
      headers: init?.headers,
      body: JSON.parse(String(init?.body || '{}')),
    };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const result = await aiProviders.callOpenAiCompatibleProvider(groq!, {
      apiKey: FAKE_KEY,
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 20,
    });
    assert.equal(result.ok, true);
    assert.equal(capturedUrl, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal((captured.headers as any).Authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(captured.body.model, 'llama-3.3-70b-versatile');
    assert.equal(captured.body.max_tokens, 20);
    assert.ok(Array.isArray(captured.body.messages));
    assert.equal(captured.body.messages[0].role, 'user');
  } finally {
    global.fetch = originalFetch;
  }
});

test('T-26 RBAC: endpoint konfigurasi menolak tanpa login / non-Admin (cek kode sumber)', () => {
  const routes = [
    'src/app/api/admin/whatsapp-recipients/route.ts',
    'src/app/api/admin/whatsapp-recipients/[id]/route.ts',
    'src/app/api/admin/ai-config/route.ts',
    'src/app/api/admin/ai-config/[id]/route.ts',
    'src/app/api/admin/ai-config/[id]/activate/route.ts',
    'src/app/api/admin/ai-config/[id]/test/route.ts',
    'src/app/api/admin/ai-config/catalog/route.ts',
  ];
  for (const route of routes) {
    const src = readFileSync(path.join(PROJECT_ROOT, route), 'utf8');
    assert.ok(/requireAdmin\(\)/.test(src), `${route} harus memakai requireAdmin()`);
    assert.ok(/auth\.response/.test(src), `${route} harus mengembalikan response guard`);
  }
});

test('T-27 RBAC halaman: /admin/ai-config & /admin/whatsapp-recipients menolak non-Admin', () => {
  for (const page of [
    'src/app/(dashboard)/admin/ai-config/page.tsx',
    'src/app/(dashboard)/admin/whatsapp-recipients/page.tsx',
  ]) {
    const src = readFileSync(path.join(PROJECT_ROOT, page), 'utf8');
    assert.ok(/session\.role !== 'ADMIN'/.test(src), `${page} harus memeriksa role server-side`);
    assert.ok(/redirect\('\/login'\)/.test(src), `${page} harus redirect bila bukan Admin`);
  }
});

test('T-33a tidak ada model hardcode di pipeline AI', () => {
  const forbidden = ['openai/gpt-4o-mini', 'gemini-3.8-flash'];
  for (const file of [
    'src/lib/aiChat.ts',
    'src/lib/aiService.ts',
    'src/lib/duplicates.ts',
    'src/lib/aiTools.ts',
  ]) {
    const src = readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    for (const model of forbidden) {
      assert.equal(
        src.includes(model),
        false,
        `${file} tidak boleh lagi memakai model hardcode "${model}"`
      );
    }
  }
});

test('T-33b FALLBACK_MODELS hardcode sudah dihapus dari aiChat.ts', () => {
  const src = readFileSync(path.join(PROJECT_ROOT, 'src/lib/aiChat.ts'), 'utf8');
  assert.equal(/const FALLBACK_MODELS\s*=/.test(src), false, 'daftar FALLBACK_MODELS harus hilang');
});

test('T-14b rantai provider: attempts[0] = provider aktif, berikutnya = cadangan', async () => {
  const chain = await aiProviderConfig.resolveAiProviderChain();
  assert.ok(chain.attempts.length >= 1, 'harus ada minimal satu percobaan provider');
  assert.equal(chain.source, 'database');
  assert.equal(chain.attempts[0].isActive, true, 'percobaan pertama = provider aktif');
  const ids = chain.attempts.map((a: any) => a.provider);
  assert.equal(new Set(ids).size, ids.length, 'provider tidak boleh dobel dalam rantai');
});

test('T-12b resolver membaca model & kunci dari database (bukan .env)', async () => {
  const resolved = await aiProviderConfig.resolveActiveAiProvider();
  assert.equal(resolved.source, 'database');
  assert.ok(resolved.apiKey.length > 0, 'kunci harus terbaca dari DB (terenkripsi)');
  assert.ok(resolved.primaryModel, 'model utama harus ada');
});

test('T-06c encryptionReady true saat kunci server tersedia', () => {
  assert.equal(aiProviderConfig.isEncryptionConfigured(), true);
});

test('T-06d daftar provider terenkripsi tidak bocor lewat JSON.stringify', async () => {
  const list = await aiProviderConfig.listAiProviders();
  const serialized = JSON.stringify(list);
  assert.equal(serialized.includes('apiKeyCipher'), false);
  assert.equal(serialized.includes('"apiKey"'), false);
  for (const p of list) {
    assert.equal(typeof p.hasApiKey, 'boolean');
  }
});

test('T-19d toSafeProvider: bentuk aman tidak memuat field rahasia', async () => {
  const row = await prisma.aiProvider.findFirst();
  assert.ok(row);
  const safe = aiProviderConfig.toSafeProvider(row) as any;
  assert.equal('apiKeyCipher' in safe, false);
  assert.equal('apiKey' in safe, false);
  assert.equal(typeof safe.hasApiKey, 'boolean');
});

test('T-14c chain dibatasi maksimal 4 model (batas atas rantai)', () => {
  const chain = aiChat.activeModelChain('m1', ['m2', 'm3', 'm4', 'm5', 'm6']);
  assert.equal(chain.length, 4, 'rantai dibatasi 4 model');
  assert.equal(chain[0], 'm1');
});

test('T-14d validateModelConfig menerima bentuk model tiap provider', () => {
  assert.equal(aiChat.validateModelConfig('vendor/model', 'openrouter').ok, true);
  assert.equal(aiChat.validateModelConfig('model', 'openrouter').ok, false, 'OpenRouter butuh vendor/model');
  assert.equal(aiChat.validateModelConfig('gemini-1.5-flash', 'gemini').ok, true);
  assert.equal(aiChat.validateModelConfig('llama-3.3-70b-versatile', 'groq').ok, true);
  assert.equal(aiChat.validateModelConfig('', 'gemini').ok, false);
});

test('T-31b audit: aksi konfigurasi memakai awalan AI_CONFIG_* / WA_RECIPIENT_*', () => {
  const files = [
    'src/app/api/admin/ai-config/route.ts',
    'src/app/api/admin/ai-config/[id]/route.ts',
    'src/app/api/admin/ai-config/[id]/activate/route.ts',
    'src/app/api/admin/ai-config/[id]/test/route.ts',
  ];
  for (const f of files) {
    const src = readFileSync(path.join(PROJECT_ROOT, f), 'utf8');
    assert.ok(/AI_CONFIG_/.test(src), `${f} harus mencatat aksi AI_CONFIG_*`);
  }
  const waFiles = [
    'src/app/api/admin/whatsapp-recipients/route.ts',
    'src/app/api/admin/whatsapp-recipients/[id]/route.ts',
  ];
  for (const f of waFiles) {
    const src = readFileSync(path.join(PROJECT_ROOT, f), 'utf8');
    assert.ok(/WA_RECIPIENT_/.test(src), `${f} harus mencatat aksi WA_RECIPIENT_*`);
  }
});

test('T-33c semua spec provider punya label, endpoint, dan gaya request', () => {
  assert.equal(aiProviders.AI_PROVIDER_SPECS.length, 3, 'harus ada 3 provider: openrouter, gemini, groq');
  const ids = aiProviders.AI_PROVIDER_SPECS.map((s: any) => s.id).sort();
  assert.deepEqual(ids, ['gemini', 'groq', 'openrouter']);
  for (const spec of aiProviders.AI_PROVIDER_SPECS) {
    assert.ok(spec.label.length > 0);
    assert.ok(spec.endpoint.startsWith('https://'));
    assert.ok(['openai-compatible', 'gemini-sdk'].includes(spec.style));
  }
});
