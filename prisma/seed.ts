import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seeding...');

  // Hash password for all seed users
  const hashedPassword = await bcrypt.hash('password123', 10);

  // Create Users
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      name: 'Admin System',
      email: 'admin@example.com',
      password: hashedPassword,
      role: 'ADMIN',
    },
  });

  // Admin Desa Ciperna (akun testing utama)
  const hashedAdminCiperna = await bcrypt.hash('Admin123!', 10);
  await prisma.user.upsert({
    where: { email: 'admin@ciperna.id' },
    update: { name: 'Admin Sistem', password: hashedAdminCiperna, role: 'ADMIN' },
    create: {
      name: 'Admin Sistem',
      email: 'admin@ciperna.id',
      password: hashedAdminCiperna,
      role: 'ADMIN',
    },
  });

  const officer1 = await prisma.user.upsert({
    where: { email: 'officer1@example.com' },
    update: {},
    create: {
      name: 'Petugas Satu',
      email: 'officer1@example.com',
      password: hashedPassword,
      role: 'OFFICER',
    },
  });

  const officer2 = await prisma.user.upsert({
    where: { email: 'officer2@example.com' },
    update: {},
    create: {
      name: 'Petugas Dua',
      email: 'officer2@example.com',
      password: hashedPassword,
      role: 'OFFICER',
    },
  });

  const citizen1 = await prisma.user.upsert({
    where: { email: 'citizen1@example.com' },
    update: {},
    create: {
      name: 'Budi Citizen',
      email: 'citizen1@example.com',
      password: hashedPassword,
      role: 'CITIZEN',
    },
  });

  const citizen2 = await prisma.user.upsert({
    where: { email: 'citizen2@example.com' },
    update: {},
    create: {
      name: 'Siti Citizen',
      email: 'citizen2@example.com',
      password: hashedPassword,
      role: 'CITIZEN',
    },
  });

  console.log('Users created');

  // Create Reports (foto bukti memakai path lokal, bukan URL dummy eksternal)
  const report1 = await prisma.report.create({
    data: {
      title: 'Lampu Jalan Mati',
      description: 'Lampu jalan di pertigaan mati sudah 2 hari.',
      location: 'Jl. Merdeka No. 1',
      latitude: -6.200000,
      longitude: 106.816666,
      category: 'Infrastruktur',
      damageType: 'Listrik',
      severity: 'Medium',
      status: 'SUBMITTED',
      userId: citizen1.id,
    },
  });

  const report2 = await prisma.report.create({
    data: {
      title: 'Jalan Berlubang',
      description: 'Ada lubang besar di tengah jalan, sangat bahaya.',
      location: 'Jl. Sudirman No. 10',
      latitude: -6.205000,
      longitude: 106.820000,
      category: 'Jalan Raya',
      damageType: 'Struktur',
      severity: 'High',
      status: 'IN_PROGRESS',
      userId: citizen2.id,
      assignments: {
        create: {
          officerId: officer1.id,
          notes: 'Sedang dilakukan penambalan sementara',
        }
      }
    },
  });

  const report3 = await prisma.report.create({
    data: {
      title: 'Taman Rusak',
      description: 'Bangku taman hancur.',
      location: 'Taman Kota',
      latitude: -6.210000,
      longitude: 106.810000,
      category: 'Fasilitas Umum',
      damageType: 'Vandalisme',
      severity: 'Low',
      status: 'COMPLETED',
      userId: citizen1.id,
      assignments: {
        create: {
          officerId: officer2.id,
          completedAt: new Date(),
          notes: 'Bangku sudah diganti dengan yang baru',
        }
      },
      evidences: {
        create: {
          photo: '/uploads/seed-evidence-taman.jpg',
          description: 'Bukti perbaikan bangku taman',
        }
      }
    },
  });

  console.log('Reports created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
