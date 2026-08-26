import type { HoursEntry, PayPeriod, WageRate } from '../types';

// Fireweed runs calendar-month periods, paid on the 15th of the month after.
export const periodStart = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

export const periodEnd = (d: Date) => {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(
    last.getDate()
  ).padStart(2, '0')}`;
};

// Payday for the period that just ended: the 15th of the following month.
export const paydayFor = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 15);

export const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });

// The rate in force on a given date — the latest one effective on or before
// it. Mirrors the rate_on() SQL function; both must agree, which is why the
// rule lives in exactly these two places and nowhere else.
export function rateOn(rates: WageRate[], userId: string, date: string): number | null {
  const applicable = rates
    .filter((r) => r.userId === userId && r.effectiveFrom <= date)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return applicable.length ? applicable[0].rate : null;
}

export interface PersonTotals {
  userId: string;
  hours: number;
  tips: number;
  gross: number;
  /** True when some hours in the range have no wage on record — gross is
   *  then only the portion we could actually cost. */
  missingRate: boolean;
}

// Costs each entry at the rate in force on the day it was worked, rather
// than at anyone's current rate. That's the whole reason wage history
// exists: a raise must not restate a period already worked.
export function totalsFor(
  entries: HoursEntry[],
  rates: WageRate[],
  userId: string,
  from: string,
  to: string
): PersonTotals {
  const mine = entries.filter(
    (e) => e.userId === userId && e.date >= from && e.date <= to
  );
  let hours = 0;
  let tips = 0;
  let gross = 0;
  let missingRate = false;
  for (const e of mine) {
    hours += e.hours;
    tips += e.tips;
    const rate = rateOn(rates, userId, e.date);
    if (rate == null) missingRate = true;
    else gross += e.hours * rate;
  }
  return {
    userId,
    hours: round2(hours),
    tips: round2(tips),
    gross: round2(gross),
    missingRate,
  };
}

// Round at the boundary, not during accumulation — rounding each shift
// first would drift by a cent or two across a month.
export const round2 = (n: number) => Math.round(n * 100) / 100;

export function findPeriod(
  periods: PayPeriod[],
  from: string,
  to: string
): PayPeriod | undefined {
  return periods.find((p) => p.periodStart === from && p.periodEnd === to);
}
