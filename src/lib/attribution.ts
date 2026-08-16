/**
 * Decompose the same-paycheck $X gap into month-end holdings and cash
 * versus “that weight in the opponent.” Residual closes the identity.
 */

import type { OpponentComparison } from "@/lib/benchmarks";
import { externalNetFlow } from "@/lib/performance";
import {
  CASH_INSTRUMENT_ID,
  holdingMarketValueCad,
  instrumentIdentity,
  periodCashCad,
} from "@/lib/series";
import type { Period, PortfolioData } from "@/lib/types";

export interface AttributionPart {
  id: string;
  name: string;
  isCash: boolean;
  youPnl: number;
  opponentPnl: number;
  /** youPnl − opponentPnl; positive means this name beat that weight in the index. */
  contribution: number;
}

export interface GapAttribution {
  dollarDelta: number;
  youPnl: number;
  opponentPnl: number;
  parts: AttributionPart[];
  unexplained: number;
}

function instrumentValues(period: Period): Map<string, { name: string; isCash: boolean; value: number }> {
  const map = new Map<string, { name: string; isCash: boolean; value: number }>();
  for (const h of period.holdings ?? []) {
    const identity = instrumentIdentity(h);
    if (!identity) continue;
    const cad = holdingMarketValueCad(h, period);
    if (cad === 0) continue;
    const prev = map.get(identity.id);
    map.set(identity.id, {
      name: identity.name.split(" · ")[0] ?? identity.name,
      isCash: false,
      value: (prev?.value ?? 0) + cad,
    });
  }
  const cash = periodCashCad(period);
  if (cash > 0) {
    map.set(CASH_INSTRUMENT_ID, {
      name: "Cash",
      isCash: true,
      value: cash,
    });
  }
  return map;
}

function opponentMonthlyReturns(
  comparison: OpponentComparison,
): Array<number | null> {
  const growth =
    comparison.twrr.benchmarks[comparison.headline.opponentId]?.values ?? [];
  const out: Array<number | null> = growth.map(() => null);
  for (let i = 1; i < growth.length; i++) {
    const a = growth[i - 1];
    const b = growth[i];
    if (a === null || b === null || !(a > 0) || !Number.isFinite(b)) continue;
    out[i] = b / a - 1;
  }
  return out;
}

/**
 * Attribute you_end − opponent_end using beginning-of-month weights ×
 * opponent return versus the change in each name’s month-end CAD value.
 */
export function attributeGap(
  data: PortfolioData,
  comparison: OpponentComparison,
): GapAttribution {
  const youEnd = comparison.headline.youEnd ?? 0;
  const oppEnd = comparison.headline.opponentEnd ?? 0;
  const dollarDelta = youEnd - oppEnd;
  const start = data.periods[0]?.totalNetWorth ?? 0;
  const { deposits, withdrawals } = data.periods.slice(1).reduce(
    (s, p) => ({
      deposits: s.deposits + p.cashFlows.deposits,
      withdrawals: s.withdrawals + p.cashFlows.withdrawals,
    }),
    { deposits: 0, withdrawals: 0 },
  );
  const netFlow = externalNetFlow(deposits, withdrawals);
  const youPnl = youEnd - start - netFlow;
  const opponentPnl = oppEnd - start - netFlow;

  const shadow =
    comparison.cashflow.benchmarks[comparison.headline.opponentId]?.values ??
    [];
  const oppR = opponentMonthlyReturns(comparison);
  const acc = new Map<
    string,
    { name: string; isCash: boolean; youPnl: number; opponentPnl: number }
  >();

  for (let i = 1; i < data.periods.length; i++) {
    const prev = data.periods[i - 1];
    const cur = data.periods[i];
    const prevMap = instrumentValues(prev);
    const curMap = instrumentValues(cur);
    const ids = new Set([...prevMap.keys(), ...curMap.keys()]);
    const vPrev = prev.totalNetWorth;
    const sPrev = shadow[i - 1];
    const r = oppR[i];
    const shadowOk =
      sPrev !== null &&
      sPrev !== undefined &&
      Number.isFinite(sPrev) &&
      r !== null &&
      Number.isFinite(r);

    for (const id of ids) {
      const before = prevMap.get(id);
      const after = curMap.get(id);
      const you = (after?.value ?? 0) - (before?.value ?? 0);
      const w = vPrev > 0 && before ? before.value / vPrev : 0;
      const opp = shadowOk ? w * (sPrev as number) * (r as number) : 0;
      const row = acc.get(id) ?? {
        name: after?.name ?? before?.name ?? id,
        isCash: Boolean(after?.isCash ?? before?.isCash),
        youPnl: 0,
        opponentPnl: 0,
      };
      row.youPnl += you;
      row.opponentPnl += opp;
      acc.set(id, row);
    }
  }

  const parts: AttributionPart[] = [...acc.entries()]
    .map(([id, row]) => ({
      id,
      name: row.name,
      isCash: row.isCash,
      youPnl: row.youPnl,
      opponentPnl: row.opponentPnl,
      contribution: row.youPnl - row.opponentPnl,
    }))
    .filter((p) => Math.abs(p.contribution) > 0.005 || Math.abs(p.youPnl) > 0.005)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const explained = parts.reduce((s, p) => s + p.contribution, 0);
  return {
    dollarDelta,
    youPnl,
    opponentPnl,
    parts,
    unexplained: dollarDelta - explained,
  };
}
