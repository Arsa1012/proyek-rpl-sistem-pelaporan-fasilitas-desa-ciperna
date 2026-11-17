/**
 * Seed ADDITIF untuk profil Desa Ciperna.
 *
 * Aman dijalankan berulang kali:
 * - Hanya membuat baris profil bila belum ada.
 * - TIDAK menimpa perubahan Admin (update: {}).
 * - TIDAK menghapus/mengubah data laporan, akun, atau tabel lain.
 *
 * Sumber awal: Wikipedia (referensi awal, bukan penetapan resmi pemerintah).
 * Status sengaja PARTIAL dan verifiedAt null sampai Admin/desa memverifikasi.
 *
 * Jalankan: npx tsx prisma/seed-village.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const WIKIPEDIA = 'https://id.wikipedia.org/wiki/Ciperna,_Talun,_Cirebon';

async function main() {
  const existing = await prisma.villageProfile.findUnique({ where: { id: 'singleton' } });
  if (existing) {
    console.log('Profil desa sudah ada — tidak diubah.');
    return;
  }

  await prisma.villageProfile.create({
    data: {
      id: 'singleton',
      name: 'Desa Ciperna',
      district: 'Talun',
      regency: 'Cirebon',
      province: 'Jawa Barat',
      latitude: -6.7703,
      longitude: 108.5278,
      coordinateSource: `Wikipedia — ${WIKIPEDIA}`,
      mapLink: 'https://maps.app.goo.gl/whfxyvVNHPspd1Ra8',
      history:
        'Desa Ciperna berada di Kecamatan Talun, Kabupaten Cirebon, Jawa Barat. ' +
        'Wilayah ini dilalui Jalan Tol Palimanan–Kanci dan dikenal sebagai daerah pertanian ' +
        'dengan komoditas utama padi. Berdasarkan referensi awal, di wilayah desa terdapat ' +
        'perumahan dan taman desa, objek wisata Ciperna Waterpark, serta landasan akhir ' +
        'Bandar Udara Cakrabuana.',
      historySource: WIKIPEDIA,
      geography:
        'Secara administratif Desa Ciperna berada di Kecamatan Talun, Kabupaten Cirebon, ' +
        'Provinsi Jawa Barat, pada koordinat sekitar 6,7703° Lintang Selatan dan ' +
        '108,5278° Bujur Timur (referensi awal Wikipedia).',
      potential:
        'Sektor pertanian, khususnya padi, disebut sebagai komoditas utama desa dalam ' +
        'referensi awal. Potensi lain belum diverifikasi oleh pemerintah desa.',
      dataStatus: 'PARTIAL',
      sourceUrl: WIKIPEDIA,
      // Belum diverifikasi pemerintah desa. Jangan diisi tanggal palsu.
      verifiedAt: null,
    },
  });

  console.log('Profil Desa Ciperna dibuat (status: PARTIAL, sumber: Wikipedia).');
}

main()
  .catch((error) => {
    console.error('Gagal membuat profil desa:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
