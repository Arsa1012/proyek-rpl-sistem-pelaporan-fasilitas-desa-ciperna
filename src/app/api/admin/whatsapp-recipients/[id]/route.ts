import { NextResponse } from 'next/server';
import { requireAdmin, badRequest, notFound, readJson } from '@/lib/adminApi';
import { logAdminAction } from '@/lib/auditLog';
import {
  updateRecipient,
  activateRecipient,
  deactivateRecipient,
  resolveActiveRecipient,
  listRecipients,
} from '@/lib/notificationRecipients';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * PATCH /api/admin/whatsapp-recipients/[id] — ubah label/nomor/catatan atau
 * aktif/nonaktifkan.
 *
 * Body: `{ label?, phone?, notes?, isActive? }`
 *
 * `isActive: true` → TRANSAKSI ATOMIK: nomor lain dinonaktifkan, nomor ini
 * diaktifkan (dijamin juga oleh partial UNIQUE INDEX di database).
 *
 * `isActive: false` → nomor dinonaktifkan (TIDAK dihapus, dapat diaktifkan
 * kembali).
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = params;
    const body = await readJson(request);

    // Aktivasi / nonaktivasi (bukan edit atribut biasa).
    if (body.isActive === true || body.isActive === false) {
      const updated =
        body.isActive === true
          ? await activateRecipient(id)
          : await deactivateRecipient(id);
      if (!updated) return notFound('Penerima tidak ditemukan');

      await logAdminAction({
        adminId: auth.session.userId,
        action: body.isActive === true ? 'WA_RECIPIENT_ACTIVATE' : 'WA_RECIPIENT_DEACTIVATE',
        notes: `Penerima "${updated.label}" nomor=${updated.phone} ${body.isActive ? 'diaktifkan' : 'dinonaktifkan'}.`,
      });

      const active = await resolveActiveRecipient();
      return NextResponse.json({
        success: true,
        message:
          body.isActive === true
            ? 'Penerima aktif. Perubahan berlaku pada pengiriman berikutnya.'
            : 'Penerima dinonaktifkan. Nomor tetap tersimpan dan dapat diaktifkan kembali.',
        recipient: {
          id: updated.id,
          label: updated.label,
          phone: updated.phone,
          isActive: updated.isActive,
          notes: updated.notes,
        },
        active: active.phone ? { phone: active.phone, label: active.label } : null,
        source: active.source,
        problems: active.problems,
      });
    }

    const result = await updateRecipient(id, {
      label: typeof body.label === 'string' ? body.label : undefined,
      phone: typeof body.phone === 'string' ? body.phone : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });
    if (!result.ok) {
      if (result.error === 'Penerima tidak ditemukan') return notFound(result.error);
      return badRequest(result.error);
    }

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'WA_RECIPIENT_UPDATE',
      notes: `Penerima diperbarui: label="${result.recipient.label}" nomor=${result.recipient.phone}.`,
    });

    return NextResponse.json({
      success: true,
      message: 'Penerima notifikasi berhasil diperbarui.',
      recipient: {
        id: result.recipient.id,
        label: result.recipient.label,
        phone: result.recipient.phone,
        isActive: result.recipient.isActive,
        notes: result.recipient.notes,
        createdAt: result.recipient.createdAt,
        updatedAt: result.recipient.updatedAt,
      },
    });
  } catch (error) {
    console.error('[PATCH /api/admin/whatsapp-recipients/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/whatsapp-recipients/[id] — soft-delete.
 *
 * TIDAK ADA hard delete (A8): nomor dinonaktifkan + alasan dicatat di
 * `notes`. Nomor lama tetap dapat diaktifkan kembali.
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = params;
    const body = await readJson(request);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    const existing = await listOne(id);
    if (!existing) return notFound('Penerima tidak ditemukan');

    const notes = [
      existing.notes,
      `Dinonaktifkan (soft-delete)${reason ? `: ${reason}` : ''} pada ${new Date().toISOString()}.`,
    ]
      .filter(Boolean)
      .join(' ');

    const updated = await deactivateRecipient(id);
    if (!updated) return notFound('Penerima tidak ditemukan');

    // Simpan alasan pada catatan.
    await updateRecipient(id, { notes });

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'WA_RECIPIENT_DISABLE',
      notes: `Penerima "${updated.label}" nomor=${updated.phone} dinonaktifkan (soft-delete)${reason ? ` alasan="${reason}"` : ''}.`,
    });

    const active = await resolveActiveRecipient();
    return NextResponse.json({
      success: true,
      message:
        'Penerima dinonaktifkan. Data tidak dihapus permanen dan dapat diaktifkan kembali.',
      recipient: {
        id: updated.id,
        label: updated.label,
        phone: updated.phone,
        isActive: false,
        notes,
      },
      active: active.phone ? { phone: active.phone, label: active.label } : null,
      problems: active.problems,
    });
  } catch (error) {
    console.error('[DELETE /api/admin/whatsapp-recipients/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

/** Helper lokal: ambil satu penerima bila ada. */
async function listOne(id: string) {
  const rows = await listRecipients();
  return rows.find((r) => r.id === id) || null;
}
