import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { encrypt, buildSessionPayload } from '@/lib/auth';
import { cookies } from 'next/headers';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { prisma } from '@/lib/prisma';
import { normalizeIndonesianPhone, notifyAdminLogin, parseDeviceInfo, formatLoginTime, formatIpLabel } from '@/lib/whatsapp';

// Rate limit: 5 attempts per 15 minutes per IP
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW = 15 * 60 * 1000; // 15 minutes

const roleHome: Record<string, string> = {
  CITIZEN: '/masyarakat/dashboard',
  ADMIN: '/admin/dashboard',
  OFFICER: '/petugas/dashboard',
};

const roleLabel: Record<string, string> = {
  CITIZEN: 'Masyarakat',
  ADMIN: 'Admin',
  OFFICER: 'Petugas',
};

export async function POST(request: Request) {
  try {
    // Rate limiting check
    const clientIp = getClientIp(request);
    const rateKey = `login:${clientIp}`;
    const rateResult = rateLimit(rateKey, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW);

    if (!rateResult.allowed) {
      return NextResponse.json(
        {
          error: 'Terlalu banyak percobaan login. Silakan coba lagi nanti.',
          retryAfter: rateResult.retryAfter,
        },
        { status: 429 }
      );
    }

    const { email, phone, identifier: rawIdentifier, password, role: expectedRole, rememberMe } = await request.json();

    // Identitas login: email (cara lama) atau nomor HP/WhatsApp (alternatif).
    // Frontend baru mengirim satu field `identifier` yang terdeteksi otomatis.
    // Keduanya memakai password, sesi, cookie, role, dan redirect yang sama.
    const identifier = String(rawIdentifier || email || phone || '').trim();

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Email/Nomor HP dan password wajib diisi' }, { status: 400 });
    }

    // Find user by email or normalized phone. Pesan error seragam agar
    // tidak membocorkan apakah identitas tertentu terdaftar.
    const GENERIC_ERROR = 'Email/Nomor HP atau password salah';
    let user = null;
    if (identifier.includes('@')) {
      user = await prisma.user.findUnique({
        where: { email: identifier },
      });
    } else {
      const normalized = normalizeIndonesianPhone(identifier);
      if (!normalized) {
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
      }
      user = await prisma.user.findFirst({
        where: { phone: normalized },
      });
    }

    if (!user) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    // Compare password
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    // Akun yang dinonaktifkan Admin TETAP boleh login untuk melihat status akun.
    // Pembatasan dilakukan pada fitur utama (mis. POST /api/reports) dan
    // ditampilkan sebagai banner dashboard berisi alasan penonaktifan.

    // Validate selected role against the account's actual role
    if (expectedRole && expectedRole !== user.role) {
      return NextResponse.json(
        { error: `Role akun tidak sesuai. Akun ini terdaftar sebagai ${roleLabel[user.role] || user.role}. Silakan pilih role yang sesuai.` },
        { status: 403 }
      );
    }

    // Create session token
    // "Ingat perangkat ini" = sesi persisten 30 hari (HttpOnly cookie).
    // Tanpa itu, sesi 24 jam. Tidak ada password yang disimpan di sisi klien.
    const remember = rememberMe === true;
    const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24;
    const sessionData = buildSessionPayload({
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      suspendReason: user.suspendReason,
    });

    const token = await encrypt(sessionData, remember ? '30d' : '24h');

    // Peringatan keamanan real-time HANYA untuk login ADMIN.
    // Fire-and-forget: kegagalan Fonnte tidak memperlambat/menggagalkan login.
    if (user.role === 'ADMIN') {
      const ua = request.headers.get('user-agent') || '';
      const alert = {
        adminName: user.name,
        adminEmail: user.email,
        time: formatLoginTime(),
        device: parseDeviceInfo(ua),
        ipLabel: formatIpLabel(clientIp),
        dedupeKey: `admin-login:${user.id}:${Date.now()}`,
      };
      void notifyAdminLogin(alert).catch((e) => console.error('[Login] Notifikasi admin gagal:', e));
    }

    // Kata sandi sementara dari Admin: wajib diganti sebelum memakai dashboard.
    if (user.mustChangePassword) {
      const response = NextResponse.json({
        success: true,
        message: 'Login berhasil. Anda wajib mengganti kata sandi sementara terlebih dahulu.',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          suspendReason: user.suspendReason ?? null,
        },
        mustChangePassword: true,
        redirectUrl: '/ubah-password',
      }, { status: 200 });
      response.cookies.set({
        name: 'session',
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge,
      });
      return response;
    }

    const response = NextResponse.json({
      success: true,
      message: user.isActive === false
        ? 'Login berhasil. Akun Anda sedang nonaktif; silakan baca pemberitahuan pada dashboard.'
        : `Login berhasil sebagai ${roleLabel[user.role] || user.role}.`,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        suspendReason: user.suspendReason ?? null,
      },
      accountInactive: user.isActive === false,
      mustChangePassword: false,
      redirectUrl: roleHome[user.role] || '/',
    }, { status: 200 });
    response.cookies.set({
      name: 'session',
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

