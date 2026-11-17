import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getActiveFonnteConfig, buildFonnteConfigPatch, sanitizePhoneInput, sanitizeTokenInput, setActiveFonnteConfig, updateFonnteConfig } from '@/lib/fonnteConfig';

// PATCH /api/admin/whatsapp-config/[id] — ubah konfigurasi (ADMIN only)
// Body: { deviceName?, adminPhone?, token?, isActive? }
// Token TIDAK dikembalikan ke klien
export async function PATCH(
  request: Request,
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

    const { id } = params;

    // Cek apakah konfigurasi exists
    const existing = await prisma.fonnteConfig.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Konfigurasi tidak ditemukan' }, { status: 404 });
    }

    const body = await request.json();
    const { deviceName, adminPhone, token, isActive } = body;

    // Validasi + susun patch (fungsi murni, diuji terpisah).
    // Token bersifat OPSIONAL: kolom kosong = pertahankan token lama.
    const built = buildFonnteConfigPatch(
      { deviceName, adminPhone, token },
      { deviceName: existing.deviceName, adminPhone: existing.adminPhone }
    );
    if (!built.ok) {
      return NextResponse.json({ error: built.error }, { status: 400 });
    }
    const { patch, tokenUpdated } = built;

    // Cek duplikasi nama perangkat (kecuali dirinya sendiri)
    if (patch.deviceName !== undefined && patch.deviceName !== existing.deviceName) {
      const nameExists = await prisma.fonnteConfig.findFirst({
        where: { deviceName: patch.deviceName },
      });
      if (nameExists) {
        return NextResponse.json({ error: 'Nama perangkat sudah digunakan' }, { status: 400 });
      }
    }

    // Cek duplikasi nomor admin (kecuali dirinya sendiri) — dibandingkan dalam
    // bentuk ternormalisasi agar angka dengan format berbeda terdeteksi.
    if (
      patch.adminPhone !== undefined &&
      patch.adminPhone !== sanitizePhoneInput(existing.adminPhone)
    ) {
      const phoneExists = await prisma.fonnteConfig.findFirst({
        where: { adminPhone: patch.adminPhone },
      });
      if (phoneExists) {
        return NextResponse.json({ error: 'Nomor admin sudah terdaftar' }, { status: 400 });
      }
    }

    // Jika mengaktifkan perangkat ini, gunakan setActiveFonnteConfig untuk transaksi aman
    if (isActive === true && !existing.isActive) {
      const activated = await setActiveFonnteConfig(id);
      if (!activated) {
        return NextResponse.json(
          { error: 'Gagal mengaktifkan perangkat. Tidak ada perubahan yang disimpan.' },
          { status: 500 }
        );
      }
      return NextResponse.json({
        success: true,
        message: 'Perangkat diaktifkan dan menjadi pengirim seluruh notifikasi.',
        device: {
          id: activated.id,
          deviceName: activated.deviceName || 'Tanpa Nama',
          adminPhone: activated.adminPhone,
          isActive: activated.isActive,
          lastValidation: activated.lastValidation,
        },
      });
    }

    // Simpan perubahan. Token yang TIDAK diisi tidak tersentuh.
    const updated = await updateFonnteConfig(id, patch);
    if (!updated) {
      return NextResponse.json({ error: 'Konfigurasi tidak ditemukan' }, { status: 404 });
    }

    // Kembalikan response TANPA token, plus penanda apakah token diganti.
    return NextResponse.json({
      success: true,
      message: tokenUpdated
        ? 'Konfigurasi berhasil diperbarui (token Fonnte diganti).'
        : 'Konfigurasi berhasil diperbarui (token lama dipertahankan).',
      tokenUpdated,
      device: {
        id: updated.id,
        deviceName: updated.deviceName,
        adminPhone: updated.adminPhone,
        isActive: updated.isActive,
        hasToken: Boolean(sanitizeTokenInput(updated.token)),
        lastValidation: updated.lastValidation,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error('[PATCH /api/admin/whatsapp-config/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// DELETE /api/admin/whatsapp-config/[id] — hapus konfigurasi (ADMIN only)
// Tidak boleh menghapus perangkat aktif
export async function DELETE(
  request: Request,
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

    const { id } = params;

    // Cek apakah konfigurasi exists
    const existing = await prisma.fonnteConfig.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Konfigurasi tidak ditemukan' }, { status: 404 });
    }

    // Jangan boleh menghapus perangkat aktif
    if (existing.isActive) {
      return NextResponse.json(
        {
          error: 'Tidak dapat menghapus perangkat aktif. Aktifkan perangkat lain terlebih dahulu.',
        },
        { status: 400 }
      );
    }

    // Cek apakah masih ada setidaknya satu perangkat lain
    const allConfigs = await prisma.fonnteConfig.findMany();
    if (allConfigs.length <= 1) {
      return NextResponse.json(
        {
          error: 'Tidak dapat menghapus perangkat terakhir. Tambahkan perangkat baru terlebih dahulu.',
        },
        { status: 400 }
      );
    }

    await prisma.fonnteConfig.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: 'Konfigurasi berhasil dihapus',
    });
  } catch (error) {
    console.error('[DELETE /api/admin/whatsapp-config/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
