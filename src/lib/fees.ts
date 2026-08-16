/**
 * Extracted statement fees vs published opponent MER drag on the
 * same-paycheck shadow path.
 */

import type { OpponentComparison } from "@/lib/benchmarks";
import type { PortfolioData } from "@/lib/types";

/**
 * Published net expense / MER (decimal). Named constants — not invented
 * per test or per user. Update when the issuer publishes a new figure.
 */
export const OPPONENT_MER: Record<
  string,
  { mer: number; label: string; source: string }
> = {
  QQQ: {
    mer: 0.002,
    label: "0.20%",
    source: "Invesco QQQ Trust expense ratio 0.20%",
  },
  VOO: {
    mer: 0.0003,
    label: "0.03%",
    source: "Vanguard S&P 500 ETF expense ratio 0.03%",
  },
  XEQT: {
    mer: 0.002,
    label: "0.20%",
    source: "iShares Core Equity ETF Portfolio MER 0.20%",
  },
};

export const DEFAULT_OPPONENT_MER = OPPONENT_MER.QQQ;

export interface FeeDrag {
  youPaid: number;
  opponentDrag: number;
  mer: number;
  merLabel: string;
  merSource: string;
  opponentId: string;
}

export function resolveOpponentMer(opponentId: string): {
  mer: number;
  label: string;
  source: string;
} {
  return OPPONENT_MER[opponentId] ?? DEFAULT_OPPONENT_MER;
}

/** Sum of extracted `cashFlows.fees` on the (already windowed/sleeved) document. */
export function sumExtractedFees(data: PortfolioData): number {
  let sum = 0;
  for (const period of data.periods) {
    const f = period.cashFlows.fees;
    if (typeof f === "number" && Number.isFinite(f)) sum += f;
  }
  return sum;
}

/**
 * Opponent MER drag: beginning-of-month shadow AUM × mer / 12, each month
 * after the opening snapshot. Uses the same-paycheck path (not holdings $1).
 */
export function opponentMerDrag(
  shadowLevels: Array<number | null>,
  mer: number,
): number {
  if (!(mer > 0)) return 0;
  let drag = 0;
  for (let i = 1; i < shadowLevels.length; i++) {
    const aum = shadowLevels[i - 1];
    if (aum === null || !Number.isFinite(aum) || !(aum > 0)) continue;
    drag += (aum * mer) / 12;
  }
  return drag;
}

export function computeFeeDrag(
  data: PortfolioData,
  comparison: OpponentComparison,
): FeeDrag {
  const meta = resolveOpponentMer(comparison.headline.opponentId);
  const shadow =
    comparison.cashflow.benchmarks[comparison.headline.opponentId]?.values ??
    [];
  return {
    youPaid: sumExtractedFees(data),
    opponentDrag: opponentMerDrag(shadow, meta.mer),
    mer: meta.mer,
    merLabel: meta.label,
    merSource: meta.source,
    opponentId: comparison.headline.opponentId,
  };
}
