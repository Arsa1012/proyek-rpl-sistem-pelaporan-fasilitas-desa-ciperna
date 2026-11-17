/**
 * Tes PORTAL DESA — parser input (murni, tanpa database) dan helper data desa.
 *
 * Fokus:
 *  - validasi & pembatasan input Admin (nama/jabatan/layanan/pengumuman);
 *  - aturan verifikasi & arsip (tidak ada penghapusan permanen);
 *  - tautan peta/lokasi hanya dari host yang dikenal + https;
 *  - pengelompokan & urutan hierarki perangkat desa.
 *
 * Jalankan: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOfficialInput,
  parseServiceInput,
  parseAnnouncementInput,
  slugify,
} from '../src/lib/villageInput';
import {
  DATA_STATUS_LABELS,
  OFFICIAL_CATEGORY_LABELS,
  VILLAGE_FALLBACK,
  groupOfficials,
  missingProfileFields,
  normalizeEmbedUrl,
  normalizeMapLink,
  optionalCoordinate,
  villageIdentity,
} from '../src/lib/village';

// ---------------------------------------------------------------------------
// Parser perangkat desa
// ---------------------------------------------------------------------------

test('perangkat desa: nama & jabatan wajib diisi', () => {
  const noName = parseOfficialInput({ position: 'Kepala Desa' });
  assert.equal(noName.ok, false);
  const noPosition = parseOfficialInput({ name: 'Budi' });
  assert.equal(noPosition.ok, false);
  const ok = parseOfficialInput({ name: 'Budi Santoso', position: 'Kepala Desa' });
  assert.equal(ok.ok, true);
});

test('perangkat desa: kategori jabatan harus dikenal', () => {
  const bad = parseOfficialInput({ name: 'Budi', position: 'Kepala Desa', category: 'RAJA' });
  assert.equal(bad.ok, false);
  const good = parseOfficialInput({ name: 'Budi', position: 'Kepala Desa', category: 'KEPALA_DESA' });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.data.category, 'KEPALA_DESA');
});

test('perangkat desa: diverifikasi otomatis mengisi tanggal verifikasi', () => {
  const parsed = parseOfficialInput({ name: 'Budi', position: 'Kepala Desa', isVerified: true });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.ok(parsed.data.verifiedAt instanceof Date, 'verifiedAt harus terisi saat isVerified=true');
    assert.equal(parsed.data.archivedAt, null);
  }
});

test('perangkat desa: tidak diverifikasi selalu menghapus tanggal verifikasi', () => {
  const parsed = parseOfficialInput({
    name: 'Budi',
    position: 'Kepala Desa',
    isVerified: false,
    verifiedAt: '2024-01-01',
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.data.isVerified, false);
    assert.equal(parsed.data.verifiedAt, null);
  }
});

test('perangkat desa: arsip menandai archivedAt tanpa menghapus data', () => {
  const parsed = parseOfficialInput({ name: 'Budi', position: 'Kepala Desa', isActive: false });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.data.isActive, false);
    assert.ok(parsed.data.archivedAt instanceof Date);
  }
});

test('perangkat desa: foto harus path lokal atau URL https', () => {
  const bad = parseOfficialInput({ name: 'Budi', position: 'Kepala Desa', photo: 'javascript:alert(1)' });
  assert.equal(bad.ok, false);
  const local = parseOfficialInput({ name: 'Budi', position: 'Kepala Desa', photo: '/uploads/x.png' });
  assert.equal(local.ok, true);
  const remote = parseOfficialInput({ name: 'Budi', position: 'Kepala Desa', photo: 'http://evil.test/x.png' });
  assert.equal(remote.ok, false, 'foto http (bukan https) harus ditolak');
});

// ---------------------------------------------------------------------------
// Parser layanan desa
// ---------------------------------------------------------------------------

test('layanan desa: nama minimal 3 karakter', () => {
  assert.equal(parseServiceInput({ name: 'ab' }).ok, false);
  const ok = parseServiceInput({ name: 'Surat Keterangan Domisili' });
  assert.equal(ok.ok, true);
});

test('layanan desa: tautan harus path atau http(s)', () => {
  assert.equal(parseServiceInput({ name: 'Layanan A', link: 'ftp://x' }).ok, false);
  const ok = parseServiceInput({ name: 'Layanan A', link: '/layanan' });
  assert.equal(ok.ok, true);
});

// ---------------------------------------------------------------------------
// Parser pengumuman
// ---------------------------------------------------------------------------

test('pengumuman: judul & isi wajib; terbit mengisi publishedAt', () => {
  assert.equal(parseAnnouncementInput({ title: 'Hi', content: 'pendek' }).ok, false);
  const parsed = parseAnnouncementInput({
    title: 'Kerja Bakti Minggu Ini',
    content: 'Akan dilaksanakan kerja bakti pada hari minggu pagi di seluruh RW.',
    isPublished: true,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.ok(parsed.data.publishedAt instanceof Date);
    assert.ok(parsed.data.excerpt && parsed.data.excerpt.length > 10, 'ringkasan dibuat otomatis dari isi');
    assert.equal(parsed.data.isPublished, true);
  }
});

test('slugify menghasilkan slug aman untuk URL', () => {
  assert.equal(slugify('Kerja Bakti Minggu Ini!'), 'kerja-bakti-minggu-ini');
  assert.equal(slugify('   '), slugify('   ')); // tidak kosong, fallback unik
  assert.ok(slugify('   ').startsWith('pengumuman-'));
  assert.ok(!/[^a-z0-9-]/.test(slugify('Harga Naik 10% (2025)')));
});

// ---------------------------------------------------------------------------
// Validasi lokasi/peta
// ---------------------------------------------------------------------------

test('tautan peta hanya menerima host peta yang dikenal dan https', () => {
  assert.equal(normalizeMapLink('https://maps.app.goo.gl/abc').ok, true);
  assert.equal(normalizeMapLink('https://www.google.com/maps/place/Desa+Ciperna').ok, true);
  assert.equal(normalizeMapLink('https://www.openstreetmap.org/#map=15/-6.77/108.52').ok, true);
  assert.equal(normalizeMapLink('http://maps.app.goo.gl/abc').ok, false, 'http ditolak');
  const evil = normalizeMapLink('https://evil.test/maps');
  assert.equal(evil.ok, false, 'host di luar daftar ditolak');
});

test('embed peta hanya dari Google Maps/OpenStreetMap', () => {
  assert.equal(normalizeEmbedUrl('https://www.google.com/maps/embed?pb=x').ok, true);
  assert.equal(normalizeEmbedUrl('https://www.openstreetmap.org/export/embed.html?bbox=1').ok, true);
  assert.equal(normalizeEmbedUrl('https://evil.test/embed').ok, false);
});

test('koordinat hanya menerima rentang yang valid', () => {
  assert.equal(optionalCoordinate('-6.77', -90, 90), -6.77);
  assert.equal(optionalCoordinate('', -90, 90), null);
  assert.equal(optionalCoordinate('200', -90, 90), 'invalid');
  assert.equal(optionalCoordinate('abc', -90, 90), 'invalid');
});

// ---------------------------------------------------------------------------
// Helper identitas & pengelompokan
// ---------------------------------------------------------------------------

test('identitas desa selalu aman walau profil belum ada', () => {
  const identity = villageIdentity(null);
  assert.equal(identity.name, VILLAGE_FALLBACK.name);
  assert.equal(identity.district, VILLAGE_FALLBACK.district);
});

test('field profil yang belum terisi dilaporkan jujur (tanpa mengarang)', () => {
  const missing = missingProfileFields(null);
  assert.ok(missing.includes('alamat kantor desa'));
  assert.ok(missing.includes('visi'));
  assert.ok(missing.includes('data demografi'));
});

test('perangkat desa dikelompokkan sesuai urutan hierarki', () => {
  const make = (category: string, name: string, level = 1) => ({
    id: name,
    name,
    position: 'X',
    category,
    level,
    order: 0,
    area: null,
    period: null,
    photo: null,
    isActive: true,
    isVerified: true,
    sourceUrl: null,
    verifiedAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const groups = groupOfficials([
    make('RT_RW', 'Ketua RW 1'),
    make('KEPALA_DESA', 'Kades'),
    make('KASI', 'Kasi Pelayanan'),
  ] as never);
  assert.deepEqual(
    groups.map((g) => g.category),
    ['KEPALA_DESA', 'KASI', 'RT_RW']
  );
  assert.equal(groups[0].label, OFFICIAL_CATEGORY_LABELS.KEPALA_DESA);
});

test('label status data desa tersedia lengkap', () => {
  assert.equal(DATA_STATUS_LABELS.UNVERIFIED, 'Belum diverifikasi');
  assert.equal(DATA_STATUS_LABELS.VERIFIED, 'Terverifikasi');
});
