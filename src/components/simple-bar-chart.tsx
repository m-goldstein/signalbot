type Datum = {
  label: string;
  value: number;
};

type SimpleBarChartProps = {
  title: string;
  data: Datum[];
  currency?: boolean;
};

function formatValue(value: number, currency: boolean) {
  if (!currency) {
    return value.toLocaleString();
  }

  const absolute = Math.abs(value);

  if (absolute >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (absolute >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }

  if (absolute >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }

  return `$${value.toFixed(0)}`;
}

export function SimpleBarChart({ title, data, currency = false }: SimpleBarChartProps) {
  const maxValue = Math.max(...data.map((entry) => Math.abs(entry.value)), 1);

  return (
    <section>
      <h3>{title}</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {data.map((entry) => {
          const width = `${(Math.abs(entry.value) / maxValue) * 100}%`;
          const isPositive = entry.value >= 0;

          return (
            <div key={entry.label} style={{ display: "grid", gap: 4 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  fontFamily: "var(--font-mono), monospace",
                  fontSize: 13,
                }}
              >
                <span>{entry.label}</span>
                <span>{formatValue(entry.value, currency)}</span>
              </div>
              <div style={{ background: "#e5e7eb", height: 16 }}>
                <div
                  style={{
                    width,
                    height: "100%",
                    background: isPositive ? "#2563eb" : "#b91c1c",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
