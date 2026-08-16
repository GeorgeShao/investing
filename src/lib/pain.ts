/**
 * Max drawdown and worst 1 / 3 / 6 / 12-month returns on a path.
 * Used for you vs opponent on the same windowed series.
 */

import type { OpponentComparison } from "@/lib/benchmarks";

export const WORST_HORIZONS = [12, 6, 3, 1] as const;
export type WorstHorizon = (typeof WORST_HORIZONS)[number];

export interface WindowReturn {
  value: number | null;
  fromId: string | null;
  toId: string | null;
}

export interface PathPain {
  /** Peak-to-trough decline as a negative fraction of the peak. */
  maxDrawdown: number | null;
  peakValue: number | null;
  troughValue: number | null;
  peakPeriodId: string | null;
  troughPeriodId: string | null;
  /** Worst exact N-calendar-month simple return on this path. */
  worst: Record<WorstHorizon, WindowReturn>;
}

export interface OpponentPain {
  youHoldings: PathPain;
  opponentHoldings: PathPain;
  youDollars: PathPain;
  opponentDollars: PathPain;
}

const EMPTY_WINDOW: WindowReturn = {
  value: null,
  fromId: null,
  toId: null,
};

function emptyWorst(): Record<WorstHorizon, WindowReturn> {
  return {
    1: { ...EMPTY_WINDOW },
    3: { ...EMPTY_WINDOW },
    6: { ...EMPTY_WINDOW },
    12: { ...EMPTY_WINDOW },
  };
}

const EMPTY: PathPain = {
  maxDrawdown: null,
  peakValue: null,
  troughValue: null,
  peakPeriodId: null,
  troughPeriodId: null,
  worst: emptyWorst(),
};

export function monthsBetweenPeriodIds(a: string, b: string): number | null {
  const ay = Number(a.slice(0, 4));
  const am = Number(a.slice(5, 7));
  const by = Number(b.slice(0, 4));
  const bm = Number(b.slice(5, 7));
  if (![ay, am, by, bm].every((n) => Number.isFinite(n))) return null;
  return (by - ay) * 12 + (bm - am);
}

export function worstReturnOverMonths(
  values: Array<number | null>,
  periodIds: string[],
  months: number,
): WindowReturn {
  if (
    !(months > 0) ||
    values.length === 0 ||
    values.length !== periodIds.length
  ) {
    return { ...EMPTY_WINDOW };
  }
  let value: number | null = null;
  let fromId: string | null = null;
  let toId: string | null = null;
  for (let i = 0; i < values.length; i++) {
    const end = values[i];
    if (end === null || !Number.isFinite(end) || !(end > 0)) continue;
    for (let j = 0; j < i; j++) {
      const start = values[j];
      if (start === null || !Number.isFinite(start) || !(start > 0)) continue;
      if (monthsBetweenPeriodIds(periodIds[j], periodIds[i]) !== months) {
        continue;
      }
      const r = end / start - 1;
      if (value === null || r < value) {
        value = r;
        fromId = periodIds[j];
        toId = periodIds[i];
      }
    }
  }
  return { value, fromId, toId };
}

/**
 * Pain stats for an aligned value path. Nulls are skipped for peaks;
 * an undefined month does not break the running peak.
 */
export function computePathPain(
  values: Array<number | null>,
  periodIds: string[],
): PathPain {
  if (values.length === 0 || values.length !== periodIds.length) {
    return { ...EMPTY, worst: emptyWorst() };
  }

  let peak = -Infinity;
  let peakId: string | null = null;
  let worstDd = 0;
  let ddPeak = -Infinity;
  let ddTrough = -Infinity;
  let ddPeakId: string | null = null;
  let ddTroughId: string | null = null;
  let lastFinite: number | null = null;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) continue;
    lastFinite = v;
    if (v > peak) {
      peak = v;
      peakId = periodIds[i];
    } else if (peak > 0 && v < peak) {
      const dd = v / peak - 1;
      if (dd < worstDd) {
        worstDd = dd;
        ddPeak = peak;
        ddTrough = v;
        ddPeakId = peakId;
        ddTroughId = periodIds[i];
      }
    }
  }

  const worst = emptyWorst();
  for (const months of WORST_HORIZONS) {
    worst[months] = worstReturnOverMonths(values, periodIds, months);
  }

  return {
    maxDrawdown: worstDd < 0 ? worstDd : worstDd === 0 && peak > 0 ? 0 : null,
    peakValue: Number.isFinite(ddPeak) && ddPeak > 0 ? ddPeak : peak > 0 ? peak : null,
    troughValue:
      Number.isFinite(ddTrough) && ddTrough > 0 ? ddTrough : lastFinite,
    peakPeriodId: ddPeakId ?? peakId,
    troughPeriodId: ddTroughId,
    worst,
  };
}

export function computeOpponentPain(
  comparison: OpponentComparison,
): OpponentPain {
  const youH = comparison.twrr.portfolio;
  const oppH =
    comparison.twrr.benchmarks[comparison.headline.opponentId]?.values ?? [];
  const youD = comparison.cashflow.portfolio;
  const oppD =
    comparison.cashflow.benchmarks[comparison.headline.opponentId]?.values ??
    [];
  const ids = comparison.twrr.periodIds;
  const cashIds = comparison.cashflow.periodIds;
  return {
    youHoldings: computePathPain(youH, ids),
    opponentHoldings: computePathPain(oppH, ids),
    youDollars: computePathPain(youD, cashIds),
    opponentDollars: computePathPain(oppD, cashIds),
  };
}
