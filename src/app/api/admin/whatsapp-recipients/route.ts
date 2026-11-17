import { NextResponse } from 'next/server';
import { requireAdmin, badRequest, readJson } from '@/lib/adminApi';
import { logAdminAction } from '@/lib/auditLog';
import {
  listRecipients,
  resolveActiveRecipient,
  addRecipient,
  migrateLegacyAdminPhone,
  listRecipientHistory,
} from '@/lib/notificationRecipients';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/whatsapp-recipients — daftar penerima notifikasi Admin.
 *
 * Semua endpoint di file ini WAJIB `requireAdmin()`: menyembunyikan menu di
 * frontend BUKAN proteksi.
 *
 * Nomor PENERIMA bukan rahasia (Admin butuh mengoreksinya), jadi dikirim
 * penuh. Yang TIDAK pernah dikirim: token/kredensial apa pun.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const recipients = await listRecipients();
    const active = await resolveActiveRecipient();

    // Riwayat perubahan (opsional): `?history=1`
    const url = new URL(request.url);
    const includeHistory = url.searchParams.get('history') === '1';
    const history = includeHistory ? await listRecipientHistory(25) : undefined;

    return NextResponse.json({
      recipients: recipients.map((r) => ({
        id: r.id,
        label: r.label,
        phone: r.phone,
        isActive: r.isActive,
        notes: r.notes,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      active: active.phone
        ? { id: recipients.find((r) => r.isActive)?.id ?? null, phone: active.phone, label: active.label }
        : null,
      source: active.source,
      problems: active.problems,
      totalRecipients: active.totalRecipients,
      ...(history ? { history } : {}),
    });
  } catch (error) {
    console.error('[GET /api/admin/whatsapp-recipients]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

/**
 * POST /api/admin/whatsapp-recipients — tambah penerima baru.
 *
 * Body: `{ label, phone, isActive?, notes? }`
 *  - `phone` divalidasi & dinormalisasi (08xx/62xx → 62xx).
 *  - Nomor duplikat → 400.
 *  - `isActive: true` → aktifkan lewat transaksi (nomor lain dinonaktifkan).
 *
 * Body tambahan `{ action: 'migrate-legacy' }` menjalankan migrasi idempoten
 * dari `FonnteConfig.adminPhone` menjadi penerima aktif pertama.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = await readJson(request);

    // --- Aksi khusus: migrasi idempoten nomor admin lama -------------------
    if (body.action === 'migrate-legacy') {
      const result = await migrateLegacyAdminPhone();
      if (!result.ok) {
        return badRequest(result.error);
      }
      await logAdminAction({
        adminId: auth.session.userId,
        action: 'WA_RECIPIENT_MIGRATE_LEGACY',
        notes: result.created
          ? `Nomor lama perangkat Fonnte dimigrasikan menjadi penerima notifikasi aktif (${result.phone}).`
          : `Migrasi nomor lama idempoten: penerima sudah ada (${result.phone}); tidak ada duplikasi.`,
      });
      const recipients = await listRecipients();
      const active = await resolveActiveRecipient();
      return NextResponse.json({
        success: true,
        created: result.created,
        message: result.created
          ? 'Nomor admin lama berhasil dimigrasikan menjadi penerima notifikasi aktif.'
          : 'Nomor tersebut sudah terdaftar. Tidak ada duplikasi dibuat.',
        recipients: recipients.map((r) => ({
          id: r.id,
          label: r.label,
          phone: r.phone,
          isActive: r.isActive,
          notes: r.notes,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        active: active.phone
          ? { phone: active.phone, label: active.label }
          : null,
        source: active.source,
        problems: active.problems,
      });
    }

    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    if (!label) return badRequest('Label wajib diisi');
    if (!phone) return badRequest('Nomor penerima wajib diisi');

    const result = await addRecipient({
      label,
      phone,
      notes,
      isActive: body.isActive === true,
    });
    if (!result.ok) return badRequest(result.error);

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'WA_RECIPIENT_ADD',
      notes: `Penerima notifikasi ditambahkan: label="${label}" nomor=${result.recipient.phone} aktif=${result.recipient.isActive}.`,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Penerima notifikasi berhasil ditambahkan.',
        recipient: {
          id: result.recipient.id,
          label: result.recipient.label,
          phone: result.recipient.phone,
          isActive: result.recipient.isActive,
          notes: result.recipient.notes,
          createdAt: result.recipient.createdAt,
          updatedAt: result.recipient.updatedAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/admin/whatsapp-recipients]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
