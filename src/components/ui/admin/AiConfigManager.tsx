'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import './admin-config.css';

/* ==========================================================================
   Tipe
   ========================================================================== */

type FreeStatus = 'VERIFIED_FREE' | 'ACCOUNT_DEPENDENT' | 'UNVERIFIED' | 'PAID';

interface ModelStatusInfo {
  modelId: string;
  freeStatus: FreeStatus;
}

interface ProviderSlot {
  id: string | null;
  provider: string;
  label: string;
  specLabel: string;
  endpoint: string;
  style: string;
  supportsImages: boolean;
  verified: boolean;
  note: string;
  isActive: boolean;
  hasApiKey: boolean;
  primaryModel: string | null;
  fallbackModels: string[];
  lastValidation: string | null;
  lastError: string | null;
  /** Diagnostik aman: kategori error, HTTP status, model & provider. */
  lastErrorDetail: string | null;
  /** Penjelasan kegagalan yang mudah dipahami. */
  lastErrorExplanation: string | null;
  configured: boolean;
  status: string;
  statusLabel: string;
  primaryModelStatus: FreeStatus;
  primaryModelAllowed: boolean;
  validFallbackCount: number;
  fallbackModelsStatus: ModelStatusInfo[];
  blockedFallbackModels: { modelId: string; status: FreeStatus }[];
}

interface RuntimeInfo {
  providerChain: string[];
  usableModels: { provider: string; model: string }[];
  blockedModels: { provider: string; modelId: string; status: FreeStatus }[];
  problems: string[];
  source: string;
}

interface Recommendation {
  provider: string;
  providerLabel: string;
  modelId: string;
  freeStatus: FreeStatus;
  freeStatusLabel: string;
  evidenceUrl: string | null;
  verifiedAt: string | null;
  notes: string | null;
  supportsImages: boolean;
  supportsMultiTurn: 'ya' | 'emulasi';
  supportsIndonesian: 'ya' | 'tidak_dijamin';
  reason: string;
}

interface RecommendationPayload {
  generatedAt: string;
  primary: Recommendation | null;
  fallbacks: Recommendation[];
  candidates: Recommendation[];
  warnings: string[];
  policyUpdatedAt: string | null;
  note: string;
}

interface CatalogModel {
  id: string;
  name: string;
  contextLength: number | null;
  /** Harga dari katalog resmi (null = katalog tidak mencantumkan harga). */
  pricingPrompt: string | null;
  pricingCompletion: string | null;
  /** true bila katalog mencantumkan harga sama sekali. */
  pricingKnown: boolean;
  /** true bila model mendukung chat / generateContent. */
  supportsChat: boolean;
  freeStatus: FreeStatus;
  freeStatusLabel: string;
  /** Alasan status (mengapa ditolak / apa buktinya). */
  freeReason: string;
  /** true bila model boleh dipilih (hanya VERIFIED_FREE). */
  selectable: boolean;
  evidenceUrl: string | null;
  verifiedAt: string | null;
  verificationSource: string | null;
}

interface CatalogSummary {
  total: number;
  verifiedFree: number;
  unverified: number;
  paid: number;
}

interface CatalogMeta {
  fetchedAt: string | null;
  summary: CatalogSummary | null;
  hint: { url: string; note: string } | null;
  error: string | null;
}

interface ApiPayload {
  slots?: ProviderSlot[];
  active?: {
    provider: string;
    label: string | null;
    model: string | null;
    primaryModelStatus?: FreeStatus;
    allowedFallbackModels?: string[];
  } | null;
  source?: string;
  problems?: string[];
  usedEnvFallback?: boolean;
  encryptionReady?: boolean;
  runtime?: RuntimeInfo;
  policyUpdatedAt?: string | null;
  error?: string;
  message?: string;
}

/* ==========================================================================
   Util
   ========================================================================== */

const FREE_LABEL: Record<FreeStatus, string> = {
  VERIFIED_FREE: 'Gratis terverifikasi',
  ACCOUNT_DEPENDENT: 'Bergantung akun',
  UNVERIFIED: 'Belum terverifikasi',
  PAID: 'Berbayar',
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return (
    d.toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' WIB'
  );
}

function ProviderIcon({ provider, size = 20 }: { provider: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (provider === 'gemini') {
    return (
      <svg {...common}>
        <path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15.4l-1.6-4.6L6 9.2l4.4-1.6L12 3Z" />
        <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
      </svg>
    );
  }
  if (provider === 'groq') {
    return (
      <svg {...common}>
        <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="6" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M8.4 10.9 15.6 7.2M8.4 13.1l7.2 3.7" />
    </svg>
  );
}

function FreeBadge({ status }: { status: FreeStatus }) {
  const cls =
    status === 'VERIFIED_FREE'
      ? 'cfg-badge cfg-badge-free'
      : status === 'ACCOUNT_DEPENDENT'
        ? 'cfg-badge cfg-badge-account-dependent'
        : status === 'PAID'
          ? 'cfg-badge cfg-badge-paid'
          : 'cfg-badge cfg-badge-unverified';
  return <span className={cls}>{FREE_LABEL[status] ?? status}</span>;
}

/* ==========================================================================
   Komponen
   ========================================================================== */

export default function AiConfigManager() {
  const [slots, setSlots] = useState<ProviderSlot[]>([]);
  const [active, setActive] = useState<ApiPayload['active']>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [usedEnvFallback, setUsedEnvFallback] = useState(false);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState('');

  const [selected, setSelected] = useState('openrouter');

  const [draft, setDraft] = useState<
    Record<string, { apiKey: string; primary: string; fallbacks: string[]; showKey: boolean }>
  >({});
  const [catalog, setCatalog] = useState<Record<string, CatalogModel[]>>({});
  const [catalogMeta, setCatalogMeta] = useState<Record<string, CatalogMeta>>({});
  const [catalogLoading, setCatalogLoading] = useState('');
  const [showAllCatalog, setShowAllCatalog] = useState<Record<string, boolean>>({});

  // Verifikasi manual (hanya untuk model yang statusnya UNVERIFIED).
  const [manual, setManual] = useState<{ provider: string; modelId: string } | null>(null);
  const [manualUrl, setManualUrl] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState('');

  const [recommendation, setRecommendation] = useState<RecommendationPayload | null>(null);
  const [showRecommend, setShowRecommend] = useState(false);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [recommendLoading, setRecommendLoading] = useState(false);

  const showSuccess = useCallback((msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 5000);
  }, []);
  const showError = useCallback((msg: string) => {
    setErrorMsg(msg);
    window.setTimeout(() => setErrorMsg(''), 7000);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/ai-config', { cache: 'no-store' });
      const data: ApiPayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data?.error || 'Gagal memuat konfigurasi AI.');
        return;
      }
      const nextSlots = Array.isArray(data.slots) ? data.slots : [];
      setSlots(nextSlots);
      setActive(data.active ?? null);
      setRuntime(data.runtime ?? null);
      setProblems(Array.isArray(data.problems) ? data.problems : []);
      setEncryptionReady(Boolean(data.encryptionReady));
      setUsedEnvFallback(Boolean(data.usedEnvFallback));
      setSource(data.source ?? '');
      setDraft((prev) => {
        const next = { ...prev };
        for (const s of nextSlots) {
          if (!next[s.provider]) {
            next[s.provider] = {
              apiKey: '',
              primary: s.primaryModel || '',
              fallbacks: [...(s.fallbackModels || [])],
              showKey: false,
            };
          }
        }
        return next;
      });
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    load();
  }, [load]);

  const current = useMemo(
    () => slots.find((s) => s.provider === selected) ?? null,
    [slots, selected]
  );
  const currentDraft = current ? draft[current.provider] : undefined;

  const updateDraft = (
    provider: string,
    patch: Partial<{ apiKey: string; primary: string; fallbacks: string[]; showKey: boolean }>
  ) => {
    setDraft((prev) => {
      const base =
        prev[provider] ?? { apiKey: '', primary: '', fallbacks: [], showKey: false };
      return { ...prev, [provider]: { ...base, ...patch } };
    });
  };

  /* ------------------------------------------------------------- katalog */

  /**
   * Muat katalog resmi provider.
   *
   * `force = true` melewati cache 6 jam di server (tombol "Perbarui katalog").
   */
  const loadCatalog = async (provider: string, force = false) => {
    if (catalog[provider]?.length && !force) return;
    setCatalogLoading(provider);
    try {
      const res = await fetch(
        `/api/admin/ai-config/catalog?provider=${encodeURIComponent(provider)}${
          force ? '&refresh=1' : ''
        }`,
        { cache: 'no-store' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data?.error || 'Gagal memuat katalog model.');
        return;
      }
      const models = Array.isArray(data?.models) ? data.models : [];
      setCatalog((prev) => ({ ...prev, [provider]: models }));
      setCatalogMeta((prev) => ({
        ...prev,
        [provider]: {
          fetchedAt: data?.fetchedAt ?? null,
          summary: data?.summary ?? null,
          hint: data?.hint ?? null,
          error: typeof data?.error === 'string' ? data.error : null,
        },
      }));
      if (models.length === 0) {
        showError(
          data?.error || 'Daftar model tidak dapat dimuat. Model tetap dapat diketik manual.'
        );
      }
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setCatalogLoading('');
    }
  };

  /* ---------------------------------------------------------- verifikasi */

  const verifyModels = async () => {
    setBusy('__verify__');
    try {
      const res = await fetch('/api/admin/ai-config/verify-models', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data?.error || 'Verifikasi model gratis gagal.');
        return;
      }
      const summary = (data?.results || [])
        .map((r: any) => `${r.provider}: ${r.verifiedFree} gratis`)
        .join(', ');
      const kept = data?.keptManual ?? 0;
      showSuccess(
        `Verifikasi selesai — ${summary || 'tidak ada model terverifikasi'}.` +
          (kept > 0 ? ` ${kept} verifikasi manual dipertahankan.` : '')
      );
      // Muat ulang katalog agar status tiap model langsung tercermin.
      const providers = Object.keys(catalog);
      for (const p of providers) {
        await loadCatalog(p, true);
      }
      load();
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setBusy('');
    }
  };

  /* ------------------------------------------------- verifikasi manual */

  /**
   * Buka formulir verifikasi manual untuk satu model.
   *
   * Hanya dipakai ketika status gratis model TIDAK dapat dibuktikan otomatis
   * (Gemini & Groq: katalog resmi tidak mencantumkan harga, dan tier gratis
   * mengikuti status akun). URL bukti WAJIB domain resmi provider — aturan
   * ini ditegakkan di server.
   */
  const openManual = (provider: string, modelId: string) => {
    const hint = catalogMeta[provider]?.hint ?? null;
    setManual({ provider, modelId });
    setManualUrl(hint?.url ?? '');
    setManualNotes(hint?.note ?? '');
    setManualError('');
  };

  const submitManual = async () => {
    if (!manual) return;
    setManualBusy(true);
    setManualError('');
    try {
      const res = await fetch('/api/admin/ai-config/verify-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manual: [
            {
              provider: manual.provider,
              modelId: manual.modelId,
              evidenceUrl: manualUrl.trim(),
              notes: manualNotes.trim(),
            },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      const first = data?.results?.[0];
      if (!res.ok || !first?.ok) {
        setManualError(first?.error || data?.error || 'Verifikasi manual gagal.');
        return;
      }
      showSuccess(
        `Model ${manual.modelId} ditandai gratis terverifikasi (verifikasi manual Admin).`
      );
      setManual(null);
      await loadCatalog(manual.provider, true);
      load();
    } catch {
      setManualError('Terjadi kesalahan jaringan.');
    } finally {
      setManualBusy(false);
    }
  };

  /* -------------------------------------------------------- rekomendasi */

  const openRecommend = async () => {
    setShowRecommend(true);
    setRecommendLoading(true);
    try {
      const res = await fetch('/api/admin/ai-config/recommend', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data?.error || 'Gagal memuat rekomendasi model gratis.');
        setRecommendation(null);
        return;
      }
      setRecommendation(data as RecommendationPayload);
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setRecommendLoading(false);
    }
  };

  const applyRecommendation = async () => {
    const rec = recommendation;
    if (!rec?.primary) {
      showError('Belum ada model gratis terverifikasi yang dapat diterapkan.');
      return;
    }
    setBusy('__apply__');
    try {
      // Terapkan per provider: model utama + cadangan yang berasal dari
      // provider tersebut. Kunci TIDAK dikirim dari klien (server memakai
      // kunci yang sudah tersimpan).
      const byProvider = new Map<string, { primary: string; fallbacks: string[] }>();
      const push = (provider: string, modelId: string, isPrimary: boolean) => {
        const cur = byProvider.get(provider) ?? { primary: '', fallbacks: [] };
        if (isPrimary && !cur.primary) cur.primary = modelId;
        else cur.fallbacks.push(modelId);
        byProvider.set(provider, cur);
      };
      push(rec.primary.provider, rec.primary.modelId, true);
      for (const f of rec.fallbacks) push(f.provider, f.modelId, false);

      let applied = 0;
      const errors: string[] = [];
      for (const [provider, plan] of byProvider.entries()) {
        const slot = slots.find((s) => s.provider === provider);
        if (!slot?.id) {
          errors.push(`${provider}: belum pernah disimpan (API Key belum ada)`);
          continue;
        }
        const res = await fetch(`/api/admin/ai-config/${slot.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primaryModel: plan.primary,
            fallbackModels: plan.fallbacks,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          errors.push(`${provider}: ${data?.error || 'gagal disimpan'}`);
          continue;
        }
        applied++;
      }

      if (applied > 0) {
        showSuccess(`Rekomendasi tersimpan pada ${applied} provider.`);
      }
      if (errors.length > 0) {
        showError(`Sebagian gagal: ${errors.join('; ')}`);
      }
      setShowApplyConfirm(false);
      setShowRecommend(false);
      load();
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setBusy('');
    }
  };

  /* -------------------------------------------------------------- simpan */

  const save = async (slot: ProviderSlot) => {
    const d = draft[slot.provider];
    if (!d) return;
    const fallbacks = d.fallbacks.map((f) => f.trim()).filter(Boolean);
    if (d.primary.trim() && fallbacks.includes(d.primary.trim())) {
      showError('Model utama tidak boleh sekaligus menjadi model cadangan.');
      return;
    }
    if (new Set(fallbacks).size !== fallbacks.length) {
      showError('Model cadangan tidak boleh sama.');
      return;
    }

    setBusy(slot.provider);
    try {
      const body: Record<string, unknown> = {
        label: slot.label,
        primaryModel: d.primary.trim(),
        fallbackModels: fallbacks,
      };
      // Kunci kosong = pertahankan kunci lama.
      if (d.apiKey.trim()) body.apiKey = d.apiKey.trim();

      const res = await fetch(
        slot.id ? `/api/admin/ai-config/${slot.id}` : '/api/admin/ai-config',
        {
          method: slot.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slot.id ? body : { ...body, provider: slot.provider }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data?.error || 'Gagal menyimpan konfigurasi provider.');
        return;
      }
      showSuccess(
        slot.id
          ? `Konfigurasi ${slot.specLabel} tersimpan.`
          : `${slot.specLabel} berhasil ditambahkan.`
      );
      updateDraft(slot.provider, { apiKey: '' });
      load();
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setBusy('');
    }
  };

  /* ----------------------------------------------------------- aktivasi */

  const activate = async (slot: ProviderSlot) => {
    if (!slot.id) {
      showError('Simpan konfigurasi provider terlebih dahulu sebelum mengaktifkannya.');
      return;
    }
    if (!slot.hasApiKey) {
      showError('API Key provider belum diisi. Isi API Key lalu simpan.');
      return;
    }
    if (!slot.primaryModel) {
      showError('Model utama belum dipilih. Isi model utama lalu simpan.');
      return;
    }
    if (!slot.primaryModelAllowed) {
      showError(
        `Model utama "${slot.primaryModel}" belum berstatus gratis terverifikasi. ` +
          'Verifikasi model gratis dari katalog resmi terlebih dahulu.'
      );
      return;
    }
    const ok = window.confirm('Aktifkan provider ini sebagai provider utama chatbot?');
    if (!ok) return;

    setBusy(slot.provider);
    try {
      const res = await fetch(`/api/admin/ai-config/${slot.id}/activate`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data?.error || 'Gagal mengaktifkan provider.');
        return;
      }
      showSuccess(
        `${slot.specLabel} menjadi provider utama chatbot. Perubahan berlaku pada permintaan berikutnya.`
      );
      load();
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setBusy('');
    }
  };

  const deactivate = async (slot: ProviderSlot) => {
    if (!slot.id) return;
    const ok = window.confirm(
      `Nonaktifkan "${slot.specLabel}"?\n\nAPI Key dan modelnya tetap tersimpan terenkripsi dan dapat diaktifkan kembali.`
    );
    if (!ok) return;

    setBusy(slot.provider);
    try {
      const res = await fetch(`/api/admin/ai-config/${slot.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data?.error || 'Gagal menonaktifkan provider.');
        return;
      }
      showSuccess(data?.message || 'Provider dinonaktifkan.');
      load();
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setBusy('');
    }
  };

  /* ------------------------------------------------------------ uji model */

  const testModel = async (slot: ProviderSlot, modelId: string) => {
    if (!slot.id) {
      showError('Simpan provider terlebih dahulu sebelum menguji model.');
      return;
    }
    setBusy(slot.provider);
    try {
      const res = await fetch(`/api/admin/ai-config/${slot.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data?.error || 'Tes model gagal.');
        return;
      }
      if (data.ok) {
        showSuccess(`Model ${modelId} merespons (${data.latencyMs ?? '-'} ms).`);
      } else {
        showError(`Model ${modelId} gagal: ${data.error || 'tidak diketahui'} (${data.errorKind || '-'}).`);
      }
      load();
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setBusy('');
    }
  };

  /* ------------------------------------------------------ urutan cadangan */

  const moveFallback = (provider: string, index: number, delta: number) => {
    const d = draft[provider];
    if (!d) return;
    const list = [...d.fallbacks];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    updateDraft(provider, { fallbacks: list });
  };

  /* ---------------------------------------------------------------- render */

  const activeSlot = slots.find((s) => s.isActive) ?? null;

  return (
    <div>
      {successMsg && (
        <div className="cfg-alert success" role="status">
          <span aria-hidden="true">✅</span>
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="cfg-alert error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="cfg-alert" style={{ marginBottom: '1rem' }}>
        <span aria-hidden="true">🔐</span>
        <div>
          <strong>Status enkripsi API Key:</strong>{' '}
          {encryptionReady
            ? 'APP_ENCRYPTION_KEY tersedia — API Key disimpan terenkripsi (AES-256-GCM) di server dan tidak pernah dikirim ke browser.'
            : 'APP_ENCRYPTION_KEY belum dikonfigurasi di server. API Key tidak dapat disimpan terenkripsi sehingga penambahan/penggantian kunci ditolak (tidak ada penyimpanan plaintext).'}
          {usedEnvFallback && (
            <>
              <br />
              Saat ini konfigurasi diambil dari <code>.env</code> karena tabel provider masih kosong.
            </>
          )}
        </div>
      </div>

      {/* ===================== PANEL STATUS AI AKTIF ===================== */}
      <div className="card cfg-status-panel">
        <div className="cfg-status-head">
          <h2 className="cfg-status-title">Status Asisten AI</h2>
          <span className={`cfg-badge ${activeSlot ? 'cfg-badge-free' : 'cfg-badge-paid'}`}>
            {activeSlot ? 'AI AKTIF' : 'AI TIDAK AKTIF'}
          </span>
        </div>

        <dl className="cfg-kv">
          <dt>Sumber konfigurasi</dt>
          <dd>
            {source === 'database' ? 'DATABASE' : source === 'env' ? '.ENV (bootstrap)' : source || '-'}
          </dd>
          <dt>Provider utama</dt>
          <dd>{activeSlot?.specLabel ?? active?.label ?? '(belum ada provider utama)'}</dd>
          <dt>Model utama</dt>
          <dd>
            {active?.model ?? '(belum dipilih)'}
            {active?.primaryModelStatus ? (
              <>
                {' '}
                <FreeBadge status={active.primaryModelStatus} />
              </>
            ) : null}
          </dd>
          <dt>Model cadangan</dt>
          <dd>
            {active?.allowedFallbackModels && active.allowedFallbackModels.length > 0
              ? active.allowedFallbackModels.map((m, i) => `${i + 1}. ${m}`).join('  ')
              : 'Belum ada model cadangan gratis terverifikasi.'}
          </dd>
          <dt>Model yang dipakai pipeline</dt>
          <dd>
            {runtime && runtime.usableModels.length > 0
              ? runtime.usableModels.map((m) => `${m.provider} — ${m.model}`).join('  |  ')
              : 'Tidak ada model gratis terverifikasi yang boleh dipakai.'}
          </dd>
          <dt>Urutan percobaan provider</dt>
          <dd>
            {runtime && runtime.providerChain.length > 0
              ? runtime.providerChain.join(' → ')
              : '(tidak ada)'}
          </dd>
        </dl>

        {runtime && runtime.blockedModels.length > 0 && (
          <div className="cfg-alert warning" style={{ marginTop: '0.85rem', marginBottom: 0 }}>
            <span aria-hidden="true">ℹ️</span>
            <div>
              <strong>Model yang DITOLAK (tidak dipakai otomatis):</strong>
              <ul>
                {runtime.blockedModels.map((b, i) => (
                  <li key={i}>
                    {b.provider} — {b.modelId} ({b.status})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {problems.length > 0 && (
          <div className="cfg-alert warning" style={{ marginTop: '0.85rem', marginBottom: 0 }}>
            <span aria-hidden="true">ℹ️</span>
            <div>
              <strong>Perlu perhatian:</strong>
              <ul>
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* ===================== DAFTAR PROVIDER (KARTU) ===================== */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="cfg-status-head">
          <h2 className="cfg-status-title">Provider AI</h2>
          <div className="cfg-item-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={openRecommend}
              disabled={recommendLoading}
            >
              {recommendLoading ? 'Memuat…' : 'Rekomendasikan Model Gratis'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={verifyModels}
              disabled={busy === '__verify__'}
            >
              {busy === '__verify__' ? 'Memverifikasi…' : 'Verifikasi Ulang dari Katalog Resmi'}
            </button>
          </div>
        </div>

        <p className="cfg-hint" style={{ marginBottom: '0.9rem' }}>
          Provider aktif adalah layanan AI utama chatbot. Provider lain yang sudah dikonfigurasi
          dapat digunakan sebagai cadangan otomatis jika model utama gagal. Hanya model gratis
          terverifikasi yang dapat digunakan.
        </p>

        {loading ? (
          <p className="cfg-item-sub">Memuat…</p>
        ) : (
          <div className="cfg-list">
            {slots.map((slot) => (
              <div
                key={slot.provider}
                className={`cfg-item${slot.isActive ? ' is-active' : ''}`}
              >
                <div className="cfg-item-head">
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                    <span className="cfg-ai-item-icon" aria-hidden="true">
                      <ProviderIcon provider={slot.provider} />
                    </span>
                    <div>
                      <p className="cfg-item-title">{slot.specLabel}</p>
                      <p className="cfg-item-sub">
                        API Key: {slot.hasApiKey ? 'Tersimpan' : 'Belum Tersimpan'}
                      </p>
                      <p className="cfg-item-sub">
                        Model utama: {slot.primaryModel ?? 'Belum dikonfigurasi'}{' '}
                        {slot.primaryModel ? <FreeBadge status={slot.primaryModelStatus} /> : null}
                      </p>
                      <p className="cfg-item-sub">
                        {slot.configured
                          ? `Fallback terverifikasi: ${slot.validFallbackCount} model`
                          : 'Fallback terverifikasi: belum dikonfigurasi'}
                      </p>
                      {slot.lastValidation ? (
                        <p className="cfg-item-sub">
                          Status koneksi terakhir:{' '}
                          {slot.lastError ? 'GAGAL' : 'berhasil'} ·{' '}
                          {formatDateTime(slot.lastValidation)}
                        </p>
                      ) : (
                        <p className="cfg-item-sub">Belum pernah diuji.</p>
                      )}
                      {slot.lastError && (
                        <p className="cfg-item-sub cfg-item-reason">
                          <strong>Alasan gagal:</strong>{' '}
                          {slot.lastErrorExplanation ||
                            `Kategori error ${slot.lastError}.`}
                        </p>
                      )}
                      {slot.lastErrorDetail && (
                        <p className="cfg-item-sub cfg-item-reason cfg-mono">
                          {slot.lastErrorDetail}
                        </p>
                      )}
                      {slot.blockedFallbackModels.length > 0 && (
                        <p className="cfg-item-sub">
                          Model cadangan ditolak:{' '}
                          {slot.blockedFallbackModels
                            .map((b) => `${b.modelId} (${b.status})`)
                            .join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="cfg-badges">
                    <span
                      className={`cfg-badge ${
                        slot.isActive
                          ? 'cfg-badge-free'
                          : slot.configured
                            ? 'cfg-badge-cadangan'
                            : 'cfg-badge-unverified'
                      }`}
                    >
                      {slot.isActive ? 'AKTIF' : slot.configured ? 'NONAKTIF' : 'NONAKTIF'}
                    </span>
                  </div>
                </div>

                <div className="cfg-item-actions">
                  {slot.isActive ? (
                    <button type="button" className="btn btn-secondary" disabled>
                      Provider Sedang Aktif
                    </button>
                  ) : slot.configured && slot.primaryModelAllowed ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => activate(slot)}
                      disabled={busy === slot.provider}
                    >
                      Jadikan Provider Aktif
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setSelected(slot.provider)}
                    >
                      Konfigurasi
                    </button>
                  )}
                  {slot.isActive && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => deactivate(slot)}
                      disabled={busy === slot.provider}
                    >
                      Nonaktifkan
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSelected(slot.provider)}
                    disabled={busy === slot.provider}
                  >
                    Atur Model
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===================== DETAIL PROVIDER TERPILIH ===================== */}
      {current && currentDraft && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="cfg-status-head">
            <h2 className="cfg-status-title">Konfigurasi — {current.specLabel}</h2>
            <span className="cfg-item-sub cfg-mono">{current.endpoint}</span>
          </div>
          <p className="cfg-hint" style={{ marginBottom: '0.9rem' }}>
            {current.note}
          </p>

          <div className="cfg-field">
            <label htmlFor={`apikey-${current.provider}`}>API Key</label>
            {current.hasApiKey && (
              <p className="cfg-key-saved">
                <span aria-hidden="true">🔑</span> API Key tersimpan (terenkripsi di server). Nilai lama
                tidak pernah ditampilkan kembali — biarkan kosong bila tidak ingin diganti.
              </p>
            )}
            <div className="cfg-key-row">
              <input
                id={`apikey-${current.provider}`}
                type={currentDraft.showKey ? 'text' : 'password'}
                value={currentDraft.apiKey}
                onChange={(e) => updateDraft(current.provider, { apiKey: e.target.value })}
                placeholder={
                  current.hasApiKey ? '•••••••• (kosongkan bila tidak diganti)' : 'Tempel API Key provider'
                }
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn btn-secondary cfg-key-toggle"
                onClick={() => updateDraft(current.provider, { showKey: !currentDraft.showKey })}
                aria-label={currentDraft.showKey ? 'Sembunyikan API Key' : 'Tampilkan API Key'}
              >
                {currentDraft.showKey ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {/* ------------------------- MODEL UTAMA ------------------------- */}
          <div className="cfg-field">
            <label htmlFor={`primary-${current.provider}`}>Model utama</label>
            <div className="cfg-item-actions" style={{ marginTop: 0, marginBottom: '0.4rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => loadCatalog(current.provider, true)}
                disabled={catalogLoading === current.provider}
              >
                {catalogLoading === current.provider ? 'Memuat…' : 'Perbarui katalog'}
              </button>
              {catalogMeta[current.provider]?.fetchedAt && (
                <span className="cfg-item-sub">
                  Katalog terakhir diperbarui:{' '}
                  {formatDateTime(catalogMeta[current.provider]?.fetchedAt ?? null)}
                </span>
              )}
            </div>
            <select
              id={`primary-${current.provider}`}
              className="cfg-model-select"
              value={
                (catalog[current.provider] || []).some((m) => m.id === currentDraft.primary)
                  ? currentDraft.primary
                  : currentDraft.primary
                    ? '__custom__'
                    : ''
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v !== '__custom__') updateDraft(current.provider, { primary: v });
              }}
              onFocus={() => loadCatalog(current.provider)}
            >
              <option value="">— belum dipilih —</option>
              {(catalog[current.provider] || []).map((m) => (
                // Model yang tidak boleh dipakai TETAP TAMPIL (dengan statusnya),
                // hanya tidak bisa dipilih lewat daftar ini.
                <option key={m.id} value={m.id} disabled={!m.selectable}>
                  {m.freeStatusLabel} — {m.name} ({m.id})
                </option>
              ))}
              {currentDraft.primary && (
                <option value="__custom__">{currentDraft.primary} (diKetik manual)</option>
              )}
            </select>
            <input
              className="cfg-model-input"
              value={currentDraft.primary}
              onChange={(e) => updateDraft(current.provider, { primary: e.target.value })}
              placeholder="contoh: vendor/nama-model"
            />
            {current.primaryModelStatus && current.primaryModel ? (
              <p className="cfg-hint">
                Status gratis model ini: <FreeBadge status={current.primaryModelStatus} />
                {current.primaryModelStatus === 'VERIFIED_FREE'
                  ? ' — boleh dipakai sebagai model utama maupun cadangan.'
                  : current.primaryModelStatus === 'PAID'
                    ? ' — DILARANG dipakai (model berbayar).'
                    : ' — belum boleh dipakai; verifikasi dari katalog resmi provider atau verifikasi manual.'}
              </p>
            ) : null}
            {catalogLoading === current.provider && (
              <p className="cfg-hint">Memuat daftar model {current.specLabel}…</p>
            )}

            {/* ------------- DAFTAR KATALOG LENGKAP + ALASAN PENOLAKAN ------------- */}
            {(catalog[current.provider] || []).length > 0 && (
              <div className="cfg-catalog">
                <div className="cfg-catalog-head">
                  <p className="cfg-catalog-title">
                    Model dari katalog resmi {current.specLabel} (
                    {catalogMeta[current.provider]?.summary?.total ?? 0} model)
                  </p>
                  <div className="cfg-item-actions" style={{ marginTop: 0 }}>
                    <span className="cfg-badge cfg-badge-free">
                      Gratis terverifikasi: {catalogMeta[current.provider]?.summary?.verifiedFree ?? 0}
                    </span>
                    <span className="cfg-badge cfg-badge-unverified">
                      Belum terverifikasi: {catalogMeta[current.provider]?.summary?.unverified ?? 0}
                    </span>
                    <span className="cfg-badge cfg-badge-paid">
                      Berbayar: {catalogMeta[current.provider]?.summary?.paid ?? 0}
                    </span>
                  </div>
                </div>
                <ul className="cfg-catalog-list">
                  {(catalog[current.provider] || [])
                    .slice(0, showAllCatalog[current.provider] ? undefined : 50)
                    .map((m) => (
                      <li key={m.id} className="cfg-catalog-row">
                        <div className="cfg-catalog-info">
                          <span className="cfg-catalog-name">
                            {m.name} <span className="cfg-mono">({m.id})</span>
                          </span>
                          <span className="cfg-catalog-meta">
                            <FreeBadge status={m.freeStatus} />
                            {m.pricingKnown ? (
                              <span className="cfg-item-sub">
                                {' '}
                                Harga: {m.pricingPrompt ?? '-'} / {m.pricingCompletion ?? '-'}
                              </span>
                            ) : (
                              <span className="cfg-item-sub"> Harga tidak dicantumkan katalog</span>
                            )}
                            {!m.supportsChat && (
                              <span className="cfg-item-sub"> · bukan model chat</span>
                            )}
                            {m.verificationSource === 'manual' && (
                              <span className="cfg-item-sub"> · verifikasi manual Admin</span>
                            )}
                          </span>
                          {m.freeReason && <span className="cfg-catalog-reason">{m.freeReason}</span>}
                          {m.evidenceUrl && (
                            <span className="cfg-catalog-reason">
                              Bukti:{' '}
                              <a href={m.evidenceUrl} target="_blank" rel="noreferrer noopener">
                                {m.evidenceUrl}
                              </a>
                            </span>
                          )}
                        </div>
                        <span className="cfg-catalog-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => updateDraft(current.provider, { primary: m.id })}
                            disabled={!m.selectable}
                            title={
                              m.selectable
                                ? 'Jadikan model utama'
                                : 'Model ini belum boleh dipakai (lihat alasan)'
                            }
                          >
                            Pakai
                          </button>
                          {m.freeStatus === 'UNVERIFIED' && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs"
                              onClick={() => openManual(current.provider, m.id)}
                            >
                              Verifikasi manual
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                </ul>
                {(catalog[current.provider] || []).length > 50 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() =>
                      setShowAllCatalog((prev) => ({
                        ...prev,
                        [current.provider]: !prev[current.provider],
                      }))
                    }
                  >
                    {showAllCatalog[current.provider]
                      ? 'Tampilkan 50 model pertama'
                      : `Tampilkan semua ${
                          (catalog[current.provider] || []).length
                        } model`}
                  </button>
                )}
                {catalogMeta[current.provider]?.hint && (
                  <p className="cfg-hint">
                    Status gratis model {current.specLabel} mengikuti tier akun sehingga tidak dapat
                    dibuktikan otomatis. Rujukan resmi:{' '}
                    <a
                      href={catalogMeta[current.provider]?.hint?.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {catalogMeta[current.provider]?.hint?.url}
                    </a>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ------------------------ MODEL CADANGAN ------------------------ */}
          <div className="cfg-field">
            <label>Model cadangan (urutan = prioritas)</label>
            {currentDraft.fallbacks.length === 0 ? (
              <p className="cfg-item-sub">Belum ada model cadangan.</p>
            ) : (
              <ol className="cfg-fallback-list">
                {currentDraft.fallbacks.map((m, i) => {
                  const info = current.fallbackModelsStatus?.find((f) => f.modelId === m);
                  const status: FreeStatus = info?.freeStatus ?? 'UNVERIFIED';
                  return (
                    <li key={`${m}-${i}`} className="cfg-fallback-row">
                      <span className="cfg-fallback-index">{i + 1}</span>
                      <span className="cfg-fallback-model cfg-mono">{m}</span>
                      <FreeBadge status={status} />
                      <span className="cfg-fallback-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => moveFallback(current.provider, i, -1)}
                          disabled={i === 0}
                          aria-label={`Naikkan prioritas ${m}`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => moveFallback(current.provider, i, 1)}
                          disabled={i === currentDraft.fallbacks.length - 1}
                          aria-label={`Turunkan prioritas ${m}`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => testModel(current, m)}
                          disabled={busy === current.provider}
                        >
                          Uji model
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          onClick={() => {
                            const list = [...currentDraft.fallbacks];
                            list.splice(i, 1);
                            updateDraft(current.provider, { fallbacks: list });
                          }}
                          aria-label={`Hapus ${m} dari daftar cadangan`}
                        >
                          Hapus
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            <div className="cfg-item-actions" style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() =>
                  updateDraft(current.provider, { fallbacks: [...currentDraft.fallbacks, ''] })
                }
              >
                + Tambah model cadangan
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => loadCatalog(current.provider)}
              >
                Muat daftar model
              </button>
            </div>
            <p className="cfg-hint">
              Jumlah model cadangan menyesuaikan ketersediaan model gratis terverifikasi — tidak
              dipaksa menjadi tiga. Model cadangan yang statusnya belum terverifikasi akan ditolak
              server saat disimpan.
            </p>
          </div>

          <div className="cfg-item-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => save(current)}
              disabled={busy === current.provider}
            >
              {busy === current.provider ? 'Menyimpan…' : 'Simpan Konfigurasi'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => testModel(current, currentDraft.primary)}
              disabled={busy === current.provider || !current.id || !currentDraft.primary}
            >
              Uji Koneksi
            </button>
          </div>
        </div>
      )}

      {/* ==================== MODAL VERIFIKASI MANUAL ==================== */}
      {manual && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Verifikasi manual model gratis"
        >
          <div className="modal-card card cfg-modal-wide">
            <h2 className="cfg-modal-title">Verifikasi Manual Model Gratis</h2>

            <p className="cfg-hint" style={{ marginBottom: '0.9rem' }}>
              Model <strong className="cfg-mono">{manual.modelId}</strong> ({manual.provider}) belum
              punya bukti gratis otomatis. Katalog resmi provider ini tidak mencantumkan harga, dan
              status gratis mengikuti tier akun. Periksa dokumentasi resmi di bawah, lalu konfirmasi
              bila model tersebut memang punya free tier untuk akun ini.
            </p>

            <div className="cfg-field">
              <label htmlFor="manual-evidence-url">URL bukti (wajib, domain resmi provider)</label>
              <input
                id="manual-evidence-url"
                type="url"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://…"
              />
              <p className="cfg-hint">
                Hanya URL pada domain resmi provider yang diterima server. Bukti dari sumber lain
                akan ditolak.
              </p>
            </div>

            <div className="cfg-field">
              <label htmlFor="manual-notes">Catatan syarat &amp; ketentuan</label>
              <textarea
                id="manual-notes"
                rows={4}
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
              />
              <p className="cfg-hint">
                Catat persyaratan tier akun (mis. free tier hanya berlaku bila penagihan belum
                diaktifkan) agar jejaknya jelas.
              </p>
            </div>

            {manualError && (
              <div className="cfg-alert error" role="alert">
                <span aria-hidden="true">⚠️</span>
                <span>{manualError}</span>
              </div>
            )}

            <div className="cfg-modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setManual(null)}
                disabled={manualBusy}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitManual}
                disabled={manualBusy || !manualUrl.trim()}
              >
                {manualBusy ? 'Menyimpan…' : 'Konfirmasi Gratis Terverifikasi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL REKOMENDASI ===================== */}
      {showRecommend && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Rekomendasi model gratis"
        >
          <div className="modal-card card cfg-modal-wide">
            <h2 className="cfg-modal-title">Rekomendasi Model Gratis</h2>
            {recommendLoading && <p className="cfg-item-sub">Memuat rekomendasi…</p>}

            {!recommendLoading && recommendation && (
              <>
                <p className="cfg-hint" style={{ marginBottom: '0.9rem' }}>
                  Hanya model dengan status <strong>gratis terverifikasi</strong> dari sumber resmi
                  provider yang ditampilkan. Model berbayar atau yang belum terverifikasi tidak
                  direkomendasikan.
                </p>

                {recommendation.warnings.length > 0 && (
                  <div className="cfg-alert warning">
                    <span aria-hidden="true">ℹ️</span>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                      {recommendation.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {recommendation.primary ? (
                  <>
                    <p className="cfg-recommend-label">Provider utama</p>
                    <RecommendationCard model={recommendation.primary} />
                  </>
                ) : (
                  <div className="cfg-alert error">
                    <span aria-hidden="true">⚠️</span>
                    <span>
                      Belum ada model gratis terverifikasi untuk provider ini. Jalankan “Verifikasi
                      Ulang dari Katalog Resmi” terlebih dahulu.
                    </span>
                  </div>
                )}

                {recommendation.fallbacks.length > 0 && (
                  <>
                    <p className="cfg-recommend-label">
                      Model cadangan ({recommendation.fallbacks.length})
                    </p>
                    <div className="cfg-list">
                      {recommendation.fallbacks.map((m, i) => (
                        <RecommendationCard key={`${m.provider}-${m.modelId}-${i}`} model={m} />
                      ))}
                    </div>
                  </>
                )}

                <p className="cfg-hint">
                  Terakhir diperbarui: {formatDateTime(recommendation.policyUpdatedAt)}
                </p>

                <div className="cfg-modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowRecommend(false)}
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowApplyConfirm(true)}
                    disabled={!recommendation.primary || busy === '__apply__'}
                  >
                    Terapkan Rekomendasi
                  </button>
                </div>
              </>
            )}

            {showApplyConfirm && recommendation?.primary && (
              <div className="cfg-alert warning" style={{ marginTop: '0.85rem' }}>
                <span aria-hidden="true">⚠️</span>
                <div>
                  <strong>Konfirmasi:</strong> simpan model utama & cadangan sesuai rekomendasi?
                  <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
                    <li>
                      Utama: {recommendation.primary.provider} — {recommendation.primary.modelId}
                    </li>
                    {recommendation.fallbacks.map((f, i) => (
                      <li key={i}>
                        Cadangan {i + 1}: {f.provider} — {f.modelId}
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: '0.4rem 0 0' }}>
                    Provider <strong>tidak</strong> diaktifkan otomatis dan API Key tidak diubah.
                  </p>
                  <div className="cfg-modal-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowApplyConfirm(false)}
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={applyRecommendation}
                      disabled={busy === '__apply__'}
                    >
                      Ya, Terapkan
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   Kartu rekomendasi
   ========================================================================== */

function RecommendationCard({ model }: { model: Recommendation }) {
  return (
    <div className="cfg-item">
      <div className="cfg-item-head">
        <div>
          <p className="cfg-item-title cfg-mono">{model.modelId}</p>
          <p className="cfg-item-sub">
            Provider: {model.providerLabel} ({model.provider})
          </p>
        </div>
        <FreeBadge status={model.freeStatus} />
      </div>
      <ul className="cfg-recommend-facts">
        <li>Bahasa Indonesia: {model.supportsIndonesian === 'ya' ? 'didukung' : 'tidak dijamin'}</li>
        <li>Multi-turn: {model.supportsMultiTurn}</li>
        <li>Gambar: {model.supportsImages ? 'didukung' : 'tidak didukung'}</li>
        <li>Verifikasi: {formatDateTime(model.verifiedAt)}</li>
        <li>
          Bukti:{' '}
          {model.evidenceUrl ? (
            <a href={model.evidenceUrl} target="_blank" rel="noreferrer noopener">
              {model.evidenceUrl}
            </a>
          ) : (
            '(tidak ada)'
          )}
        </li>
      </ul>
      <p className="cfg-item-sub">Alasan: {model.reason}</p>
      {model.notes && <p className="cfg-item-sub">Catatan bukti: {model.notes}</p>}
    </div>
  );
}
