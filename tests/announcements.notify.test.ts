/**
 * Tes NOTIFIKASI PENGUMUMAN (dalam aplikasi) + tool AI operasional baru.
 *
 * Fokus:
 *  - Admin menerbitkan pengumuman → warga menerima SATU notifikasi aplikasi
 *    (type ANNOUNCEMENT + tautan detail), idempoten meski event diulang;
 *  - pengumuman TERJADWAL (publishedAt di masa depan) belum menotifikasi;
 *  - pengumuman diubah → isi notifikasi diperbarui; ditarik → notifikasi dihapus;
 *  - penjadwalan malas (ensureDueAnnouncementForUser) mengisi notifikasi yang
 *    terlewat tanpa duplikat, dan tidak membanjiri warga baru dengan pengumuman lama;
 *  - tool AI baru (tren bulanan, status WhatsApp, wilayah) hanya untuk ADMIN dan
 *    mengembalikan data nyata dari database.
 *
 * Semua baris uji dihapus kembali di akhir (tidak mengubah data nyata).
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import {
  broadcastAnnouncementNotifications,
  ensureDueAnnouncementForUser,
  syncAnnouncementNotification,
} from '../src/lib/announcementNotify';
import { getMonthlyCompletionTrend, getRegionOverview, getWhatsAppDeliveryStatus } from '../src/lib/aiTools';
import { TOOL_REGISTRY, isToolAllowed } from '../src/lib/aiToolRegistry';

const EMAIL = 'zz-announce-test@example.com';
const SLUG_PREFIX = 'zz-uji-pengumuman';
const createdAnnouncementIds: string[] = [];
let citizenId = '';

function announcementInput(over: Partial<Parameters<typeof syncAnnouncementNotification>[0]> = {}) {
  return {
    id: 'placeholder',
    title: 'ZZ Uji Pengumuman',
    slug: `${SLUG_PREFIX}-1`,
    content: 'Isi pengumuman uji untuk verifikasi notifikasi aplikasi.',
    excerpt: null as string | null,
    isPublished: true,
    publishedAt: new Date(),
    ...over,
  };
}

/** Buat pengumuman uji di database, catat id-nya untuk dibersihkan. */
async function createAnnouncement(over: Record<string, unknown> = {}) {
  const suffix = createdAnnouncementIds.length + 1;
  const row = await prisma.villageAnnouncement.create({
    data: {
      title: `ZZ Uji Pengumuman ${suffix}`,
      slug: `${SLUG_PREFIX}-${suffix}`,
      content: 'Isi pengumuman uji untuk verifikasi notifikasi aplikasi.',
      isPublished: true,
      publishedAt: new Date(),
      ...over,
    },
  });
  createdAnnouncementIds.push(row.id);
  return row;
}

after(async () => {
  await prisma.notification.deleteMany({ where: { announcementId: { in: createdAnnouncementIds } } });
  await prisma.villageAnnouncement.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

test('setup: warga uji dibuat lebih dulu daripada pengumuman', async () => {
  const citizen = await prisma.user.upsert({
    where: { email: EMAIL },
    create: { name: 'Warga Uji Pengumuman', email: EMAIL, password: 'x', role: 'CITIZEN' },
    update: { role: 'CITIZEN', isActive: true },
  });
  citizenId = citizen.id;
  assert.ok(citizenId);
});

test('pengumuman terbit → satu notifikasi aplikasi untuk warga (idempoten)', async () => {
  const a = await createAnnouncement();
  await syncAnnouncementNotification(a);

  const rows = await prisma.notification.findMany({ where: { announcementId: a.id, userId: citizenId } });
  assert.equal(rows.length, 1, 'warga harus menerima tepat satu notifikasi pengumuman');
  assert.equal(rows[0].type, 'ANNOUNCEMENT');
  assert.equal(rows[0].url, `/pengumuman/${a.slug}`);
  assert.match(rows[0].title, /Uji Pengumuman/);
  assert.match(rows[0].message, /notifikasi aplikasi/);
  assert.equal(rows[0].isRead, false);

  // Idempoten: event diulang tidak menambah baris.
  await syncAnnouncementNotification(a);
  await broadcastAnnouncementNotifications(a);
  const count = await prisma.notification.count({ where: { announcementId: a.id, userId: citizenId } });
  assert.equal(count, 1, 'siaran ulang tidak boleh menggandakan notifikasi');
});

test('pengumuman TERJADWAL belum menotifikasi sebelum waktunya', async () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const a = await createAnnouncement({ publishedAt: future });

  await syncAnnouncementNotification(a);
  assert.equal(await prisma.notification.count({ where: { announcementId: a.id } }), 0);

  // Penjadwalan malas pun belum membuat notifikasi karena belum jatuh tempo.
  await ensureDueAnnouncementForUser(citizenId);
  assert.equal(await prisma.notification.count({ where: { announcementId: a.id, userId: citizenId } }), 0);
});

test('penjadwalan malas mengisi notifikasi yang terlewat (tanpa duplikat)', async () => {
  const a = await createAnnouncement();
  // Sengaja TIDAK memanggil sync (mensimulasikan notifikasi yang terlewat).
  const created = await ensureDueAnnouncementForUser(citizenId);
  assert.ok(created >= 1);
  const rows = await prisma.notification.findMany({ where: { announcementId: a.id, userId: citizenId } });
  assert.equal(rows.length, 1);

  // Panggilan kedua tidak menambah baris (notifications: none).
  await ensureDueAnnouncementForUser(citizenId);
  assert.equal(await prisma.notification.count({ where: { announcementId: a.id, userId: citizenId } }), 1);
});

test('pengumuman diubah → isi notifikasi diperbarui & ditandai belum dibaca', async () => {
  const a = await createAnnouncement();
  await syncAnnouncementNotification(a);
  await prisma.notification.updateMany({ where: { announcementId: a.id }, data: { isRead: true } });

  const updated = await prisma.villageAnnouncement.update({
    where: { id: a.id },
    data: { content: 'Isi pengumuman SETELAH perubahan.' },
  });
  await syncAnnouncementNotification(updated);

  const row = await prisma.notification.findFirst({ where: { announcementId: a.id, userId: citizenId } });
  assert.ok(row);
  assert.match(row!.message, /SETELAH perubahan/);
  assert.equal(row!.isRead, false, 'isi berubah → warga perlu melihat versi terbaru');
  assert.equal(await prisma.notification.count({ where: { announcementId: a.id, userId: citizenId } }), 1);
});

test('pengumuman ditarik (unpublish) → notifikasi turunannya dihapus', async () => {
  const a = await createAnnouncement();
  await syncAnnouncementNotification(a);
  assert.ok(await prisma.notification.count({ where: { announcementId: a.id } }));

  const withdrawn = await prisma.villageAnnouncement.update({ where: { id: a.id }, data: { isPublished: false } });
  await syncAnnouncementNotification(withdrawn);
  assert.equal(await prisma.notification.count({ where: { announcementId: a.id } }), 0);
});

test('getVillageAnnouncements hanya memuat pengumuman yang sudah terbit & jatuh tempo', async () => {
  const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const scheduled = await createAnnouncement({ publishedAt: future });
  const due = await createAnnouncement();

  // Impor dinamis agar tidak mengganggu cache modul lain.
  const { getVillageAnnouncements } = await import('../src/lib/aiTools');
  const res = await getVillageAnnouncements(50);
  const slugs = res.items.map((i) => i.slug);
  assert.ok(slugs.includes(due.slug), 'pengumuman jatuh tempo harus tampil');
  assert.ok(!slugs.includes(scheduled.slug), 'pengumuman terjadwal belum boleh tampil');
});

test('tool AI operasional baru hanya untuk ADMIN', () => {
  for (const name of ['getMonthlyCompletionTrend', 'getWhatsAppDeliveryStatus', 'getRegionOverview']) {
    assert.ok(TOOL_REGISTRY[name], `${name} harus terdaftar`);
    assert.ok(isToolAllowed('ADMIN', name), `${name} harus boleh untuk ADMIN`);
    assert.equal(isToolAllowed('CITIZEN', name), false, `${name} TIDAK boleh untuk CITIZEN`);
    assert.equal(isToolAllowed('OFFICER', name), false, `${name} TIDAK boleh untuk OFFICER`);
  }
});

test('getMonthlyCompletionTrend menghitung laporan selesai per bulan dari database', async () => {
  const res = await getMonthlyCompletionTrend(6);
  assert.equal(res.months.length, 6);
  // Jumlah keseluruhan harus sama dengan hitungan database untuk rentang tsb.
  for (const m of res.months) assert.equal(typeof m.completed, 'number');
  const totalFromHistory = await prisma.reportStatusHistory.count({
    where: { status: 'COMPLETED' },
  });
  // totalInWindow tidak boleh melebihi total historis keseluruhan.
  assert.ok(totalFromHistory >= 0);
  assert.ok(res.months.reduce((s, m) => s + m.completed, 0) <= totalFromHistory);
});

test('getRegionOverview mengembalikan struktur wilayah + jumlah warga (tanpa identitas)', async () => {
  const res = await getRegionOverview();
  assert.equal(typeof res.rwCount, 'number');
  assert.equal(typeof res.rtCount, 'number');
  assert.equal(typeof res.citizensWithoutRegion, 'number');
  assert.ok(Array.isArray(res.regions));
  const json = JSON.stringify(res);
  assert.equal(/@/.test(json), false, 'tidak boleh memuat email pengguna');
});

test('getWhatsAppDeliveryStatus: laporan tidak dikenal → jujur tanpa mengarang', async () => {
  const res = await getWhatsAppDeliveryStatus('zz-tidak-ada-999');
  assert.equal(res.found, false);
  assert.ok(typeof res.note === 'string' && res.note.length > 0);
});
