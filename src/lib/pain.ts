/**
 * Drawdown, time underwater, and worst 12-month return on a path.
 * Used for you vs opponent on the same windowed series.
 */

import type { OpponentComparison } from "@/lib/benchmarks";

export interface PathPain {
  /** Peak-to-trough decline as a negative fraction of the peak. */
  maxDrawdown: number | null;
  peakValue: number | null;
  troughValue: number | null;
  peakPeriodId: string | null;
  troughPeriodId: string | null;
  /** Months whose value is strictly below the running peak. */
  underwaterMonths: number;
  /** Longest consecutive underwater stretch (months). */
  longestUnderwaterMonths: number;
  stillUnderwater: boolean;
  /** Worst exact 12-calendar-month simple return on this path. */
  worst12m: number | null;
  worst12mFromId: string | null;
  worst12mToId: string | null;
}

export interface OpponentPain {
  youHoldings: PathPain;
  opponentHoldings: PathPain;
  youDollars: PathPain;
  opponentDollars: PathPain;
}

const EMPTY: PathPain = {
  maxDrawdown: null,
  peakValue: null,
  troughValue: null,
  peakPeriodId: null,
  troughPeriodId: null,
  underwaterMonths: 0,
  longestUnderwaterMonths: 0,
  stillUnderwater: false,
  worst12m: null,
  worst12mFromId: null,
  worst12mToId: null,
};

export function monthsBetweenPeriodIds(a: string, b: string): number | null {
  const ay = Number(a.slice(0, 4));
  const am = Number(a.slice(5, 7));
  const by = Number(b.slice(0, 4));
  const bm = Number(b.slice(5, 7));
  if (![ay, am, by, bm].every((n) => Number.isFinite(n))) return null;
  return (by - ay) * 12 + (bm - am);
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
    return { ...EMPTY };
  }

  let peak = -Infinity;
  let peakId: string | null = null;
  let worstDd = 0;
  let ddPeak = -Infinity;
  let ddTrough = -Infinity;
  let ddPeakId: string | null = null;
  let ddTroughId: string | null = null;
  let underwaterMonths = 0;
  let longest = 0;
  let run = 0;
  let lastFinite: number | null = null;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) continue;
    lastFinite = v;
    if (v > peak) {
      peak = v;
      peakId = periodIds[i];
      run = 0;
    } else if (peak > 0 && v < peak) {
      underwaterMonths += 1;
      run += 1;
      if (run > longest) longest = run;
      const dd = v / peak - 1;
      if (dd < worstDd) {
        worstDd = dd;
        ddPeak = peak;
        ddTrough = v;
        ddPeakId = peakId;
        ddTroughId = periodIds[i];
      }
    } else {
      run = 0;
    }
  }

  let worst12m: number | null = null;
  let worst12mFromId: string | null = null;
  let worst12mToId: string | null = null;
  for (let i = 0; i < values.length; i++) {
    const end = values[i];
    if (end === null || !Number.isFinite(end) || !(end > 0)) continue;
    for (let j = 0; j < i; j++) {
      const start = values[j];
      if (start === null || !Number.isFinite(start) || !(start > 0)) continue;
      if (monthsBetweenPeriodIds(periodIds[j], periodIds[i]) !== 12) continue;
      const r = end / start - 1;
      if (worst12m === null || r < worst12m) {
        worst12m = r;
        worst12mFromId = periodIds[j];
        worst12mToId = periodIds[i];
      }
    }
  }

  const stillUnderwater =
    lastFinite !== null && peak > 0 && lastFinite < peak && worstDd < 0;

  return {
    maxDrawdown: worstDd < 0 ? worstDd : worstDd === 0 && peak > 0 ? 0 : null,
    peakValue: Number.isFinite(ddPeak) && ddPeak > 0 ? ddPeak : peak > 0 ? peak : null,
    troughValue:
      Number.isFinite(ddTrough) && ddTrough > 0 ? ddTrough : lastFinite,
    peakPeriodId: ddPeakId ?? peakId,
    troughPeriodId: ddTroughId,
    underwaterMonths,
    longestUnderwaterMonths: longest,
    stillUnderwater,
    worst12m,
    worst12mFromId,
    worst12mToId,
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
