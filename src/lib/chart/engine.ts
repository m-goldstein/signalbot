export type ChartMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ChartFrame = {
  width: number;
  height: number;
  margins: ChartMargins;
};

type Point = {
  x: number;
  y: number;
};

export type FibonacciLevel = {
  ratio: number;
  value: number;
  label: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function drawableWidth(frame: ChartFrame) {
  return frame.width - frame.margins.left - frame.margins.right;
}

export function drawableHeight(frame: ChartFrame) {
  return frame.height - frame.margins.top - frame.margins.bottom;
}

export function createXScale(length: number, frame: ChartFrame) {
  const width = drawableWidth(frame);

  return (index: number) =>
    frame.margins.left + (index / Math.max(length - 1, 1)) * width;
}

export function createYScale(min: number, max: number, frame: ChartFrame) {
  const height = drawableHeight(frame);
  const range = max - min || 1;

  return (value: number) =>
    frame.height - frame.margins.bottom - ((value - min) / range) * height;
}

export function createPriceDomain(values: number[], paddingPercent = 0.06) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min || max || 1) * paddingPercent;

  return {
    min: min - padding,
    max: max + padding,
  };
}

export function createTicks(min: number, max: number, count: number) {
  const step = (max - min) / Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, index) => min + step * index).reverse();
}

export function createIndexTicks(length: number, count: number) {
  if (length <= 0) {
    return [];
  }

  if (length === 1) {
    return [0];
  }

  const step = Math.max(1, Math.floor((length - 1) / Math.max(count - 1, 1)));
  const indices = Array.from({ length: count }, (_, index) => {
    if (index === count - 1) {
      return length - 1;
    }

    return clamp(index * step, 0, Math.max(length - 1, 0));
  });

  return Array.from(new Set(indices));
}

export function buildLinePath(points: Array<Point | null>) {
  let started = false;
  let path = "";

  for (const point of points) {
    if (!point) {
      started = false;
      continue;
    }

    path += `${started ? "L" : "M"} ${point.x} ${point.y} `;
    started = true;
  }

  return path.trim();
}

export function buildAreaPath(points: Point[], baselineY: number) {
  if (!points.length) {
    return "";
  }

  const line = buildLinePath(points);
  const last = points.at(-1);
  const first = points[0];

  if (!last) {
    return "";
  }

  return `${line} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

export function formatPriceTick(value: number) {
  if (value >= 1000) {
    return value.toFixed(0);
  }

  if (value >= 100) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
}

export function formatVolumeTick(value: number) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }

  return `${value.toFixed(0)}`;
}

export function formatDateTick(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(options ?? {}),
  });
}

export function computeFibonacciLevels(low: number, high: number) {
  const range = high - low;

  if (!Number.isFinite(range) || range <= 0) {
    return [] as FibonacciLevel[];
  }

  return [0.236, 0.382, 0.5, 0.618, 0.786].map((ratio) => ({
    ratio,
    value: high - range * ratio,
    label: `${(ratio * 100).toFixed(ratio === 0.5 ? 0 : 1)}%`,
  }));
}
