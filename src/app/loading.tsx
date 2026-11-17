export default function Loading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem' }}>
      <span className="spinner" />
      <span style={{ marginLeft: '0.75rem', color: 'var(--text-secondary)' }}>Memuat...</span>
    </div>
  );
}
