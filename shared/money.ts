/** All money is stored and computed as integer cents to avoid floating point drift. */
export type Cents = number;

export function toCents(dollars: number | string): Cents {
  const n = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
  if (!Number.isFinite(n)) return 0;
  // toFixed(6) absorbs binary representation error (1.005 * 100 = 100.49999…)
  return Math.round(Number((n * 100).toFixed(6)));
}

export function toDollars(cents: Cents): number {
  return Math.round(cents) / 100;
}

export function formatMoney(cents: Cents | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Multiply cents by a percentage, rounding half away from zero to whole cents. */
export function pctOf(cents: Cents, pct: number): Cents {
  const raw = (cents * pct) / 100;
  return Math.sign(raw) * Math.round(Math.abs(raw) + 1e-9);
}
