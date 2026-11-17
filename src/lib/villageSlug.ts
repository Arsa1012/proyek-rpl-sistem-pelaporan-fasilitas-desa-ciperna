import { prisma } from './prisma';
import { slugify } from './villageInput';

/**
 * Slug pengumuman unik. Dipakai saat membuat/mengubah judul tanpa mengubah
 * URL lama secara tidak sengaja (slug hanya berubah bila diminta eksplisit).
 */
export async function uniqueAnnouncementSlug(base: string, excludeId?: string): Promise<string> {
  const clean = slugify(base);
  let candidate = clean;
  for (let i = 2; i <= 50; i++) {
    const found = await prisma.villageAnnouncement.findUnique({ where: { slug: candidate } });
    if (!found || found.id === excludeId) return candidate;
    candidate = `${clean}-${i}`;
  }
  return `${clean}-${Date.now()}`;
}
