export function average(values: number[]): number {
  if (!values.length) {
    throw new Error("Cannot average an empty series.");
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function last<T>(items: T[]): T {
  const value = items.at(-1);

  if (value === undefined) {
    throw new Error("Series is empty.");
  }

  return value;
}

export function percentDistance(value: number, reference: number): number {
  if (reference === 0) {
    return 0;
  }

  return ((value - reference) / reference) * 100;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
