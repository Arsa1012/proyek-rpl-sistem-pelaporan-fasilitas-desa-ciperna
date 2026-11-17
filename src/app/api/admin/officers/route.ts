import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeIndonesianPhone, notifyOfficerAccountCreated } from '@/lib/whatsapp';
import { validatePassword, generateTemporaryPassword } from '@/lib/password';
import { logAdminAction } from '@/lib/auditLog';
import { createAccountToken, buildActivationUrl } from '@/lib/accountTokens';

export const dynamic = 'force-dynamic';

type CredentialMode = 'ACTIVATION' | 'TEMP' | 'PASSWORD';

// POST /api/admin/officers — daftarkan akun PETUGAS baru (ADMIN only).
//
// Keamanan:
// - Role SELALU dipaksa 'OFFICER' di server (tidak dipercaya dari browser).
// - Kata sandi hanya disimpan sebagai hash bcrypt (mekanisme sama dengan registrasi).
// - Tidak pernah mengembalikan field password/hash kecuali kata sandi SEMENTARA
//   yang dibuat sistem (ditampilkan SEKALI, tidak pernah dikirim via WhatsApp).
// - Mode aktivasi (disarankan): akun dibuat dengan kata sandi acak yang tidak
//   diketahui siapa pun + tautan aktivasi ber-token sekali pakai. Kata sandi
//   TIDAK PERNAH dikirim melalui WhatsApp.
// - Notifikasi WhatsApp berisi tautan aktivasi / info akun (tanpa kata sandi).
//   Bila WA gagal, akun tetap tersimpan dan Admin dapat mengirim ulang tautan.
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phoneRaw = String(body.phone || '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
    const modeRaw = String(body.credentialMode || '').trim().toUpperCase();

    if (!name || !email) {
      return NextResponse.json({ error: 'Nama dan email wajib diisi' }, { status: 400 });
    }
    if (name.length < 2 || name.length > 100) {
      return NextResponse.json({ error: 'Nama harus antara 2-100 karakter' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Format email tidak valid' }, { status: 400 });
    }

    let normalizedPhone: string | null = null;
    if (phoneRaw !== '') {
      normalizedPhone = normalizeIndonesianPhone(phoneRaw);
      if (!normalizedPhone) {
        return NextResponse.json({ error: 'Format Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.' }, { status: 400 });
      }
    }

    // Tentukan mode kredensial. Tanpa mode eksplisit: perilaku lama dipertahankan
    // (kata sandi bila diisi, selain itu kata sandi sementara).
    let mode: CredentialMode;
    if (modeRaw === 'ACTIVATION' || modeRaw === 'TEMP' || modeRaw === 'PASSWORD') {
      mode = modeRaw as CredentialMode;
    } else {
      mode = password === '' ? 'TEMP' : 'PASSWORD';
    }

    if (mode === 'PASSWORD') {
      const policyError = validatePassword(password);
      if (policyError) {
        return NextResponse.json({ error: policyError }, { status: 400 });
      }
      if (password !== confirmPassword) {
        return NextResponse.json({ error: 'Konfirmasi kata sandi tidak cocok' }, { status: 400 });
      }
    }
    if (mode === 'ACTIVATION' && !normalizedPhone) {
      return NextResponse.json(
        { error: 'Mode aktivasi memerlukan Nomor WhatsApp petugas untuk mengirim tautan aktivasi.' },
        { status: 400 }
      );
    }

    // Cegah akun duplikat (email unik + nomor WA unik level aplikasi).
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return NextResponse.json({ error: 'Email sudah terdaftar pada akun lain' }, { status: 409 });
    }
    if (normalizedPhone) {
      const existingPhone = await prisma.user.findFirst({ where: { phone: normalizedPhone } });
      if (existingPhone) {
        return NextResponse.json({ error: 'Nomor WhatsApp sudah terdaftar pada akun lain' }, { status: 409 });
      }
    }

    // Kredensial awal.
    // - ACTIVATION: kata sandi acak TIDAK diketahui siapa pun sampai aktivasi.
    // - TEMP: kata sandi sementara dikembalikan sekali ke Admin.
    // - PASSWORD: kata sandi ditetapkan Admin.
    const plainPassword =
      mode === 'PASSWORD' ? password : generateTemporaryPassword(16);
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    // Role DIPAKSA OFFICER di server.
    const officer = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone: normalizedPhone,
        role: 'OFFICER',
        isActive: true,
        mustChangePassword: mode !== 'PASSWORD',
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });

    await logAdminAction({
      adminId: session.userId,
      action: 'CREATE_OFFICER',
      targetUserId: officer.id,
      notes: `${officer.name} (${officer.email}) — mode=${mode}`,
    });

    // Tautan aktivasi (mode ACTIVATION) + notifikasi WhatsApp ke petugas.
    let activationUrl: string | undefined;
    let whatsapp: 'sent' | 'failed' | 'skipped' | 'no_phone' = 'skipped';
    if (mode === 'ACTIVATION') {
      const token = await createAccountToken({
        userId: officer.id,
        purpose: 'ACTIVATION',
        createdBy: session.userId,
      });
      activationUrl = buildActivationUrl(token.raw);
    }

    if (normalizedPhone) {
      try {
        const res = await notifyOfficerAccountCreated({
          userId: officer.id,
          activationUrl,
          usedTemporaryPassword: mode === 'TEMP',
        });
        whatsapp = res.ok ? 'sent' : res.skipped ? 'skipped' : 'failed';
      } catch (e) {
        console.error('[POST /api/admin/officers] notifikasi WA gagal (akun tetap tersimpan):', e);
        whatsapp = 'failed';
      }
    } else {
      whatsapp = 'no_phone';
    }

    const message =
      mode === 'ACTIVATION'
        ? whatsapp === 'sent'
          ? 'Akun petugas berhasil dibuat. Tautan aktivasi telah dikirim ke WhatsApp petugas.'
          : 'Akun petugas berhasil dibuat, namun notifikasi WhatsApp gagal terkirim. Anda dapat mengirim ulang tautan aktivasi.'
        : mode === 'TEMP'
          ? 'Akun petugas berhasil dibuat. Kata sandi sementara ditampilkan sekali.'
          : 'Akun petugas berhasil dibuat.';

    return NextResponse.json(
      {
        success: true,
        message,
        officer,
        mode,
        whatsapp,
        // Tautan aktivasi ditampilkan ke Admin agar bisa diteruskan melalui
        // kanal lain bila WhatsApp gagal. Token sekali pakai & berbatas waktu.
        activationUrl,
        // Hanya untuk mode TEMP, ditampilkan SEKALI. Tidak pernah disimpan/di-log.
        temporaryPassword: mode === 'TEMP' ? plainPassword : undefined,
      },
      { status: 201 }
    );
  } catch (error: any) {
    // Tangani balapan unique constraint tanpa membocorkan detail database.
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Email atau Nomor WhatsApp sudah terdaftar' }, { status: 409 });
    }
    console.error('[POST /api/admin/officers]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
