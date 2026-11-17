export function Card({ title, value, description }: { title: string, value: string | number, description?: string }) {
  return (
    <div className="glass card">
      <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{title}</h3>
      <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{value}</div>
      {description && <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{description}</p>}
    </div>
  );
}
