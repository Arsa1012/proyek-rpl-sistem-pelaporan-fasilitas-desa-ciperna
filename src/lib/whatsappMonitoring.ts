/**
 * MONITORING KONEKSI WHATSAPP FONNTE (READ-ONLY, server-only).
 *
 * Modul ini sengaja TIDAK mengimpor `lib/whatsapp.ts` karena modul tersebut
 * memakai `fs/promises` (untuk lampiran media) sehingga tidak boleh ikut
 * ter-bundle ke komponen client. Di sini hanya dibutuhkan Prisma + service
 * konfigurasi perangkat + normalisasi nomor sederhana.
 *
 * SUMBER KONFIGURASI: modul ini memakai `resolveActiveFonnteConfig()` — SATU
 * service yang sama dengan jalur pengiriman. Jadi nomor Admin, nama perangkat,
 * dan kelengkapan konfigurasi di monitoring/AI Assistant SELALU mengikuti
 * perangkat yang sedang dipilih Admin.
 *
 * PENTING (jujur): Fonnte tidak menyediakan ping koneksi per-perangkat pada
 * API kirim. Status koneksi DISIMPULKAN dari konfigurasi aktif dan catatan
 * pengiriman 24 jam terakhir (WhatsAppLog + AnnouncementDelivery). Ini bukan
 * bukti device sedang online saat ini; SENT hanya berarti provider menerima
 * pesan, bukan bahwa penerima membaca pesan.
 *
 * Keamanan: tidak pernah mengembalikan token. Nomor admin dikembalikan dalam
 * format ternormalisasi untuk ditampilkan ke Admin yang berhak.
 */

import { prisma } from '@/lib/prisma';
import { resolveActiveFonnteConfig } from '@/lib/fonnteConfig';
import { resolveActiveRecipient } from '@/lib/notificationRecipients';
import { isMockDelivery } from '@/lib/whatsappDelivery';

export type WhatsAppConnectionStatus = 'connected' | 'disconnected' | 'unknown';

export interface WhatsAppDeliverySummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  pending: number;
  lastSentAt: Date | null;
  lastFailedAt: Date | null;
  lastError: string | null;
  /** Waktu keberhasilan NYATA terakhir (bukan hasil uji/mok). */
  lastRealSuccessAt: Date | null;
  /** Waktu keberhasilan UJI/mock terakhir (tidak dihitung sebagai bukti). */
  lastTestSuccessAt: Date | null;
  /** true bila ada minimal satu pengiriman nyata (provider sungguhan). */
  hasRealSuccessfulDelivery: boolean;
  /** true bila ada pengiriman mock (uji) — bukan bukti koneksi. */
  hasMockDeliveryOnly: boolean;
}

export interface WhatsAppMonitoringStatus {
  /** Nama perangkat pengirim yang sedang aktif. */
  deviceName: string | null;
  /** Nomor Admin PENERIMA notifikasi — mengikuti perangkat aktif. */
  adminPhone: string | null;
  /**
   * Nomor PENERIMA notifikasi yang AKTIF (tabel NotificationRecipient).
   * Terpisah dari nomor perangkat pengirim. null = belum ada penerima aktif
   * sehingga notifikasi Admin akan DIHENTIKAN.
   */
  activeRecipientPhone: string | null;
  /** Label penerima notifikasi aktif. */
  activeRecipientLabel: string | null;
  /** true bila ada nomor penerima notifikasi yang aktif. */
  hasActiveRecipient: boolean;
  isActive: boolean;
  isConfigured: boolean;
  connectionStatus: WhatsAppConnectionStatus;
  /**
   * Dasar status koneksi: 'inference' = disimpulkan dari catatan pengiriman
   * 24 jam terakhir (BUKAN pemeriksaan langsung ke Fonnte),
   * 'not_configured' = konfigurasi belum lengkap.
   */
  connectionStatusBasis: 'inference' | 'not_configured';
  /** Sumber konfigurasi: 'database' (perangkat aktif), 'env', 'none', 'error'. */
  configSource: string;
  /** Masalah konfigurasi dalam bahasa manusia (aman untuk ditampilkan). */
  problems: string[];
  /** Apakah perangkat punya bukti pengiriman BERHASIL sebelumnya. */
  hasSuccessfulDelivery: boolean;
  lastValidation: Date | null;
  lastCheckedAt: Date;
  deliverySummary: WhatsAppDeliverySummary;
  note: string;
}

export async function getWhatsAppMonitoringStatus(): Promise<WhatsAppMonitoringStatus> {
  const config = await resolveActiveFonnteConfig();

  // Nomor PENERIMA notifikasi (terpisah dari perangkat pengirim). Bila
  // tidak ada, notifikasi Admin dihentikan — bukan dialihkan ke nomor lain.
  let activeRecipientPhone: string | null = null;
  let activeRecipientLabel: string | null = null;
  let recipientProblems: string[] = [];
  try {
    const recipient = await resolveActiveRecipient();
    activeRecipientPhone = recipient.phone;
    activeRecipientLabel = recipient.label;
    recipientProblems = recipient.problems;
  } catch (error) {
    console.error('[WhatsApp] Gagal membaca penerima notifikasi:', error);
  }

  const isConfigured = Boolean(config.tokenValid && config.adminPhoneValid);
  const lastCheckedAt = new Date();
  const since = new Date(lastCheckedAt.getTime() - 24 * 60 * 60 * 1000);

  let deliverySummary: WhatsAppDeliverySummary = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    lastSentAt: null,
    lastFailedAt: null,
    lastError: null,
    lastRealSuccessAt: null,
    lastTestSuccessAt: null,
    hasRealSuccessfulDelivery: false,
    hasMockDeliveryOnly: false,
  };
  let connectionStatus: WhatsAppConnectionStatus = isConfigured ? 'unknown' : 'disconnected';
  let hasSuccessfulDelivery = false;

  try {
    const [
      logByStatus,
      delivByStatus,
      lastSent,
      lastFailed,
      recentFailed,
      recentSent,
      everSent,
      sentRows,
    ] = await Promise.all([
      prisma.whatsAppLog.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.announcementDelivery.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.whatsAppLog.findFirst({
        where: { status: 'SENT' },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      prisma.whatsAppLog.findFirst({
        where: { status: 'FAILED' },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true, error: true },
      }),
      prisma.whatsAppLog.count({ where: { status: 'FAILED', updatedAt: { gte: since } } }),
      prisma.whatsAppLog.count({ where: { status: 'SENT', updatedAt: { gte: since } } }),
      prisma.whatsAppLog.count({ where: { status: 'SENT' } }),
      // Baris SENT terbaru (dibatasi) untuk memisahkan bukti NYATA dari mock.
      prisma.whatsAppLog.findMany({
        where: { status: 'SENT' },
        orderBy: { updatedAt: 'desc' },
        take: 200,
        select: { updatedAt: true, providerMessageId: true, dedupeKey: true },
      }),
    ]);

    const pick = (rows: { status?: string; _count: { id: number } }[]) => {
      const map: Record<string, number> = {};
      for (const r of rows) map[String(r.status)] = r._count.id;
      return map;
    };
    const logMap = pick(logByStatus);
    const delivMap = pick(delivByStatus);
    const sum = (map: Record<string, number>) => Object.values(map).reduce((a, b) => a + b, 0);

    // Pisahkan baris mock (uji) dari bukti pengiriman nyata.
    const realSent = sentRows.filter((r) => !isMockDelivery(r));
    const mockSent = sentRows.filter((r) => isMockDelivery(r));
    const lastRealSuccessAt = realSent[0]?.updatedAt ?? null;
    const lastTestSuccessAt = mockSent[0]?.updatedAt ?? null;
    const hasRealSuccessfulDelivery = realSent.length > 0;
    const recentRealSent = realSent.filter((r) => r.updatedAt >= since).length;
    const recentMockSent = mockSent.filter((r) => r.updatedAt >= since).length;

    deliverySummary = {
      total: sum(logMap) + sum(delivMap),
      success: (logMap.SENT || 0) + (delivMap.SENT || 0),
      failed: (logMap.FAILED || 0) + (delivMap.FAILED || 0),
      skipped: (logMap.SKIPPED || 0) + (delivMap.SKIPPED || 0),
      pending: (logMap.PENDING || 0) + (delivMap.PENDING || 0),
      lastSentAt: lastSent?.updatedAt ?? null,
      lastFailedAt: lastFailed?.updatedAt ?? null,
      lastError: lastFailed?.error ?? null,
      lastRealSuccessAt,
      lastTestSuccessAt,
      hasRealSuccessfulDelivery,
      hasMockDeliveryOnly: !hasRealSuccessfulDelivery && mockSent.length > 0,
    };
    hasSuccessfulDelivery = everSent > 0;

    if (!isConfigured) {
      connectionStatus = 'disconnected';
    } else if (recentFailed > 0 && recentRealSent === 0) {
      connectionStatus = 'disconnected';
    } else if (recentRealSent > 0) {
      // Hanya pengiriman NYATA yang membuktikan perangkat benar-benar terkirim.
      connectionStatus = 'connected';
    } else if (recentMockSent > 0) {
      // Hanya ada mock/uji dalam 24 jam → TIDAK boleh disebut "Terhubung".
      connectionStatus = 'unknown';
    } else if (config.source === 'database' && config.lastValidation) {
      const ageMs = lastCheckedAt.getTime() - new Date(config.lastValidation).getTime();
      connectionStatus = ageMs <= 7 * 24 * 60 * 60 * 1000 ? 'unknown' : 'unknown';
    } else {
      connectionStatus = 'unknown';
    }
  } catch (error) {
    console.error('[WhatsApp] Gagal memuat status monitoring:', error);
  }

  return {
    deviceName: config.deviceName,
    adminPhone: config.adminPhone,
    activeRecipientPhone,
    activeRecipientLabel,
    hasActiveRecipient: Boolean(activeRecipientPhone),
    isActive: config.source === 'database',
    isConfigured,
    connectionStatus,
    connectionStatusBasis: isConfigured ? 'inference' : 'not_configured',
    configSource: config.source,
    problems: [...config.problems, ...recipientProblems],
    hasSuccessfulDelivery,
    lastValidation: config.lastValidation ?? null,
    lastCheckedAt,
    deliverySummary,
    note:
      'Status koneksi DISIMPULKAN dari konfigurasi aktif dan catatan pengiriman nyata 24 jam terakhir — bukan hasil pemeriksaan langsung ke Fonnte (Fonnte tidak menyediakan ping perangkat). ' +
      'Pengiriman hasil UJI (mock) sengaja TIDAK dihitung sebagai bukti koneksi. ' +
      'SENT berarti provider menerima pesan, bukan bukti dibaca penerima.',
  };
}
