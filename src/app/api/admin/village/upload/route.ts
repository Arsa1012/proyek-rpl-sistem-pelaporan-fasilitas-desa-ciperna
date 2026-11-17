import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { requireAdmin } from '@/lib/adminApi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const KINDS = new Set(['hero', 'official', 'announcement']);

// POST /api/admin/village/upload — unggah foto profil desa / perangkat desa.
// Nama file dibuat server-side (tidak memakai nama asli pengguna).
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const form = await request.formData();
    const file = form.get('file');
    const kindRaw = String(form.get('kind') || 'official');
    const kind = KINDS.has(kindRaw) ? kindRaw : 'official';

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File foto wajib diunggah' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'File foto kosong' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Ukuran foto maksimal 2 MB' }, { status: 400 });
    }
    const ext = ALLOWED[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: 'Format foto harus JPG, PNG, atau WEBP' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Penanda file gambar (mencegah file non-gambar yang menyamar via MIME).
    const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng =
      buffer.length > 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isWebp =
      buffer.length > 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) {
      return NextResponse.json({ error: 'Isi file bukan gambar yang valid' }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });
    const filename = `village_${kind}_${crypto.randomUUID()}.${ext}`;
    await writeFile(path.join(uploadDir, filename), buffer);

    return NextResponse.json({
      success: true,
      path: `/uploads/${filename}`,
      message: 'Foto berhasil diunggah.',
    });
  } catch (error) {
    console.error('[POST /api/admin/village/upload]', error);
    return NextResponse.json({ error: 'Gagal mengunggah foto' }, { status: 500 });
  }
}
