/**
 * One analysis experiment: a start date applied to You-vs-opponent, value,
 * flows, P&L, weights, and the forecast rate chip.
 */

import type { AccountGroupConfig, BenchmarkConfig, ChartStartWindow } from "@/lib/config";
import {
  computeOpponentComparison,
  listBenchmarkIds,
  pickDefaultOpponentId,
  type BenchmarkFile,
  type OpponentComparison,
} from "@/lib/benchmarks";
import { attributeGap, type GapAttribution } from "@/lib/attribution";
import { typicalMonthlyDeposits } from "@/lib/forecast";
import {
  buildMonthlyPnLSeries,
  computeReturnStats,
  type MonthlyPnLSeries,
} from "@/lib/performance";
import {
  buildCashFlowSeries,
  buildHoldingWeightSeries,
  buildNetWorthSeries,
  sliceFromPeriodId,
} from "@/lib/series";
import { computeOpponentPain, type OpponentPain } from "@/lib/pain";
import type {
  CashFlowSeries,
  HoldingWeightSeries,
  NetWorthSeries,
  PortfolioData,
} from "@/lib/types";

export interface AnalysisInputs {
  startPeriodId: string;
  accountGroups?: AccountGroupConfig[];
  benchmarks?: BenchmarkFile;
  opponentId?: string;
  benchmarkConfigs?: BenchmarkConfig[];
}

export interface WindowedAnalysis {
  startPeriodId: string;
  fromPeriodId: string | null;
  toPeriodId: string | null;
  data: PortfolioData;
  comparison: OpponentComparison | null;
  pain: OpponentPain | null;
  attribution: GapAttribution | null;
  netWorth: NetWorthSeries;
  cashFlow: CashFlowSeries;
  pnl: MonthlyPnLSeries;
  weights: HoldingWeightSeries;
  /** Holdings CAGR on this window — the forecast “your holdings” chip. */
  holdingsCagr: number | null;
  /** Opponent holdings CAGR on this window — the forecast opponent chip. */
  opponentHoldingsAnn: number | null;
  opponentLabel: string;
  opponentId: string;
  typicalMonthlyDeposit: number;
}

export function resolveStartPeriodId(
  data: PortfolioData,
  requestedId: string,
  windows: ChartStartWindow[] = [],
): string {
  if (!requestedId) {
    return windows[0]?.id ?? data.periods[0]?.id ?? "";
  }
  if (data.periods.some((p) => p.id === requestedId)) return requestedId;
  const ge = data.periods.find((p) => p.id >= requestedId);
  if (ge) return ge.id;
  return windows[0]?.id ?? data.periods[0]?.id ?? requestedId;
}

/**
 * Slice the portfolio at `startPeriodId` and build every surface of the
 * experiment from that same window. Callers must not re-slice.
 */
export function buildWindowedAnalysis(
  data: PortfolioData,
  inputs: AnalysisInputs,
): WindowedAnalysis {
  const start = resolveStartPeriodId(data, inputs.startPeriodId);
  const sliced = start ? sliceFromPeriodId(data, start) : data;
  const first = sliced.periods[0]?.id ?? null;
  const last = sliced.periods.at(-1)?.id ?? null;

  const preferredIds = inputs.benchmarkConfigs?.map((c) => c.id);
  const ids = inputs.benchmarks
    ? listBenchmarkIds(inputs.benchmarks.prices, preferredIds)
    : [];
  const opponentId =
    inputs.opponentId && ids.includes(inputs.opponentId)
      ? inputs.opponentId
      : pickDefaultOpponentId(ids);

  const comparison =
    inputs.benchmarks && ids.length > 0 && sliced.periods.length >= 2
      ? computeOpponentComparison(
          sliced,
          inputs.benchmarks,
          opponentId,
          inputs.benchmarkConfigs,
        )
      : null;

  const youStats = computeReturnStats(sliced);
  const typical = typicalMonthlyDeposits(
    sliced.periods.map((p) => p.cashFlows.deposits),
  );

  return {
    startPeriodId: start,
    fromPeriodId: first,
    toPeriodId: last,
    data: sliced,
    comparison,
    pain: comparison ? computeOpponentPain(comparison) : null,
    attribution: comparison ? attributeGap(sliced, comparison) : null,
    netWorth: buildNetWorthSeries(sliced, inputs.accountGroups ?? []),
    cashFlow: buildCashFlowSeries(sliced),
    pnl: buildMonthlyPnLSeries(sliced),
    weights: buildHoldingWeightSeries(sliced),
    holdingsCagr: youStats.cagr,
    opponentHoldingsAnn: comparison?.headline.opponentHoldingsAnn ?? null,
    opponentLabel:
      comparison?.headline.opponentLabel ?? opponentId,
    opponentId,
    typicalMonthlyDeposit: typical.amount,
  };
}
