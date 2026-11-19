import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKUP_MATRIX,
  applyMarkup,
  computeTotals,
  dueDateFor,
  efficiencyPct,
  entryMinutes,
  invoiceBalance,
  markupPctForCost,
  pmDue,
  resolvePartPrice,
  totalClockedHours,
  type ShopFeeSettings,
  type TotalsLine,
} from './calc';
import { canTransition } from './constants';
import { formatMoney, pctOf, toCents } from './money';

const fees: ShopFeeSettings = {
  partsTaxRatePct: 8.25,
  laborTaxRatePct: 0,
  shopSuppliesPct: 5,
  shopSuppliesCapCents: 7_500,
  shopSuppliesBase: 'labor',
  shopSuppliesTaxable: false,
};

describe('money', () => {
  it('converts dollars to cents without float drift', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents('0.1')).toBe(10);
    expect(toCents(1.005)).toBe(101);
    expect(toCents('abc')).toBe(0);
  });
  it('rounds percentages half-up to the cent', () => {
    expect(pctOf(1000, 8.25)).toBe(83); // 82.5 -> 83
    expect(pctOf(-1000, 8.25)).toBe(-83);
    expect(pctOf(0, 50)).toBe(0);
  });
  it('formats currency', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(null)).toBe('$0.00');
  });
});

describe('parts markup', () => {
  it('picks the matrix tier by cost', () => {
    expect(markupPctForCost(500, DEFAULT_MARKUP_MATRIX)).toBe(100);
    expect(markupPctForCost(1_000, DEFAULT_MARKUP_MATRIX)).toBe(100); // inclusive upper bound
    expect(markupPctForCost(1_001, DEFAULT_MARKUP_MATRIX)).toBe(60);
    expect(markupPctForCost(15_000, DEFAULT_MARKUP_MATRIX)).toBe(40);
    expect(markupPctForCost(5_000_000, DEFAULT_MARKUP_MATRIX)).toBe(20);
  });
  it('handles an unsorted matrix', () => {
    const m = [
      { upToCents: null, markupPct: 10 },
      { upToCents: 100, markupPct: 50 },
    ];
    expect(markupPctForCost(50, m)).toBe(50);
    expect(markupPctForCost(500, m)).toBe(10);
  });
  it('applies markup to cost', () => {
    expect(applyMarkup(4_299, 40)).toBe(6_019); // 42.99 * 1.4 = 60.186
    expect(applyMarkup(10_000, 0)).toBe(10_000);
  });
  it('resolves price with the right precedence', () => {
    const base = { costCents: 10_000, matrix: DEFAULT_MARKUP_MATRIX };
    expect(resolvePartPrice(base)).toMatchObject({ priceCents: 14_000, source: 'matrix', markupPct: 40 });
    expect(resolvePartPrice({ ...base, customerMarkupPct: 25 })).toMatchObject({ priceCents: 12_500, source: 'customer' });
    expect(resolvePartPrice({ ...base, customerMarkupPct: 25, partMarkupPct: 50 })).toMatchObject({
      priceCents: 15_000,
      source: 'part',
    });
    expect(resolvePartPrice({ ...base, partMarkupPct: 50, listPriceCents: 17_500 })).toMatchObject({
      priceCents: 17_500,
      source: 'list',
      markupPct: 75,
    });
  });
});

describe('labor time', () => {
  const t = (h: number, m = 0) => new Date(Date.UTC(2026, 0, 5, h, m));
  it('measures closed entries', () => {
    expect(entryMinutes({ startedAt: t(8), endedAt: t(9, 30) })).toBe(90);
  });
  it('runs open entries until now', () => {
    expect(entryMinutes({ startedAt: t(8), endedAt: null }, t(8, 45))).toBe(45);
  });
  it('never goes negative', () => {
    expect(entryMinutes({ startedAt: t(10), endedAt: t(9) })).toBe(0);
  });
  it('sums entries in hours rounded to 2dp', () => {
    const entries = [
      { startedAt: t(8), endedAt: t(9, 20) },
      { startedAt: t(10), endedAt: t(10, 31) },
      { startedAt: t(13).toISOString(), endedAt: null },
    ];
    // 80 + 31 + 15 = 126 min = 2.1h
    expect(totalClockedHours(entries, t(13, 15))).toBe(2.1);
  });
  it('computes efficiency', () => {
    expect(efficiencyPct(4, 3.2)).toBe(125);
    expect(efficiencyPct(2, 3)).toBe(66.7);
    expect(efficiencyPct(2, 0)).toBeNull();
  });
});

describe('work order totals', () => {
  const lines: TotalsLine[] = [
    {
      status: 'approved',
      laborHours: 2.5,
      laborRateCents: 14_500,
      parts: [
        { quantity: 2, unitPriceCents: 3_499, unitCostCents: 2_000, taxable: true },
        { quantity: 10, unitPriceCents: 1_250, unitCostCents: 800, taxable: true },
      ],
    },
    { status: 'pending', laborHours: 1, laborRateCents: 14_500, parts: [] },
    {
      status: 'declined',
      laborHours: 4,
      laborRateCents: 14_500,
      parts: [{ quantity: 1, unitPriceCents: 50_000, taxable: true }],
    },
  ];

  it('sums labor and parts, excluding declined lines', () => {
    const t = computeTotals(lines, fees);
    expect(t.laborCents).toBe(36_250 + 14_500);
    expect(t.partsCents).toBe(6_998 + 12_500);
    expect(t.partsCostCents).toBe(4_000 + 8_000);
    expect(t.declinedCents).toBe(58_000 + 50_000);
  });

  it('applies shop supplies as % of labor with a cap', () => {
    const t = computeTotals(lines, fees);
    // 5% of 507.50 = 25.375 -> 25.38
    expect(t.shopSuppliesCents).toBe(2_538);
    const capped = computeTotals(lines, { ...fees, shopSuppliesPct: 50 });
    expect(capped.shopSuppliesCents).toBe(7_500);
    const uncapped = computeTotals(lines, { ...fees, shopSuppliesPct: 50, shopSuppliesCapCents: 0 });
    expect(uncapped.shopSuppliesCents).toBe(25_375);
  });

  it('can base shop supplies on labor + parts', () => {
    const t = computeTotals(lines, { ...fees, shopSuppliesBase: 'labor_parts', shopSuppliesCapCents: 0 });
    expect(t.shopSuppliesCents).toBe(pctOf(50_750 + 19_498, 5));
  });

  it('taxes only taxable parts when labor is not taxable', () => {
    const t = computeTotals(lines, fees);
    // 8.25% of 194.98 = 16.08585 -> 16.09
    expect(t.taxCents).toBe(1_609);
    expect(t.subtotalCents).toBe(50_750 + 19_498 + 2_538);
    expect(t.totalCents).toBe(t.subtotalCents + 1_609);
  });

  it('taxes labor and shop supplies when configured, rounding once', () => {
    const t = computeTotals(lines, { ...fees, laborTaxRatePct: 6, shopSuppliesTaxable: true });
    const raw = ((19_498 + 2_538) * 8.25) / 100 + (50_750 * 6) / 100;
    expect(t.taxCents).toBe(Math.round(raw));
  });

  it('excludes non-taxable parts from tax', () => {
    const t = computeTotals(
      [{ status: 'approved', laborHours: 0, laborRateCents: 0, parts: [{ quantity: 1, unitPriceCents: 10_000, taxable: false }] }],
      fees,
    );
    expect(t.taxCents).toBe(0);
    expect(t.taxablePartsCents).toBe(0);
  });

  it('charges no tax to tax-exempt customers', () => {
    const t = computeTotals(lines, fees, { taxExempt: true });
    expect(t.taxCents).toBe(0);
    expect(t.totalCents).toBe(t.subtotalCents);
  });

  it('handles fractional quantities and hours', () => {
    const t = computeTotals(
      [
        {
          status: 'approved',
          laborHours: 0.3,
          laborRateCents: 13_333,
          parts: [{ quantity: 3.5, unitPriceCents: 999, taxable: true }],
        },
      ],
      { ...fees, shopSuppliesPct: 0 },
    );
    expect(t.laborCents).toBe(4_000); // 3999.9 -> 4000
    expect(t.partsCents).toBe(3_497); // 3496.5 -> 3497
  });

  it('returns zeros for an empty order', () => {
    const t = computeTotals([], fees);
    expect(t.totalCents).toBe(0);
  });
});

describe('invoices', () => {
  it('computes due dates from terms', () => {
    const issued = new Date('2026-03-01T12:00:00Z');
    expect(dueDateFor(issued, 'net30').toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(dueDateFor(issued, 'due_on_receipt').toISOString().slice(0, 10)).toBe('2026-03-01');
  });
  it('tracks balance and status from payments', () => {
    expect(invoiceBalance(10_000, [])).toEqual({ paidCents: 0, balanceCents: 10_000, status: 'unpaid' });
    expect(invoiceBalance(10_000, [2_500, 2_500])).toMatchObject({ balanceCents: 5_000, status: 'partial' });
    expect(invoiceBalance(10_000, [10_000])).toMatchObject({ balanceCents: 0, status: 'paid' });
    expect(invoiceBalance(10_000, [], true).status).toBe('void');
  });
});

describe('work order status transitions', () => {
  it('allows the normal flow and blocks skipping to invoiced', () => {
    expect(canTransition('estimate', 'approved')).toBe(true);
    expect(canTransition('approved', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'complete')).toBe(true);
    expect(canTransition('complete', 'invoiced')).toBe(false);
    expect(canTransition('estimate', 'complete')).toBe(false);
    expect(canTransition('invoiced', 'in_progress')).toBe(false);
  });
});

describe('preventive maintenance', () => {
  const today = new Date('2026-06-15T00:00:00Z');
  it('is ok when nothing is near due', () => {
    const r = pmDue(
      { intervalDays: 90, intervalMiles: 25_000, lastDoneAt: '2026-05-01', lastDoneMiles: 400_000 },
      { mileage: 405_000 },
      today,
    );
    expect(r.status).toBe('ok');
    expect(r.nextDueDate).toBe('2026-07-30');
    expect(r.nextDueMiles).toBe(425_000);
    expect(r.milesRemaining).toBe(20_000);
  });
  it('is due soon by date', () => {
    const r = pmDue({ intervalDays: 90, lastDoneAt: '2026-03-25' }, {}, today);
    expect(r.daysRemaining).toBe(8); // Mar 25 + 90d = Jun 23
    expect(r.status).toBe('due_soon');
  });
  it('is overdue by miles even when the date is fine (whichever first)', () => {
    const r = pmDue(
      { intervalDays: 180, intervalMiles: 15_000, lastDoneAt: '2026-06-01', lastDoneMiles: 100_000 },
      { mileage: 116_200 },
      today,
    );
    expect(r.status).toBe('overdue');
    expect(r.reasons[0]).toContain('1,200 mi overdue');
  });
  it('tracks engine hours', () => {
    const r = pmDue({ intervalHours: 500, lastDoneHours: 12_000 }, { engineHours: 12_470 }, today);
    expect(r.status).toBe('due_soon');
    expect(r.hoursRemaining).toBe(30);
  });
  it('flags a date-based schedule that was never performed', () => {
    expect(pmDue({ intervalDays: 365 }, {}, today).status).toBe('overdue');
  });
});
