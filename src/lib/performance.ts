/**
 * Pure portfolio performance math from month-end brokerage value + external cash flows.
 * External flow F_t = deposits_t − withdrawals_t (internal transfers excluded upstream).
 */

import type { PortfolioData } from "@/lib/types";

export interface MonthlyPnLPoint {
  periodId: string;
  label: string;
  /** Dollar P&L for the month: V_t − V_{t-1} − F_t */
  pnl: number;
  /** Simple monthly time-weighted return for the month, or null if undefined */
  twrrMonthly: number | null;
  netWorth: number;
  externalNetFlow: number;
  priorNetWorth: number;
}

export interface MonthlyPnLSeries {
  periods: string[];
  periodIds: string[];
  /** Aligned to periods; first entry is null (no prior month) */
  pnl: Array<number | null>;
  twrrMonthly: Array<number | null>;
}

export interface ReturnStats {
  /** Linked time-weighted total return over the span (not annualized) */
  twrrTotal: number | null;
  /** Annualized CAGR derived from linked TWRR and month count */
  cagr: number | null;
  /** Money-weighted (IRR) total return over the span (not annualized) */
  mwrrTotal: number | null;
  /** Annualized MWRR: (1+monthlyIRR)^12 − 1 when monthly IRR solved */
  mwrrAnnualized: number | null;
  /** Number of monthly sub-period returns used in TWRR link */
  monthCount: number;
  /** First / last period ids in the analysis window */
  fromPeriodId: string | null;
  toPeriodId: string | null;
  /** Start / end portfolio market value */
  startNetWorth: number | null;
  endNetWorth: number | null;
}

export function externalNetFlow(deposits: number, withdrawals: number): number {
  return deposits - withdrawals;
}

/**
 * Monthly dollar P&L: change in portfolio value not explained by external deposits/withdrawals.
 * P&L_t = V_t − V_{t-1} − (deposits_t − withdrawals_t)
 */
export function monthlyDollarPnL(
  priorNetWorth: number,
  netWorth: number,
  deposits: number,
  withdrawals: number,
): number {
  const f = externalNetFlow(deposits, withdrawals);
  return netWorth - priorNetWorth - f;
}

/**
 * Monthly time-weighted return (Modified Dietz).
 *
 * With only month-end values and period-aggregate external flows (unknown
 * intra-month timing), assume net external flow F occurs at mid-period:
 *
 *   r = (V_t − V_{t-1} − F) / (V_{t-1} + 0.5·F)
 *
 * where F = deposits − withdrawals (net contribution *into* the portfolio).
 *
 * End-of-period simple return (V_t − F)/V_{t-1} − 1 mis-attributes gains/losses
 * on large mid-month deposits to prior capital and can report r &lt; −100% even
 * when terminal wealth is positive — unsuitable for monthly statement data.
 *
 * Returns null when the denominator (average capital) is not positive.
 */
export function monthlyTwrr(
  priorNetWorth: number,
  netWorth: number,
  deposits: number,
  withdrawals: number,
): number | null {
  if (!Number.isFinite(priorNetWorth) || !Number.isFinite(netWorth)) {
    return null;
  }
  const f = externalNetFlow(deposits, withdrawals);
  if (!Number.isFinite(f)) return null;
  // Average capital under mid-period flow assumption
  const denom = priorNetWorth + 0.5 * f;
  if (!(denom > 0)) return null;
  const gain = netWorth - priorNetWorth - f;
  const r = gain / denom;
  return Number.isFinite(r) ? r : null;
}

export function buildMonthlyPnLSeries(data: PortfolioData): MonthlyPnLSeries {
  const periods = data.periods;
  const pnl: Array<number | null> = [];
  const twrrMonthly: Array<number | null> = [];

  for (let i = 0; i < periods.length; i++) {
    if (i === 0) {
      pnl.push(null);
      twrrMonthly.push(null);
      continue;
    }
    const prev = periods[i - 1];
    const cur = periods[i];
    const fDep = cur.cashFlows.deposits;
    const fWd = cur.cashFlows.withdrawals;
    pnl.push(
      monthlyDollarPnL(prev.totalNetWorth, cur.totalNetWorth, fDep, fWd),
    );
    twrrMonthly.push(
      monthlyTwrr(prev.totalNetWorth, cur.totalNetWorth, fDep, fWd),
    );
  }

  return {
    periods: periods.map((p) => p.label),
    periodIds: periods.map((p) => p.id),
    pnl,
    twrrMonthly,
  };
}

export function listMonthlyPnLPoints(data: PortfolioData): MonthlyPnLPoint[] {
  const series = buildMonthlyPnLSeries(data);
  const out: MonthlyPnLPoint[] = [];
  for (let i = 1; i < data.periods.length; i++) {
    const cur = data.periods[i];
    const prev = data.periods[i - 1];
    const f = externalNetFlow(
      cur.cashFlows.deposits,
      cur.cashFlows.withdrawals,
    );
    out.push({
      periodId: cur.id,
      label: cur.label,
      pnl: series.pnl[i] as number,
      twrrMonthly: series.twrrMonthly[i],
      netWorth: cur.totalNetWorth,
      externalNetFlow: f,
      priorNetWorth: prev.totalNetWorth,
    });
  }
  return out;
}

/**
 * Product of (1+r_t) − 1 for defined monthly returns.
 * Skips nulls; if any included month has r ≤ −100% (1+r ≤ 0), linked total
 * is still returned (may be ≤ −100%) so callers can blank CAGR correctly.
 */
export function linkTwrr(monthlyReturns: Array<number | null>): number | null {
  const rs = monthlyReturns.filter(
    (r): r is number => r !== null && Number.isFinite(r),
  );
  if (rs.length === 0) return null;
  let growth = 1;
  for (const r of rs) {
    growth *= 1 + r;
    if (!Number.isFinite(growth)) return null;
  }
  return growth - 1;
}

/**
 * Annualized CAGR from a total return over `monthCount` months:
 * (1 + totalReturn)^(12/monthCount) − 1
 */
export function cagrFromTotalReturn(
  totalReturn: number | null,
  monthCount: number,
): number | null {
  if (totalReturn === null || !Number.isFinite(totalReturn) || monthCount <= 0) {
    return null;
  }
  if (1 + totalReturn <= 0) return null;
  return Math.pow(1 + totalReturn, 12 / monthCount) - 1;
}

/**
 * Newton–Raphson IRR for equally spaced cash flows (period rate).
 * Returns null if it fails to converge or cash flows cannot have a real IRR.
 */
export function irrPeriodic(
  cashFlows: number[],
  guess = 0.0,
  maxIter = 100,
  tol = 1e-9,
): number | null {
  if (cashFlows.length < 2) return null;
  const hasPos = cashFlows.some((c) => c > 0);
  const hasNeg = cashFlows.some((c) => c < 0);
  if (!hasPos || !hasNeg) return null;

  let rate = guess;
  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      if (!Number.isFinite(denom) || denom === 0) return null;
      npv += cashFlows[t] / denom;
      if (t > 0) {
        dnpv -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
      }
    }
    if (Math.abs(dnpv) < 1e-14) break;
    const next = rate - npv / dnpv;
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - rate) < tol) {
      return Math.abs(npv) < 1e-4 ? next : next;
    }
    rate = next;
    // keep rate in a sane band for monthly returns
    if (rate < -0.99) rate = -0.99;
    if (rate > 10) rate = 10;
  }
  return Number.isFinite(rate) ? rate : null;
}

/**
 * Build MWRR cash-flow timeline (investor perspective):
 *   t=0: −V_0
 *   t=1..T−1: −F_t  (deposits positive F → investor outflow)
 *   t=T: −F_T + V_T
 * where F_t = deposits_t − withdrawals_t for period t.
 */
export function buildMwrrCashFlows(data: PortfolioData): number[] {
  const periods = data.periods;
  if (periods.length === 0) return [];
  const n = periods.length;
  const cfs: number[] = new Array(n).fill(0);
  cfs[0] = -periods[0].totalNetWorth;
  for (let t = 1; t < n; t++) {
    const f = externalNetFlow(
      periods[t].cashFlows.deposits,
      periods[t].cashFlows.withdrawals,
    );
    cfs[t] = -f;
  }
  cfs[n - 1] += periods[n - 1].totalNetWorth;
  return cfs;
}

export function computeReturnStats(data: PortfolioData): ReturnStats {
  const periods = data.periods;
  if (periods.length < 2) {
    return {
      twrrTotal: null,
      cagr: null,
      mwrrTotal: null,
      mwrrAnnualized: null,
      monthCount: 0,
      fromPeriodId: periods[0]?.id ?? null,
      toPeriodId: periods[0]?.id ?? null,
      startNetWorth: periods[0]?.totalNetWorth ?? null,
      endNetWorth: periods[0]?.totalNetWorth ?? null,
    };
  }

  const pnlSeries = buildMonthlyPnLSeries(data);
  const twrrTotal = linkTwrr(pnlSeries.twrrMonthly);
  const monthCount = pnlSeries.twrrMonthly.filter(
    (r) => r !== null && Number.isFinite(r),
  ).length;
  const cagr = cagrFromTotalReturn(twrrTotal, monthCount);

  const cfs = buildMwrrCashFlows(data);
  const monthlyIrr = irrPeriodic(cfs, 0.0);
  let mwrrTotal: number | null = null;
  let mwrrAnnualized: number | null = null;
  if (monthlyIrr !== null) {
    // Total money-weighted growth over n-1 intervals
    const intervals = cfs.length - 1;
    if (intervals > 0 && 1 + monthlyIrr > 0) {
      mwrrTotal = Math.pow(1 + monthlyIrr, intervals) - 1;
    }
    mwrrAnnualized = 1 + monthlyIrr > 0 ? Math.pow(1 + monthlyIrr, 12) - 1 : null;
  }

  return {
    twrrTotal,
    cagr,
    mwrrTotal,
    mwrrAnnualized,
    monthCount,
    fromPeriodId: periods[0].id,
    toPeriodId: periods[periods.length - 1].id,
    startNetWorth: periods[0].totalNetWorth,
    endNetWorth: periods[periods.length - 1].totalNetWorth,
  };
}

export function formatPercent(
  value: number | null,
  digits = 1,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * Brokerage-homepage total return over a window:
 *
 *   gain = end − start − (deposits − withdrawals)
 *   invested = start + deposits − withdrawals
 *   rate = gain / invested   (null when invested ≤ 0)
 *
 * Dollar gain matches monthly P&L summed over the window. The percent treats
 * every deposit as if it sat in the account the whole window — late paychecks
 * shrink the rate. Never compare this rate to a published index return
 * unless the index path used the same start and the same deposits.
 */
export function simpleInvestedReturn(
  start: number,
  end: number,
  deposits: number,
  withdrawals: number,
): { gain: number; invested: number; rate: number | null } {
  const netFlow = externalNetFlow(deposits, withdrawals);
  const gain = end - start - netFlow;
  const invested = start + netFlow;
  const rate =
    invested > 0 && Number.isFinite(gain / invested) ? gain / invested : null;
  return { gain, invested, rate };
}

export interface WindowSimpleReturn {
  start: number;
  end: number;
  deposits: number;
  withdrawals: number;
  gain: number;
  invested: number;
  rate: number | null;
}

/**
 * Sum external deposits/withdrawals after the opening snapshot.
 * Period `fromIdx` is the start level; flows on that row are ignored
 * (already inside the opening balance).
 */
export function sumExternalFlowsAfter(
  data: PortfolioData,
  fromIdx: number,
  toIdx: number,
): { deposits: number; withdrawals: number } {
  let deposits = 0;
  let withdrawals = 0;
  for (let i = fromIdx + 1; i <= toIdx; i++) {
    deposits += data.periods[i].cashFlows.deposits;
    withdrawals += data.periods[i].cashFlows.withdrawals;
  }
  return { deposits, withdrawals };
}

export function simpleReturnForValues(
  data: PortfolioData,
  values: Array<number | null>,
  fromIdx: number,
  toIdx: number,
): WindowSimpleReturn | null {
  if (
    fromIdx < 0 ||
    toIdx < fromIdx ||
    toIdx >= data.periods.length ||
    values.length !== data.periods.length
  ) {
    return null;
  }
  const start = values[fromIdx];
  const end = values[toIdx];
  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  const { deposits, withdrawals } = sumExternalFlowsAfter(data, fromIdx, toIdx);
  const { gain, invested, rate } = simpleInvestedReturn(
    start,
    end,
    deposits,
    withdrawals,
  );
  return { start, end, deposits, withdrawals, gain, invested, rate };
}

/**
 * IRR on a value path that shares the portfolio's external flows.
 * Used for the index's same-paycheck earned rate.
 */
export function mwrrStatsForValues(
  data: PortfolioData,
  values: Array<number | null>,
): { total: number | null; annualized: number | null } {
  const empty = { total: null, annualized: null };
  const periods = data.periods;
  if (periods.length < 2 || values.length !== periods.length) return empty;
  const start = values[0];
  const end = values[values.length - 1];
  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) {
    return empty;
  }

  const cfs: number[] = new Array(periods.length).fill(0);
  cfs[0] = -start;
  for (let t = 1; t < periods.length; t++) {
    cfs[t] = -externalNetFlow(
      periods[t].cashFlows.deposits,
      periods[t].cashFlows.withdrawals,
    );
  }
  cfs[periods.length - 1] += end;

  const monthlyIrr = irrPeriodic(cfs, 0.0);
  if (monthlyIrr === null) return empty;
  const intervals = cfs.length - 1;
  const total =
    intervals > 0 && 1 + monthlyIrr > 0
      ? Math.pow(1 + monthlyIrr, intervals) - 1
      : null;
  const annualized =
    1 + monthlyIrr > 0 ? Math.pow(1 + monthlyIrr, 12) - 1 : null;
  return { total, annualized };
}

export interface YearlyReturnRow {
  year: number;
  fromPeriodId: string;
  toPeriodId: string;
  /** True if the window does not cover Jan–Dec of that year */
  isPartial: boolean;
  /** Linked TWRR over months that fall in this calendar year */
  twrr: number | null;
  /** Money-weighted total return over the year (IRR linked to year length) */
  mwrr: number | null;
  /** Number of monthly TWRR sub-periods used */
  monthCount: number;
}

export function yearOfPeriodId(periodId: string): number | null {
  const y = Number(periodId.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

export function monthOfPeriodId(periodId: string): number | null {
  const m = Number(periodId.slice(5, 7));
  return Number.isFinite(m) ? m : null;
}

export interface YearWindow {
  year: number;
  firstIdx: number;
  lastIdx: number;
  /** Snapshot used as the year's opening level (prior month when available). */
  openIdx: number;
  fromPeriodId: string;
  toPeriodId: string;
  isPartial: boolean;
}

export function listYearWindows(data: PortfolioData): YearWindow[] {
  const periods = data.periods;
  if (periods.length === 0) return [];

  const years = new Set<number>();
  for (const p of periods) {
    const y = yearOfPeriodId(p.id);
    if (y !== null) years.add(y);
  }

  const rows: YearWindow[] = [];
  for (const year of [...years].sort((a, b) => a - b)) {
    const indices: number[] = [];
    for (let i = 0; i < periods.length; i++) {
      if (yearOfPeriodId(periods[i].id) === year) indices.push(i);
    }
    if (indices.length === 0) continue;
    const firstIdx = indices[0];
    const lastIdx = indices[indices.length - 1];
    const fromPeriodId = periods[firstIdx].id;
    const toPeriodId = periods[lastIdx].id;
    const firstMonth = monthOfPeriodId(fromPeriodId);
    const lastMonth = monthOfPeriodId(toPeriodId);
    const isPartial =
      firstMonth !== 1 || lastMonth !== 12 || indices.length < 12;
    rows.push({
      year,
      firstIdx,
      lastIdx,
      openIdx: firstIdx > 0 ? firstIdx - 1 : firstIdx,
      fromPeriodId,
      toPeriodId,
      isPartial,
    });
  }
  return rows;
}

/**
 * Calendar-year MWRR given end-of-month values aligned to `data.periods`
 * (portfolio NW or cash-flow-matched shadow index levels).
 * Opening capital uses the period before the first in-year month when available.
 */
export function yearlyMwrrForValues(
  data: PortfolioData,
  year: number,
  endOfMonthValues: Array<number | null>,
): number | null {
  const periods = data.periods;
  if (periods.length === 0 || endOfMonthValues.length !== periods.length) {
    return null;
  }

  const indices: number[] = [];
  for (let i = 0; i < periods.length; i++) {
    if (yearOfPeriodId(periods[i].id) === year) indices.push(i);
  }
  if (indices.length === 0) return null;

  const firstIdx = indices[0];
  const lastIdx = indices[indices.length - 1];
  const terminal = endOfMonthValues[lastIdx];
  if (terminal === null || !Number.isFinite(terminal)) return null;

  const cfs: number[] = [];
  if (firstIdx > 0) {
    const open = endOfMonthValues[firstIdx - 1];
    if (open === null || !Number.isFinite(open)) return null;
    cfs.push(-open);
    for (let i = firstIdx; i <= lastIdx; i++) {
      const f = externalNetFlow(
        periods[i].cashFlows.deposits,
        periods[i].cashFlows.withdrawals,
      );
      cfs.push(-f);
    }
    cfs[cfs.length - 1] += terminal;
  } else {
    const open = endOfMonthValues[firstIdx];
    if (open === null || !Number.isFinite(open)) return null;
    cfs.push(-open);
    for (let i = firstIdx + 1; i <= lastIdx; i++) {
      const f = externalNetFlow(
        periods[i].cashFlows.deposits,
        periods[i].cashFlows.withdrawals,
      );
      cfs.push(-f);
    }
    if (cfs.length === 1) {
      cfs.push(terminal);
    } else {
      cfs[cfs.length - 1] += terminal;
    }
  }

  const monthlyIrr = irrPeriodic(cfs, 0.0);
  if (monthlyIrr === null || cfs.length < 2 || 1 + monthlyIrr <= 0) return null;
  return Math.pow(1 + monthlyIrr, cfs.length - 1) - 1;
}

/**
 * Calendar-year TWRR and MWRR for each year present in the data window.
 * Uses only periods in `data` (already start-date filtered by the UI).
 *
 * TWRR: product of monthly r_t for months whose *end* period is in that year
 * (needs the prior month in the series for the first return).
 *
 * MWRR: IRR with opening capital = NW at end of month before the first month
 * of the year in-window (or first in-year NW if no prior), external −F each
 * in-year month, terminal +V at last in-year month.
 */
export function computeYearlyReturns(data: PortfolioData): YearlyReturnRow[] {
  const periods = data.periods;
  if (periods.length === 0) return [];

  const pnl = buildMonthlyPnLSeries(data);
  const rows: YearlyReturnRow[] = [];

  for (const window of listYearWindows(data)) {
    const { year, firstIdx, lastIdx, fromPeriodId, toPeriodId, isPartial } =
      window;

    // TWRR: monthly returns for each period index in the year where prior exists
    const yearMonthly: Array<number | null> = [];
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (i === 0) continue; // no prior in series
      yearMonthly.push(pnl.twrrMonthly[i]);
    }
    const twrr = linkTwrr(yearMonthly);
    const monthCount = yearMonthly.filter(
      (r) => r !== null && Number.isFinite(r),
    ).length;

    // MWRR cash flows across the year
    const cfs: number[] = [];
    if (firstIdx > 0) {
      cfs.push(-periods[firstIdx - 1].totalNetWorth);
      for (let i = firstIdx; i <= lastIdx; i++) {
        const f = externalNetFlow(
          periods[i].cashFlows.deposits,
          periods[i].cashFlows.withdrawals,
        );
        cfs.push(-f);
      }
      cfs[cfs.length - 1] += periods[lastIdx].totalNetWorth;
    } else {
      cfs.push(-periods[firstIdx].totalNetWorth);
      for (let i = firstIdx + 1; i <= lastIdx; i++) {
        const f = externalNetFlow(
          periods[i].cashFlows.deposits,
          periods[i].cashFlows.withdrawals,
        );
        cfs.push(-f);
      }
      if (cfs.length === 1) {
        // Single month only: −V + V = 0 unless we treat as open/close same
        cfs[0] = -periods[firstIdx].totalNetWorth;
        cfs.push(periods[lastIdx].totalNetWorth);
      } else {
        cfs[cfs.length - 1] += periods[lastIdx].totalNetWorth;
      }
    }

    const monthlyIrr = irrPeriodic(cfs, 0.0);
    let mwrr: number | null = null;
    if (monthlyIrr !== null && cfs.length >= 2 && 1 + monthlyIrr > 0) {
      const intervals = cfs.length - 1;
      mwrr = Math.pow(1 + monthlyIrr, intervals) - 1;
    }

    rows.push({
      year,
      fromPeriodId,
      toPeriodId,
      isPartial,
      twrr,
      mwrr,
      monthCount,
    });
  }

  return rows;
}
