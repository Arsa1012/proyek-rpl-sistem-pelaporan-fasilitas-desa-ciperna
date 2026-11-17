/**
 * Tes PENGUMUMAN lanjutan: jadwal, masa berlaku, target penerima, foto, hapus
 * lunak, dan siaran notifikasi WhatsApp (Fonnte) yang idempoten.
 *
 * Mock: TIDAK ada panggilan jaringan nyata. `globalThis.fetch` diganti stub
 * selama tes pengiriman; pada tes "belum dikonfigurasi" token dikosongkan.
 * Semua baris uji dihapus kembali di akhir.
 *
 * Jalankan: npm test
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import {
  parseAnnouncementInput,
  MAX_ANNOUNCEMENT_PHOTOS,
} from '../src/lib/villageInput';
import {
  deriveAnnouncementStatus,
  isPubliclyVisible,
} from '../src/lib/announcementStatus';
import {
  ANNOUNCEMENT_WHATSAPP_LIMIT,
  broadcastAnnouncementWhatsApp,
  broadcastAnnouncementWhatsAppAll,
  buildAnnouncementWhatsAppMessage,
  announcementDeliveryStatus,
} from '../src/lib/announcementBroadcast';
import { syncAnnouncementNotification } from '../src/lib/announcementNotify';
import { getPublishedAnnouncements } from '../src/lib/village';

const CITIZEN_EMAIL = 'zz-ann-wa-citizen@example.com';
const OFFICER_EMAIL = 'zz-ann-wa-officer@example.com';
const SLUG_PREFIX = 'zz-uji-siaran-pengumuman';

const createdAnnouncementIds: string[] = [];
let citizenId = '';
let officerId = '';
let realFetch: typeof globalThis.fetch;
let savedToken: string | undefined;
let savedAdmin: string | undefined;

before(async () => {
  realFetch = globalThis.fetch;
  savedToken = process.env.FONNTE_TOKEN;
  savedAdmin = process.env.WHATSAPP_ADMIN_NUMBER;
  process.env.WHATSAPP_ADMIN_NUMBER = '082118727522';

  const citizen = await prisma.user.upsert({
    where: { email: CITIZEN_EMAIL },
    create: { name: 'Warga Siaran Uji', email: CITIZEN_EMAIL, password: 'x', role: 'CITIZEN', phone: '081200000001' },
    update: { role: 'CITIZEN', isActive: true, phone: '081200000001' },
  });
  citizenId = citizen.id;
  const officer = await prisma.user.upsert({
    where: { email: OFFICER_EMAIL },
    create: { name: 'Petugas Siaran Uji', email: OFFICER_EMAIL, password: 'x', role: 'OFFICER', phone: '081200000002' },
    update: { role: 'OFFICER', isActive: true, phone: '081200000002' },
  });
  officerId = officer.id;
});

after(async () => {
  globalThis.fetch = realFetch;
  if (savedToken === undefined) delete process.env.FONNTE_TOKEN;
  else process.env.FONNTE_TOKEN = savedToken;
  if (savedAdmin === undefined) delete process.env.WHATSAPP_ADMIN_NUMBER;
  else process.env.WHATSAPP_ADMIN_NUMBER = savedAdmin;

  await prisma.announcementDelivery.deleteMany({ where: { announcementId: { in: createdAnnouncementIds } } });
  await prisma.notification.deleteMany({ where: { announcementId: { in: createdAnnouncementIds } } });
  for (const id of createdAnnouncementIds) {
    await prisma.whatsAppLog.deleteMany({ where: { dedupeKey: { startsWith: `announce:${id}:` } } });
  }
  await prisma.villageAnnouncement.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { in: [CITIZEN_EMAIL, OFFICER_EMAIL] } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'zz-ann-cap-' } } });
  await prisma.$disconnect();
});

async function createAnnouncement(over: Record<string, unknown> = {}) {
  const suffix = createdAnnouncementIds.length + 1;
  const row = await prisma.villageAnnouncement.create({
    data: {
      title: `ZZ Siaran Pengumuman ${suffix}`,
      slug: `${SLUG_PREFIX}-${suffix}`,
      content: 'Isi pengumuman uji siaran WhatsApp Desa Ciperna.',
      isPublished: true,
      publishedAt: new Date(),
      notifyWhatsApp: true,
      target: 'ALL',
      ...over,
    },
  });
  createdAnnouncementIds.push(row.id);
  return row;
}

// ---------------------------------------------------------------------------
// Parser & status (murni)
// ---------------------------------------------------------------------------

test('parser pengumuman: target, WhatsApp, masa berlaku, & validasi rentang', () => {
  const ok = parseAnnouncementInput({
    title: 'Uji Pengumuman Baru',
    content: 'Isi pengumuman yang cukup panjang untuk lolos validasi.',
    target: 'CITIZEN',
    notifyWhatsApp: true,
    category: 'Informasi',
    coverPhoto: '/uploads/announcement_x.jpg',
    photos: ['/uploads/a1.jpg', '/uploads/a1.jpg', '/uploads/a2.jpg'],
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-02-01T00:00:00.000Z',
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.data.target, 'CITIZEN');
    assert.equal(ok.data.notifyWhatsApp, true);
    assert.equal(ok.data.category, 'Informasi');
    assert.equal(ok.data.coverPhoto, '/uploads/announcement_x.jpg');
    assert.deepEqual(ok.data.photos, ['/uploads/a1.jpg', '/uploads/a2.jpg'], 'foto ganda dinormalkan');
  }

  const badRange = parseAnnouncementInput({
    title: 'Uji Rentang Salah',
    content: 'Isi pengumuman yang cukup panjang untuk lolos validasi.',
    validFrom: '2026-02-01T00:00:00.000Z',
    validUntil: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(badRange.ok, false, 'akhir sebelum mulai harus ditolak');

  const unknownTarget = parseAnnouncementInput({
    title: 'Target Tidak Dikenal',
    content: 'Isi pengumuman yang cukup panjang untuk lolos validasi.',
    target: 'PRESIDEN',
  });
  assert.equal(unknownTarget.ok, true);
  if (unknownTarget.ok) assert.equal(unknownTarget.data.target, 'ALL', 'target tak dikenal → ALL');

  const tooMany = parseAnnouncementInput({
    title: 'Terlalu Banyak Foto',
    content: 'Isi pengumuman yang cukup panjang untuk lolos validasi.',
    photos: Array.from({ length: MAX_ANNOUNCEMENT_PHOTOS + 1 }, (_, i) => `/uploads/p${i}.jpg`),
  });
  assert.equal(tooMany.ok, false);
});

test('status pengumuman diturunkan dengan benar dari kolom tersimpan', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');
  const base = { isPublished: true, publishedAt: '2026-05-01T00:00:00.000Z' };
  assert.equal(deriveAnnouncementStatus({ ...base, isPublished: false }, now), 'DRAFT');
  assert.equal(deriveAnnouncementStatus({ ...base, publishedAt: '2026-07-01T00:00:00.000Z' }, now), 'SCHEDULED');
  assert.equal(deriveAnnouncementStatus(base, now), 'PUBLISHED');
  assert.equal(deriveAnnouncementStatus({ ...base, validUntil: '2026-05-15T00:00:00.000Z' }, now), 'EXPIRED');
  assert.equal(deriveAnnouncementStatus({ ...base, archivedAt: '2026-05-20T00:00:00.000Z' }, now), 'ARCHIVED');
  assert.equal(deriveAnnouncementStatus({ ...base, deletedAt: '2026-05-21T00:00:00.000Z' }, now), 'DELETED');
  assert.equal(isPubliclyVisible(base, now), true);
  assert.equal(isPubliclyVisible({ ...base, validUntil: '2026-05-15T00:00:00.000Z' }, now), false);
});

test('pesan WhatsApp pengumuman memuat judul, tanggal, tautan, dan penutup otomatis', () => {
  const msg = buildAnnouncementWhatsAppMessage(
    {
      id: 'x',
      title: 'Kerja Bakti',
      slug: 'kerja-bakti',
      content: 'Kerja bakti akan dilaksanakan hari Minggu.',
      excerpt: null,
      isPublished: true,
      publishedAt: new Date('2026-06-01T01:00:00.000Z'),
      validUntil: new Date('2026-06-10T01:00:00.000Z'),
    },
    'https://desa.example'
  );
  assert.match(msg, /Kerja Bakti/);
  assert.match(msg, /PENGUMUMAN DESA CIPERNA/);
  assert.match(msg, /Waktu:/);
  assert.match(msg, /Berlaku sampai:/);
  assert.match(msg, /Silakan cek detail pengumuman/);
  assert.match(msg, /https:\/\/desa\.example\/pengumuman\/kerja-bakti/);
  assert.match(msg, /Pesan ini otomatis/);
});

// ---------------------------------------------------------------------------
// Siaran WhatsApp
// ---------------------------------------------------------------------------

test('belum dikonfigurasi: tidak ada pengiriman, status tercatat menunggu', async () => {
  process.env.FONNTE_TOKEN = '';
  const a = await createAnnouncement({ target: 'CITIZEN' });

  const summary = await broadcastAnnouncementWhatsApp(a);
  assert.equal(summary.configured, false);
  assert.equal(summary.sent, 0);
  assert.ok(summary.pending >= 1, 'penerima harus tercatat menunggu');

  const status = await announcementDeliveryStatus(a.id);
  assert.equal(status.sent, 0);
  assert.ok(status.pending >= 1);
  // Tidak ada penerima yang ditandai SENT saat belum dikonfigurasi.
  assert.equal(await prisma.whatsAppLog.count({ where: { dedupeKey: { startsWith: `announce:${a.id}:` } } }), 0);
});

test('pengumuman terjadwal (belum jatuh tempo) tidak mengirim WhatsApp', async () => {
  process.env.FONNTE_TOKEN = 'zz-test-token';
  const a = await createAnnouncement({ publishedAt: new Date(Date.now() + 86400000), target: 'CITIZEN' });
  const summary = await broadcastAnnouncementWhatsApp(a);
  assert.equal(summary.due, false);
  assert.equal(summary.sent, 0);
});

test('terkirim (mock Fonnte) bersifat idempoten & target memfilter penerima', async () => {
  process.env.FONNTE_TOKEN = 'zz-test-token';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: true, id: 'mock-msg-1' }),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;

  const a = await createAnnouncement({ target: 'CITIZEN' });
  const first = await broadcastAnnouncementWhatsApp(a);
  assert.ok(first.sent >= 1, 'setidaknya satu warga terkirim');
  assert.equal(calls >= 1, true);

  const status = await announcementDeliveryStatus(a.id);
  assert.ok(status.sent >= 1);

  // BERTAHAP: pemanggilan berikutnya memproses sisa penerima (bukan pengiriman
  // massal tak terkendali) sampai tidak ada lagi yang tertunda.
  let last = first;
  let guard = 0;
  while (last.attempted > 0 && guard < 60) {
    last = await broadcastAnnouncementWhatsApp(a);
    guard += 1;
  }
  assert.equal(last.attempted, 0);

  // Idempoten: setelah semua diproses, panggilan berikutnya tidak mengirim ulang.
  const callsBefore = calls;
  const again = await broadcastAnnouncementWhatsApp(a);
  assert.equal(again.attempted, 0);
  assert.equal(calls, callsBefore, 'tidak ada panggilan Fonnte tambahan');

  // Target CITIZEN → petugas TIDAK boleh menerima baris pengiriman.
  assert.equal(
    await prisma.announcementDelivery.count({ where: { announcementId: a.id, userId: officerId } }),
    0,
    'petugas tidak boleh jadi penerima saat target masyarakat saja'
  );
  assert.equal(
    await prisma.announcementDelivery.count({ where: { announcementId: a.id, userId: citizenId } }),
    1
  );
});

test('batas keras 15 percobaan kirim per pengumuman (mock, tanpa pengiriman massal)', async () => {
  process.env.FONNTE_TOKEN = 'zz-test-token';

  // Pastikan tersedia lebih dari 15 penerima dengan nomor valid.
  for (let i = 0; i < ANNOUNCEMENT_WHATSAPP_LIMIT; i += 1) {
    await prisma.user.upsert({
      where: { email: `zz-ann-cap-${i}@example.com` },
      create: {
        name: `Warga Batas ${i}`,
        email: `zz-ann-cap-${i}@example.com`,
        password: 'x',
        role: 'CITIZEN',
        phone: `0813${String(20000000 + i)}`,
      },
      update: { role: 'CITIZEN', isActive: true, phone: `0813${String(20000000 + i)}` },
    });
  }

  let calls = 0;
  const targets: string[] = [];
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    calls += 1;
    const body = init?.body as URLSearchParams | undefined;
    targets.push(String(body && typeof body.get === 'function' ? body.get('target') || '' : ''));
    return new Response(JSON.stringify({ status: true, id: `zz-mock-cap-${calls}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const a = await createAnnouncement({ target: 'CITIZEN' });
  const summary = await broadcastAnnouncementWhatsAppAll(a);

  assert.equal(summary.sendCount, ANNOUNCEMENT_WHATSAPP_LIMIT, 'counter per pengumuman tepat 15');
  assert.equal(summary.attempted, ANNOUNCEMENT_WHATSAPP_LIMIT);
  assert.equal(calls, ANNOUNCEMENT_WHATSAPP_LIMIT, 'tidak boleh ada kiriman ke-16');
  assert.equal(summary.limitReached, true);
  assert.equal(targets.length, ANNOUNCEMENT_WHATSAPP_LIMIT);

  const status = await announcementDeliveryStatus(a.id);
  assert.equal(status.sendCount, ANNOUNCEMENT_WHATSAPP_LIMIT);
  assert.equal(status.limitReached, true);
  assert.equal(status.sent, ANNOUNCEMENT_WHATSAPP_LIMIT, 'satu baris penerima = satu kiriman');

  // Refresh/tombol kirim ulang tidak boleh menambah kiriman setelah batas.
  const before = calls;
  const again = await broadcastAnnouncementWhatsAppAll(a);
  assert.equal(again.attempted, 0);
  assert.equal(calls, before, 'tidak ada panggilan Fonnte tambahan setelah batas');

  // Counter bersifat PER PENGUMUMAN, bukan global: pengumuman lain tetap bisa kirim.
  const b = await createAnnouncement({ target: 'CITIZEN' });
  const other = await broadcastAnnouncementWhatsApp(b);
  assert.equal(other.limitReached, false);
  assert.ok(other.sendCount >= 1, 'pengumuman lain punya counter sendiri');
});

test('retry hanya mengirim ulang penerima yang gagal', async () => {
  process.env.FONNTE_TOKEN = 'zz-test-token';
  const a = await createAnnouncement({ target: 'ALL' });

  // Paksa status awal: warga GAGAL, petugas SENT.
  await prisma.announcementDelivery.createMany({
    data: [
      { announcementId: a.id, userId: citizenId, status: 'FAILED', error: 'timeout' },
      { announcementId: a.id, userId: officerId, status: 'SENT', toMasked: '0812****' },
    ],
  });

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: true, id: 'mock-msg-2' }),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;

  const summary = await broadcastAnnouncementWhatsApp(a, { onlyFailed: true });
  assert.equal(summary.attempted, 1, 'hanya satu penerima gagal yang dicoba ulang');
  assert.equal(calls, 1);

  const rows = await prisma.announcementDelivery.findMany({ where: { announcementId: a.id } });
  const citizenRow = rows.find((r) => r.userId === citizenId);
  const officerRowIsSent = rows.find((r) => r.userId === officerId)?.status === 'SENT';
  assert.equal(citizenRow?.status, 'SENT');
  assert.equal(officerRowIsSent, true, 'yang sudah SENT tidak diubah/dikirim ulang');
});

// ---------------------------------------------------------------------------
// Hapus lunak & visibilitas publik
// ---------------------------------------------------------------------------

test('hapus lunak menarik notifikasi & menyembunyikan dari publik tanpa menghapus baris', async () => {
  const a = await createAnnouncement({ target: 'CITIZEN' });
  await syncAnnouncementNotification(a);
  assert.ok(await prisma.notification.count({ where: { announcementId: a.id } }));

  const deleted = await prisma.villageAnnouncement.update({
    where: { id: a.id },
    data: { deletedAt: new Date(), isPublished: false },
  });
  await syncAnnouncementNotification(deleted);

  assert.equal(await prisma.notification.count({ where: { announcementId: a.id } }), 0);
  assert.ok(await prisma.villageAnnouncement.findUnique({ where: { id: a.id } }), 'baris tetap ada (hapus lunak)');

  const list = await getPublishedAnnouncements(50);
  assert.equal(list.some((x) => x.id === a.id), false, 'pengumuman terhapus tidak tampil di publik');
});

test('pengumuman kedaluwarsa tidak tampil di daftar publik', async () => {
  const a = await createAnnouncement({
    validFrom: new Date(Date.now() - 20 * 86400000),
    validUntil: new Date(Date.now() - 86400000),
  });
  const list = await getPublishedAnnouncements(50);
  assert.equal(list.some((x) => x.id === a.id), false);
});
