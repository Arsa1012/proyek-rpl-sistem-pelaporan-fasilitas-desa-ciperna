import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAdminWhatsApp, whatsappConfigStatus } from '@/lib/whatsapp';
import { getWhatsAppMonitoringStatus } from '@/lib/whatsappMonitoring';
import {
  getActiveFonnteConfig,
  getAllFonnteConfigs,
  resolveActiveFonnteConfig,
  sanitizePhoneInput,
  sanitizeTokenInput,
} from '@/lib/fonnteConfig';
import { resolveActiveRecipient } from '@/lib/notificationRecipients';

export const dynamic = 'force-dynamic';
export const revalidate = 0; // real-time, tidak cache

// GET /api/admin/whatsapp-config — daftar semua konfigurasi Fonnte (ADMIN only)
// Menampilkan: semua perangkat, nomor admin aktif, status konfigurasi
// TIDAK mengembalikan token ke klien
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    // Ambil semua konfigurasi dari database
    const allConfigs = await getAllFonnteConfigs();
    const activeConfig = await getActiveFonnteConfig();
    // Konfigurasi aktif = SATU sumber kebenaran yang sama dengan jalur kirim.
    const resolved = await resolveActiveFonnteConfig();
    const envAdmin = await getAdminWhatsApp();
    const configStatus = await whatsappConfigStatus();

    // Susun daftar perangkat untuk UI (tanpa token)
    const devices = allConfigs.map((c) => ({
      id: c.id,
      deviceName: c.deviceName || 'Tanpa Nama',
      adminPhone: sanitizePhoneInput(c.adminPhone),
      isActive: c.isActive,
      hasToken: Boolean(sanitizeTokenInput(c.token)),
      lastValidation: c.lastValidation,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    // Nomor Admin PENERIMA mengikuti perangkat aktif.
    const activeAdminPhone = resolved.adminPhone || envAdmin || null;
    const configSource = resolved.source;

    // Nomor PENERIMA notifikasi (dipisah dari perangkat pengirim, A7).
    // `legacyAdminPhone` = nomor admin milik perangkat Fonnte (info migrasi).
    const recipient = await resolveActiveRecipient();

    // Cek koneksi Fonnte aktif atau tidak (tanpa pernah membocorkan token)
    const fonnteTokenPresent = resolved.tokenValid || Boolean(process.env.FONNTE_TOKEN);

    // Status monitoring (satu sumber kebenaran di lib/whatsappMonitoring.ts)
    const monitoring = await getWhatsAppMonitoringStatus();

    return NextResponse.json({
      // Daftar semua perangkat (tanpa token)
      devices,
      // Perangkat aktif saat ini
      activeDevice: activeConfig
        ? {
            id: activeConfig.id,
            deviceName: activeConfig.deviceName || 'Tanpa Nama',
            adminPhone: sanitizePhoneInput(activeConfig.adminPhone),
            lastValidation: activeConfig.lastValidation,
          }
        : null,
      // Nomor Admin penerima notifikasi (mengikuti perangkat aktif)
      adminPhone: activeAdminPhone || null,
      // Nomor admin milik perangkat PENGIRIM (informasi migrasi, bukan penerima)
      legacyAdminPhone: sanitizePhoneInput(activeConfig?.adminPhone) || null,
      // Nomor PENERIMA notifikasi aktif (tabel NotificationRecipient)
      activeRecipient: recipient.phone
        ? { phone: recipient.phone, label: recipient.label }
        : null,
      // Masalah penerima (aman, tanpa nomor penuh selain yang ditampilkan)
      recipientProblems: recipient.problems,
      recipientSource: recipient.source,
      // Status koneksi Fonnte
      fonnteConfigured: configStatus.configured,
      // Sumber konfigurasi (database = perangkat aktif, env = belum ada perangkat)
      configSource,
      // Masalah konfigurasi (aman untuk ditampilkan, tanpa rahasia)
      problems: resolved.problems,
      // Status verifikasi lengkap
      configured: configStatus.configured,
      // Missing fields info (aman untuk log, tidak ada token)
      missing: configStatus.missing,
      // Timestamp konfigurasi terakhir
      lastValidation: activeConfig?.lastValidation
        ? new Date(activeConfig.lastValidation).toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : null,
      // Info tambahan untuk UI
      info: {
        fonnteTokenSet: fonnteTokenPresent,
        adminPhoneFromDb: resolved.source === 'database',
        adminPhoneFromEnv: resolved.source === 'env',
        rolesAllowed: ['ADMIN'],
        totalDevices: allConfigs.length,
        activeDevices: allConfigs.filter((c) => c.isActive).length,
      },
      // Monitoring WhatsApp Fonnte (tanpa token / nomor lengkap di log)
      whatsappMonitoring: {
        deviceName: monitoring.deviceName,
        adminPhone: monitoring.adminPhone,
        activeRecipientPhone: monitoring.activeRecipientPhone ?? null,
        activeRecipientLabel: monitoring.activeRecipientLabel ?? null,
        hasActiveRecipient: monitoring.hasActiveRecipient ?? false,
        isActive: monitoring.isActive,
        isConfigured: monitoring.isConfigured,
        connectionStatus: monitoring.connectionStatus,
        connectionStatusBasis: monitoring.connectionStatusBasis,
        configSource: monitoring.configSource,
        problems: monitoring.problems,
        hasSuccessfulDelivery: monitoring.hasSuccessfulDelivery,
        lastValidation: monitoring.lastValidation ? monitoring.lastValidation.toISOString() : null,
        lastCheckedAt: monitoring.lastCheckedAt.toISOString(),
        deliverySummary: monitoring.deliverySummary,
        note: monitoring.note,
      },
    });
  } catch (error) {
    console.error('[GET /api/admin/whatsapp-config]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// POST /api/admin/whatsapp-config — tambah konfigurasi Fonnte baru (ADMIN only)
// Body: { deviceName, adminPhone, token }
// Token TIDAK dikembalikan ke klien
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const body = await request.json();
    const { deviceName, adminPhone, token } = body;
    // Normalisasi: tanda kutip/spasi dibuang agar konfigurasi tersimpan rapi
    // dan langsung bisa dipakai sebagai perangkat pengirim.
    const cleanPhone = sanitizePhoneInput(adminPhone);
    const cleanToken = sanitizeTokenInput(token);

    // Validasi input
    if (!deviceName || !deviceName.trim()) {
      return NextResponse.json({ error: 'Nama perangkat wajib diisi' }, { status: 400 });
    }
    if (!cleanPhone) {
      return NextResponse.json({ error: 'Nomor admin wajib diisi' }, { status: 400 });
    }
    if (!cleanToken) {
      return NextResponse.json({ error: 'Token Fonnte wajib diisi' }, { status: 400 });
    }

    // Validasi format nomor telepon sederhana
    const phoneRegex = /^(\+62|62|0)8\d{8,13}$/;
    if (!phoneRegex.test(cleanPhone)) {
      return NextResponse.json({ error: 'Nomor admin tidak valid (format: 08xxxx atau 62xxxx)' }, { status: 400 });
    }

    // Cek apakah nama perangkat sudah ada
    const existing = await prisma.fonnteConfig.findFirst({
      where: { deviceName: deviceName.trim() },
    });
    if (existing) {
      return NextResponse.json({ error: 'Nama perangkat sudah digunakan' }, { status: 400 });
    }

    // Cek apakah nomor admin sudah ada
    const existingPhone = await prisma.fonnteConfig.findFirst({
      where: { adminPhone: cleanPhone },
    });
    if (existingPhone) {
      return NextResponse.json({ error: 'Nomor admin sudah terdaftar' }, { status: 400 });
    }

    // Buat perangkat baru (tidak aktif secara default)
    const newConfig = await prisma.fonnteConfig.create({
      data: {
        deviceName: deviceName.trim(),
        adminPhone: cleanPhone,
        token: cleanToken,
        isActive: false,
        lastValidation: null,
      },
    });

    // Kembalikan response TANPA token
    return NextResponse.json({
      success: true,
      message: 'Konfigurasi Fonnte berhasil ditambahkan',
      device: {
        id: newConfig.id,
        deviceName: newConfig.deviceName,
        adminPhone: newConfig.adminPhone,
        isActive: newConfig.isActive,
        lastValidation: newConfig.lastValidation,
        createdAt: newConfig.createdAt,
        updatedAt: newConfig.updatedAt,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/admin/whatsapp-config]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}