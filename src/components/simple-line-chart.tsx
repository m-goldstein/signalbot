type Point = {
  label: string;
  value: number;
};

type SimpleLineChartProps = {
  title: string;
  data: Point[];
};

export function SimpleLineChart({ title, data }: SimpleLineChartProps) {
  const width = 640;
  const height = 220;
  const padding = 24;
  const values = data.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0, 1);
  const range = max - min || 1;

  const path = data
    .map((point, index) => {
      const x = padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((point.value - min) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const zeroY = height - padding - ((0 - min) / range) * (height - padding * 2);

  return (
    <section>
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", border: "1px solid #d1d5db" }}>
        <line x1={padding} x2={width - padding} y1={zeroY} y2={zeroY} stroke="#9ca3af" strokeDasharray="4 4" />
        <path d={path} fill="none" stroke="#111827" strokeWidth="2" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "var(--font-mono), monospace", fontSize: 12 }}>
        <span>{data[0]?.label ?? ""}</span>
        <span>{data.at(-1)?.label ?? ""}</span>
      </div>
    </section>
  );
}
