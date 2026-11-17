'use client';

interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  maxValue?: number;
}

export function BarChart({ data, height = 180, maxValue }: BarChartProps) {
  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '0.5rem',
          height: `${height}px`,
          padding: '0 0.25rem',
        }}
      >
        {data.map((item, i) => {
          const pct = Math.max((item.value / max) * 100, item.value > 0 ? 4 : 0);
          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.25rem',
                height: '100%',
                justifyContent: 'flex-end',
              }}
            >
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: item.color || 'var(--primary-color)',
                  opacity: item.value > 0 ? 1 : 0,
                }}
              >
                {item.value}
              </span>
              <div
                style={{
                  width: '100%',
                  height: `${pct}%`,
                  background: item.color
                    ? `linear-gradient(180deg, ${item.color}dd, ${item.color}88)`
                    : 'linear-gradient(180deg, var(--primary-color), var(--primary-hover))',
                  borderRadius: '6px 6px 0 0',
                  transition: 'height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  minHeight: item.value > 0 ? '4px' : '0',
                  position: 'relative',
                }}
                title={`${item.label}: ${item.value}`}
              />
            </div>
          );
        })}
      </div>
      {/* X Labels */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.4rem 0.25rem 0',
        }}
      >
        {data.map((item, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: '0.65rem',
              color: 'var(--text-secondary)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

interface DonutChartProps {
  data: { label: string; value: number; color: string }[];
  size?: number;
}

export function DonutChart({ data, size = 160 }: DonutChartProps) {
  const total = data.reduce((a, b) => a + b.value, 0);
  if (total === 0) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'var(--muted-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Kosong</span>
      </div>
    );
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const innerR = size * 0.24;
  const strokeW = (r - innerR) * 2;
  const circumference = 2 * Math.PI * (r - strokeW / 2 + innerR) / 2;

  // Build SVG arcs
  // Koordinat dibulatkan agar hasil Math.cos/Math.sin di server (Node) dan
  // browser menghasilkan string path yang identik saat hydration.
  const fmt = (value: number) => value.toFixed(3);
  let cumulative = 0;
  const segments = data
    .filter((d) => d.value > 0)
    .map((d) => {
      const ratio = d.value / total;
      const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
      const endAngle = (cumulative + ratio) * 2 * Math.PI - Math.PI / 2;
      cumulative += ratio;

      const midR = (r + innerR) / 2;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const xi1 = cx + innerR * Math.cos(endAngle);
      const yi1 = cy + innerR * Math.sin(endAngle);
      const xi2 = cx + innerR * Math.cos(startAngle);
      const yi2 = cy + innerR * Math.sin(startAngle);
      const large = ratio > 0.5 ? 1 : 0;

      const path = `M ${fmt(x1)} ${fmt(y1)} A ${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(x2)} ${fmt(y2)} L ${fmt(xi1)} ${fmt(yi1)} A ${fmt(innerR)} ${fmt(innerR)} 0 ${large} 0 ${fmt(xi2)} ${fmt(yi2)} Z`;
      return { ...d, path, ratio };
    });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {segments.map((seg, i) => (
          <path
            key={i}
            d={seg.path}
            fill={seg.color}
            opacity={0.9}
            style={{ transition: 'opacity 0.2s' }}
          >
            <title>{`${seg.label}: ${seg.value} (${Math.round(seg.ratio * 100)}%)`}</title>
          </path>
        ))}
        {/* Center text */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          style={{ fill: 'var(--text-primary)' }}
          fontSize={size * 0.14}
          fontWeight="700"
          fontFamily="Inter, sans-serif"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + size * 0.08}
          textAnchor="middle"
          style={{ fill: 'var(--text-secondary)' }}
          fontSize={size * 0.07}
          fontFamily="Inter, sans-serif"
        >
          Total
        </text>
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1, minWidth: '120px' }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '3px',
                background: d.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', flex: 1 }}>
              {d.label}
            </span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {d.value}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              ({total > 0 ? Math.round((d.value / total) * 100) : 0}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface HorizontalBarProps {
  data: { label: string; value: number; color?: string }[];
  maxValue?: number;
}

export function HorizontalBar({ data, maxValue }: HorizontalBarProps) {
  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }}>
      {data.map((item, i) => {
        const pct = Math.max((item.value / max) * 100, item.value > 0 ? 2 : 0);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '140px',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                fontWeight: 500,
                flexShrink: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={item.label}
            >
              {item.label}
            </div>
            <div
              style={{
                flex: 1,
                height: '10px',
                background: 'var(--muted-bg)',
                borderRadius: '9999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: item.color
                    ? `linear-gradient(90deg, ${item.color}, ${item.color}bb)`
                    : 'linear-gradient(90deg, var(--primary-color), var(--primary-hover))',
                  borderRadius: '9999px',
                  transition: 'width 0.6s ease',
                }}
              />
            </div>
            <span
              style={{
                width: '28px',
                fontSize: '0.78rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                textAlign: 'right',
                flexShrink: 0,
              }}
            >
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface LineChartProps {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
}

export function LineChart({ data, height = 120, color = 'var(--primary-color)' }: LineChartProps) {
  if (data.length < 2) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: '0.8rem',
        }}
      >
        Data tidak cukup untuk grafik garis
      </div>
    );
  }

  const W = 400;
  const H = height;
  const PAD = { top: 12, right: 16, bottom: 24, left: 28 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const max = Math.max(...data.map((d) => d.value), 1);
  const min = 0;

  const pts = data.map((d, i) => ({
    x: PAD.left + (i / (data.length - 1)) * innerW,
    y: PAD.top + innerH - ((d.value - min) / (max - min)) * innerH,
    value: d.value,
    label: d.label,
  }));

  const pathD = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  const areaD = `${pathD} L ${pts[pts.length - 1].x} ${H - PAD.bottom} L ${pts[0].x} ${H - PAD.bottom} Z`;

  // ID gradien harus aman untuk atribut url() (tanpa tanda kurung/koma).
  const gradId = `line-grad-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.25 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0.02 }} />
        </linearGradient>
      </defs>

      {/* Area fill */}
      <path d={areaD} fill={`url(#${gradId})`} />

      {/* Line */}
      <path
        d={pathD}
        fill="none"
        style={{ stroke: color }}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Points */}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" style={{ fill: color }} />
          <circle cx={p.x} cy={p.y} r="7" style={{ fill: color, fillOpacity: 0.15 }} />
          {/* Tooltip value on hover sim via title */}
          <title>
            {p.label}: {p.value}
          </title>
        </g>
      ))}

      {/* X axis labels */}
      {pts.map((p, i) => (
        <text
          key={i}
          x={p.x}
          y={H - 4}
          textAnchor="middle"
          fontSize="9"
          style={{ fill: 'var(--text-secondary)' }}
          fontFamily="Inter, sans-serif"
        >
          {p.label}
        </text>
      ))}

      {/* Y axis labels */}
      {[0, Math.round(max / 2), max].map((val, i) => {
        const y = PAD.top + innerH - ((val - min) / (max - min)) * innerH;
        return (
          <text
            key={i}
            x={PAD.left - 4}
            y={y + 3}
            textAnchor="end"
            fontSize="9"
            style={{ fill: 'var(--text-secondary)' }}
            fontFamily="Inter, sans-serif"
          >
            {val}
          </text>
        );
      })}
    </svg>
  );
}
