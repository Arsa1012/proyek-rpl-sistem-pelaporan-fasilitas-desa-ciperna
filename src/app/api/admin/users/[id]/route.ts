import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeIndonesianPhone, notifyAccountDeactivated } from '@/lib/whatsapp';
import { logAdminAction } from '@/lib/auditLog';
import { validateRtSelection } from '@/lib/region';

export const dynamic = 'force-dynamic';

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  suspendReason: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
  rt: { select: { id: true, number: true, name: true, rw: { select: { number: true } } } },
} as const;

// GET /api/admin/users/[id] — detail akun warga/petugas (ADMIN only).
// HANYA field aman. TIDAK pernah menyertakan password/hash/token.
// Menyertakan jumlah laporan/tugas dan riwayat aktivitas yang tersedia di DB.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        ...SAFE_USER_SELECT,
        _count: { select: { reports: true, assignments: true } },
      },
    });
    if (!user) {
      return NextResponse.json({ error: 'Pengguna tidak ditemukan' }, { status: 404 });
    }

    const { _count, ...safeUser } = user;

    // Riwayat terkait sesuai peran (hanya data yang benar-benar ada di database).
    let recentReports: unknown[] = [];
    let recentAssignments: unknown[] = [];
    if (safeUser.role === 'CITIZEN') {
      recentReports = await prisma.report.findMany({
        where: { userId: safeUser.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, title: true, category: true, status: true, createdAt: true },
      });
    } else if (safeUser.role === 'OFFICER') {
      recentAssignments = await prisma.assignment.findMany({
        where: { officerId: safeUser.id },
        orderBy: { assignedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          assignedAt: true,
          completedAt: true,
          cancelledAt: true,
          report: { select: { id: true, title: true, status: true } },
        },
      });
    }

    // Jejak audit tindakan administratif terhadap akun ini (bila ada).
    const auditTrail = await prisma.adminAuditLog.findMany({
      where: { targetUserId: safeUser.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, action: true, notes: true, createdAt: true },
    });

    return NextResponse.json({
      user: safeUser,
      counts: { reports: _count.reports, assignments: _count.assignments },
      recentReports,
      recentAssignments,
      auditTrail,
    });
  } catch (error) {
    console.error('[GET /api/admin/users/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// PATCH /api/admin/users/[id] — (a) nonaktifkan/aktifkan akun, atau
// (b) sunting nama/email/nomor WA. ADMIN only. Soft-disable: data, laporan,
// dan riwayat TIDAK dihapus. Role TIDAK pernah dapat diubah lewat endpoint ini.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) {
      return NextResponse.json({ error: 'Pengguna tidak ditemukan' }, { status: 404 });
    }
    if (target.id === session.userId) {
      return NextResponse.json({ error: 'Gunakan halaman Profil untuk mengubah akun Anda sendiri' }, { status: 403 });
    }
    if (target.role === 'ADMIN') {
      return NextResponse.json({ error: 'Akun Admin tidak dapat diubah melalui menu ini' }, { status: 403 });
    }

    const hasProfileFields =
      Object.prototype.hasOwnProperty.call(body, 'name') ||
      Object.prototype.hasOwnProperty.call(body, 'email') ||
      Object.prototype.hasOwnProperty.call(body, 'phone');
    const hasRegionField = Object.prototype.hasOwnProperty.call(body, 'rtId');
    const hasActiveField = typeof body.isActive === 'boolean';

    // (a) Aktif/nonaktifkan akun.
    if (hasActiveField && !hasProfileFields && !hasRegionField) {
      const willBeInactive = body.isActive === false;
      const rawReason = typeof body.suspendReason === 'string' ? body.suspendReason.trim() : '';
      if (willBeInactive && !rawReason) {
        return NextResponse.json(
          { error: 'Alasan penonaktifan wajib diisi agar dapat dikirimkan ke pemilik akun.' },
          { status: 400 }
        );
      }
      if (rawReason.length > 500) {
        return NextResponse.json({ error: 'Alasan penonaktifan maksimal 500 karakter' }, { status: 400 });
      }
      const suspendReason = willBeInactive ? rawReason : null;

      const updated = await prisma.user.update({
        where: { id: params.id },
        data: { isActive: body.isActive, suspendReason },
        select: { id: true, name: true, email: true, role: true, isActive: true, suspendReason: true },
      });

      await logAdminAction({
        adminId: session.userId,
        action: body.isActive ? 'ENABLE_USER' : 'DISABLE_USER',
        targetUserId: target.id,
        notes: willBeInactive
          ? `${target.name} (${target.email}) - alasan: ${suspendReason}`
          : `${target.name} (${target.email})`,
      });

      // Notifikasi WhatsApp penonaktifan (best-effort, tidak menunda respons).
      if (willBeInactive) {
        void notifyAccountDeactivated({
          userId: updated.id,
          name: target.name,
          phone: target.phone,
          reason: suspendReason || '',
          dedupeKey: `account-deactivated:${updated.id}:${Date.now()}`,
        }).catch((error) => {
          console.error('[PATCH /api/admin/users/[id]] notifikasi penonaktifan gagal:', error);
        });
      }

      return NextResponse.json({ success: true, user: updated });
    }

    // (b) Sunting data profil (nama/email/nomor WA).
    if (hasProfileFields) {
      const data: { name?: string; email?: string; phone?: string | null } = {};

      if (Object.prototype.hasOwnProperty.call(body, 'name')) {
        const name = String(body.name || '').trim();
        if (name.length < 2 || name.length > 100) {
          return NextResponse.json({ error: 'Nama harus antara 2-100 karakter' }, { status: 400 });
        }
        data.name = name;
      }

      if (Object.prototype.hasOwnProperty.call(body, 'email')) {
        const email = String(body.email || '').trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return NextResponse.json({ error: 'Format email tidak valid' }, { status: 400 });
        }
        const taken = await prisma.user.findFirst({ where: { email, id: { not: target.id } } });
        if (taken) {
          return NextResponse.json({ error: 'Email sudah digunakan akun lain' }, { status: 409 });
        }
        data.email = email;
      }

      if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
        const raw = String(body.phone || '').trim();
        if (raw === '') {
          data.phone = null;
        } else {
          const normalized = normalizeIndonesianPhone(raw);
          if (!normalized) {
            return NextResponse.json({ error: 'Format Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.' }, { status: 400 });
          }
          const taken = await prisma.user.findFirst({ where: { phone: normalized, id: { not: target.id } } });
          if (taken) {
            return NextResponse.json({ error: 'Nomor WhatsApp sudah digunakan akun lain' }, { status: 409 });
          }
          data.phone = normalized;
        }
      }

      if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: 'Tidak ada perubahan yang dikirim' }, { status: 400 });
      }

      const updated = await prisma.user.update({
        where: { id: params.id },
        data,
        select: SAFE_USER_SELECT,
      });

      await logAdminAction({
        adminId: session.userId,
        action: 'EDIT_USER',
        targetUserId: target.id,
        notes: `${target.name} (${target.email})`,
      });

      return NextResponse.json({ success: true, user: updated });
    }

    // (c) Pindahkan wilayah (RT/RW) pengguna dengan audit trail.
    // Tidak mengubah role. Menolak RT nonaktif / tidak ada (validasi server).
    if (hasRegionField && !hasProfileFields) {
      const raw = body.rtId === null || body.rtId === undefined ? '' : String(body.rtId).trim();
      let newRtId: string | null = null;
      let label = 'tanpa wilayah';
      if (raw !== '') {
        const region = await validateRtSelection(raw);
        if (!region.ok) {
          return NextResponse.json({ error: region.error }, { status: 400 });
        }
        newRtId = region.rt ? region.rt.id : null;
        if (region.rt) label = `RT ${region.rt.number} / RW ${region.rt.rw.number}`;
      }

      const updated = await prisma.user.update({
        where: { id: params.id },
        data: { rtId: newRtId },
        select: SAFE_USER_SELECT,
      });

      await logAdminAction({
        adminId: session.userId,
        action: 'MOVE_USER_REGION',
        targetUserId: target.id,
        notes: `${target.name} (${target.email}) → ${label}`,
      });

      return NextResponse.json({ success: true, user: updated });
    }

    return NextResponse.json(
      { error: 'Field isActive (boolean), name/email/phone, atau rtId wajib diisi' },
      { status: 400 }
    );
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Email atau Nomor WhatsApp sudah digunakan akun lain' }, { status: 409 });
    }
    console.error('[PATCH /api/admin/users/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
