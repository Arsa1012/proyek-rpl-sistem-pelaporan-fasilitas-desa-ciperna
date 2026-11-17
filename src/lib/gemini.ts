import { GoogleGenerativeAI } from '@google/generative-ai';
// KONFIGURASI PROVIDER AI terpusat (tabel AiProvider, dikelola Admin).
import { resolveAiProviderChain } from './aiProviderConfig';

export interface AIAnalysisResult {
  category: string;
  damageType: string;
  severity: 'RENDAH' | 'SEDANG' | 'TINGGI' | 'KRITIS';
  confidence: number; // 0-100
  summary: string;
  recommendation: string;
  aiResult: string; // label singkat untuk display
}

/**
 * Ambil kunci + model Gemini dari KONFIGURASI AI terpusat.
 *
 * Urutan sumber:
 *  1. Provider `gemini` yang AKTIF di tabel `AiProvider` (kunci terenkripsi).
 *  2. Provider `gemini` lain yang punya kunci + model (cadangan).
 *  3. Bootstrap `.env` (`GEMINI_API_KEY` + `GEMINI_MODEL`) HANYA bila tabel
 *     `AiProvider` masih KOSONG (instalasi baru).
 *
 * Penting: bila tabel provider sudah berisi konfigurasi (Admin sudah
 * memilih provider sendiri), `.env` **tidak** dipakai — tidak ada fallback
 * diam-diam yang mengabaikan pilihan Admin (§9.1 aturan 2 spesifikasi Tahap 2).
 *
 * Model TIDAK lagi hardcode: Admin yang memilihnya di /admin/ai-config.
 */
async function resolveGeminiConfig(): Promise<{ apiKey: string; modelName: string }> {
  const chain = await resolveAiProviderChain();
  const gemini = chain.attempts.find((a) => a.provider === 'gemini');
  if (gemini?.apiKey && gemini.primaryModel) {
    return { apiKey: gemini.apiKey, modelName: gemini.primaryModel };
  }
  // Bootstrap `.env` HANYA bila tabel provider belum pernah diisi.
  if (chain.source === 'env') {
    const envKey = process.env.GEMINI_API_KEY;
    const envModel = process.env.GEMINI_MODEL;
    if (envKey && envKey.trim()) {
      return { apiKey: envKey.trim(), modelName: (envModel || 'gemini-1.5-flash').trim() };
    }
  }
  throw new Error(
    'Provider Gemini belum dikonfigurasi (kunci/model belum diisi di /admin/ai-config).'
  );
}

const CATEGORIES: Record<string, string> = {
  'Jalan': 'Infrastruktur Jalan',
  'Jembatan': 'Infrastruktur Jembatan',
  'Lampu': 'Penerangan Jalan',
  'Drainase': 'Sistem Drainase',
  'Taman': 'Ruang Terbuka Hijau',
  'Fasilitas Umum': 'Fasilitas Umum',
  'Gedung': 'Gedung/Bangunan Publik',
  'Transportasi': 'Sarana Transportasi',
  'Sanitasi': 'Sanitasi & Kebersihan',
  'Lainnya': 'Fasilitas Lainnya',
};

const AI_PROMPT = `Kamu adalah sistem analisis kerusakan fasilitas umum yang canggih. Analisis gambar dan deskripsi laporan kerusakan fasilitas umum berikut.

Berikan output dalam format JSON yang valid dengan struktur berikut:
{
  "category": "kategori fasilitas (pilih dari: Jalan, Jembatan, Lampu, Drainase, Taman, Fasilitas Umum, Gedung, Transportasi, Sanitasi, Lainnya)",
  "damageType": "jenis kerusakan spesifik dalam 3-5 kata",
  "severity": "tingkat keparahan (pilih tepat satu dari: RENDAH, SEDANG, TINGGI, KRITIS)",
  "confidence": angka persentase kepercayaan analisis antara 60-99 (integer),
  "summary": "ringkasan analisis kerusakan dalam 2-3 kalimat bahasa Indonesia",
  "recommendation": "rekomendasi tindakan perbaikan dalam 1-2 kalimat bahasa Indonesia",
  "aiResult": "label singkat kategori + jenis (contoh: Jalan - Lubang Besar)"
}

Panduan severity:
- RENDAH: Kerusakan minor, tidak mengganggu fungsi utama
- SEDANG: Kerusakan cukup signifikan, perlu segera diperbaiki
- TINGGI: Kerusakan serius, berpotensi membahayakan
- KRITIS: Kerusakan sangat parah, membahayakan keselamatan jiwa

Hanya kembalikan JSON saja, tanpa teks lain di luar JSON.`;

export async function analyzeReport(
  imageBase64: string,
  mimeType: string,
  description: string,
  title: string
): Promise<AIAnalysisResult> {
  const { apiKey, modelName } = await resolveGeminiConfig();

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `${AI_PROMPT}

Judul Laporan: ${title}
Deskripsi: ${description}`;

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
          data: imageBase64,
        },
      },
    ]);

    const text = result.response.text().trim();
    
    // Parse JSON, handle case where it might be wrapped in markdown code blocks
    let jsonText = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText) as AIAnalysisResult;

    // Validate and normalize
    parsed.confidence = Math.min(99, Math.max(0, Number(parsed.confidence)));
    if (!['RENDAH', 'SEDANG', 'TINGGI', 'KRITIS'].includes(parsed.severity)) {
      parsed.severity = 'SEDANG';
    }

    // Sanitize string fields to prevent XSS
    parsed.category = String(parsed.category || '').slice(0, 200);
    parsed.damageType = String(parsed.damageType || '').slice(0, 200);
    parsed.summary = String(parsed.summary || '').slice(0, 2000);
    parsed.recommendation = String(parsed.recommendation || '').slice(0, 2000);
    parsed.aiResult = String(parsed.aiResult || '').slice(0, 200);

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('AI mengembalikan format yang tidak valid. Coba lagi.');
    }
    throw error;
  }
}

export async function analyzeReportTextOnly(
  description: string,
  title: string,
  location: string
): Promise<AIAnalysisResult> {
  const { apiKey, modelName } = await resolveGeminiConfig();

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `${AI_PROMPT}

Judul Laporan: ${title}
Lokasi: ${location}
Deskripsi: ${description}

Catatan: Tidak ada gambar tersedia, analisis berdasarkan teks saja.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  
  let jsonText = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonText) as AIAnalysisResult;
  parsed.confidence = Math.min(99, Math.max(0, Number(parsed.confidence)));
  if (!['RENDAH', 'SEDANG', 'TINGGI', 'KRITIS'].includes(parsed.severity)) {
    parsed.severity = 'SEDANG';
  }

  // Sanitize string fields to prevent XSS
  parsed.category = String(parsed.category || '').slice(0, 200);
  parsed.damageType = String(parsed.damageType || '').slice(0, 200);
  parsed.summary = String(parsed.summary || '').slice(0, 2000);
  parsed.recommendation = String(parsed.recommendation || '').slice(0, 2000);
  parsed.aiResult = String(parsed.aiResult || '').slice(0, 200);

  return parsed;
}
