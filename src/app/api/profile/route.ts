import { NextRequest, NextResponse } from 'next/server';
import { getSession, encrypt } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeIndonesianPhone } from '@/lib/whatsapp';
import { validateRtSelection } from '@/lib/region';
import { cookies } from 'next/headers';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

// GET /api/profile - data akun milik sendiri (tanpa kata sandi/token).
// Dipakai halaman yang butuh status akun terkini (mis. banner nonaktif).
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        photo: true,
        role: true,
        isActive: true,
        suspendReason: true,
        createdAt: true,
        rt: { select: { id: true, number: true, name: true, rw: { select: { id: true, number: true, name: true } } } },
      },
    });
    if (!user) {
      return NextResponse.json({ error: 'Akun tidak ditemukan' }, { status: 404 });
    }
    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error('[GET /api/profile]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// PATCH /api/profile — ubah profil milik sendiri (nama, email, nomor WA, foto).
// Tidak pernah menyentuh password (endpoint terpisah: /api/profile/password).
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }

    const formData = await request.formData();
    const name = ((formData.get('name') as string) || '').trim();
    const email = ((formData.get('email') as string) || '').trim();
    const phoneRaw = ((formData.get('phone') as string) || '').trim();
    const photoFile = formData.get('photo') as File | null;

    const data: { name?: string; email?: string; phone?: string | null; photo?: string; rtId?: string | null } = {};

    if (name) {
      if (name.length < 2 || name.length > 100) {
        return NextResponse.json({ error: 'Nama harus antara 2-100 karakter' }, { status: 400 });
      }
      data.name = name;
    }

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return NextResponse.json({ error: 'Format email tidak valid' }, { status: 400 });
      }
      const taken = await prisma.user.findFirst({ where: { email, id: { not: session.userId } } });
      if (taken) {
        return NextResponse.json({ error: 'Email sudah digunakan akun lain' }, { status: 409 });
      }
      data.email = email;
    }

    if (phoneRaw !== '') {
      const normalized = normalizeIndonesianPhone(phoneRaw);
      if (!normalized) {
        return NextResponse.json({ error: 'Format Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.' }, { status: 400 });
      }
      const taken = await prisma.user.findFirst({ where: { phone: normalized, id: { not: session.userId } } });
      if (taken) {
        return NextResponse.json({ error: 'Nomor WhatsApp sudah digunakan akun lain' }, { status: 409 });
      }
      data.phone = normalized;
    } else if (formData.has('phone')) {
      data.phone = null;
    }

    if (photoFile && photoFile.size > 0) {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(photoFile.type)) {
        return NextResponse.json({ error: 'Foto profil harus JPG, PNG, atau WebP' }, { status: 400 });
      }
      if (photoFile.size > 2 * 1024 * 1024) {
        return NextResponse.json({ error: 'Ukuran foto profil maksimal 2MB' }, { status: 400 });
      }
      const bytes = await photoFile.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const magic = buffer.slice(0, 4);
      const valid =
        (magic[0] === 0xFF && magic[1] === 0xD8 && magic[2] === 0xFF) ||
        (magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4E && magic[3] === 0x47) ||
        (magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46);
      if (!valid) {
        return NextResponse.json({ error: 'File foto tidak valid' }, { status: 400 });
      }
      const extMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const filename = `profile_${session.userId}_${Date.now()}.${extMap[photoFile.type] || 'jpg'}`;
      const uploadDir = path.join(process.cwd(), 'public', 'uploads');
      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, filename), buffer);
      data.photo = `/uploads/${filename}`;
    }

    if (formData.has('rtId')) {
      const rtRaw = ((formData.get('rtId') as string) || '').trim();
      if (rtRaw === '') {
        data.rtId = null;
      } else {
        const region = await validateRtSelection(rtRaw);
        if (!region.ok) {
          return NextResponse.json({ error: region.error }, { status: 400 });
        }
        data.rtId = region.rt ? region.rt.id : null;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan yang dikirim' }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id: session.userId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        photo: true,
        role: true,
        rt: { select: { id: true, number: true, name: true, rw: { select: { id: true, number: true, name: true } } } },
      },
    });

    // Perbarui sesi agar nama/email tampilan sinkron (tanpa mengubah masa berlaku dasar)
    if (data.email || data.name) {
      const token = await encrypt({ userId: user.id, email: user.email, role: user.role as 'CITIZEN' | 'ADMIN' | 'OFFICER' }, '24h');
      cookies().set({ name: 'session', value: token, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 });
    }

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error('[PATCH /api/profile]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
