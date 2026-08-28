import type { HoursEntry, PayPeriod, WageRate } from '../types';

// A team's pay cycle is defined by the day of month a period STARTS on.
// 1 gives calendar months; 16 gives periods running the 16th to the 15th,
// which is how Fireweed actually pays. Capped at 28 so the day exists in
// every month (no February surprises).
export const DEFAULT_PERIOD_START_DAY = 1;
export const clampStartDay = (n: number | undefined | null) =>
  Math.min(Math.max(Math.trunc(Number(n) || DEFAULT_PERIOD_START_DAY), 1), 28);

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

// The pay period CONTAINING `anchor`. Everything downstream keys off this,
// so a date always resolves to exactly one period no matter which day of
// it you happen to be looking at.
export function periodBounds(anchor: Date, startDay: number): { from: string; to: string } {
  const day = clampStartDay(startDay);
  // Before this month's start day means we're still inside the period that
  // opened last month. new Date() normalizes month -1 across a year edge.
  const m = anchor.getMonth() - (anchor.getDate() < day ? 1 : 0);
  const start = new Date(anchor.getFullYear(), m, day);
  const end = new Date(anchor.getFullYear(), m + 1, day);
  end.setDate(end.getDate() - 1);
  return { from: fmt(start), to: fmt(end) };
}

// Step a whole period back or forward, returning an anchor inside it.
export function shiftPeriod(anchor: Date, startDay: number, dir: -1 | 1): Date {
  const s = new Date(periodBounds(anchor, startDay).from + 'T12:00:00');
  return new Date(s.getFullYear(), s.getMonth() + dir, s.getDate());
}

// Calendar months read fine as "August 2026". Any other cycle has to show
// both ends, because calling Aug 16 – Sep 15 "August" would be a lie.
export function periodLabel(from: string, to: string): string {
  const s = new Date(from + 'T12:00:00');
  const e = new Date(to + 'T12:00:00');
  if (s.getDate() === 1) {
    return s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  const md: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString(undefined, md)} – ${e.toLocaleDateString(
    undefined,
    md
  )}, ${e.getFullYear()}`;
}

// Payday is the day after the period closes — the rhythm Fireweed already
// runs (the period ending the 15th gets paid on the 16th).
export const paydayFor = (periodEndDate: string) => {
  const d = new Date(periodEndDate + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d;
};

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
