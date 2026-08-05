/**
 * Align portfolio month-end periods to offline benchmark prices and build
 * cumulative growth indexes (start = 1.0) or cash-flow-matched dollar paths.
 *
 * Benchmark ids are data-driven from the prices file / app config rather than
 * a hard-coded XEQT|VOO|QQQ union type.
 */

import type { PortfolioData } from "@/lib/types";
import type { BenchmarkConfig } from "@/lib/config";
import {
  buildMonthlyPnLSeries,
  externalNetFlow,
  monthOfPeriodId,
  monthlyTwrr,
  yearOfPeriodId,
  yearlyMwrrForValues,
} from "@/lib/performance";

export type BenchmarkId = string;

export interface BenchmarkFile {
  meta: {
    generatedAt?: string;
    source?: string;
    notes?: string[];
    tickers?: Record<string, string>;
  };
  prices: Record<string, Record<string, number> | undefined>;
}

export interface BenchmarkSeries {
  periods: string[];
  periodIds: string[];
  /**
   * For "twrr": cumulative growth (start ≈ 1.0).
   * For "cashflow": CAD market value levels (portfolio NW vs shadow index).
   */
  portfolio: Array<number | null>;
  benchmarks: Record<
    string,
    {
      label: string;
      currencyNote: string;
      values: Array<number | null>;
    }
  >;
  mode: BenchmarkCompareMode;
}

/** Time-weighted growth vs same external cash flows into each index. */
export type BenchmarkCompareMode = "twrr" | "cashflow";

const DEFAULT_BENCHMARK_META: Record<
  string,
  { label: string; currencyNote: string; yahoo: string; currency: string }
> = {
  XEQT: {
    label: "XEQT",
    currencyNote: "CAD (XEQT.TO)",
    yahoo: "XEQT.TO",
    currency: "CAD",
  },
  VOO: {
    label: "VOO",
    currencyNote: "USD converted with month-end USDCAD",
    yahoo: "VOO",
    currency: "USD",
  },
  QQQ: {
    label: "QQQ",
    currencyNote: "USD converted with month-end USDCAD",
    yahoo: "QQQ",
    currency: "USD",
  },
};

export function resolveBenchmarkMeta(
  id: string,
  configs?: BenchmarkConfig[],
): { label: string; currencyNote: string; yahoo: string; currency: string } {
  const fromConfig = configs?.find((b) => b.id === id);
  if (fromConfig) {
    const isUsd = fromConfig.currency.toUpperCase() === "USD";
    return {
      label: fromConfig.label ?? fromConfig.id,
      currencyNote: isUsd
        ? "USD converted with month-end USDCAD"
        : `${fromConfig.currency} (${fromConfig.yahoo})`,
      yahoo: fromConfig.yahoo,
      currency: fromConfig.currency,
    };
  }
  return (
    DEFAULT_BENCHMARK_META[id] ?? {
      label: id,
      currencyNote: id,
      yahoo: id,
      currency: "CAD",
    }
  );
}

/**
 * Benchmark ids present in the prices file (excluding FX helpers like USDCAD).
 */
export function listBenchmarkIds(
  prices: BenchmarkFile["prices"],
  preferred?: string[],
): string[] {
  const keys = Object.keys(prices).filter(
    (k) => k !== "USDCAD" && prices[k] && Object.keys(prices[k]!).length > 0,
  );
  if (preferred && preferred.length > 0) {
    const set = new Set(keys);
    const ordered = preferred.filter((id) => set.has(id));
    for (const k of keys) {
      if (!ordered.includes(k)) ordered.push(k);
    }
    return ordered;
  }
  return keys.sort();
}

/**
 * Month-end level in portfolio CAD for a benchmark.
 * CAD-native indexes use raw price; USD indexes multiply by USDCAD.
 */
export function benchmarkCadLevel(
  id: string,
  periodId: string,
  prices: BenchmarkFile["prices"],
  currency = DEFAULT_BENCHMARK_META[id]?.currency ?? "CAD",
): number | null {
  const raw = prices[id]?.[periodId];
  if (raw === undefined || !Number.isFinite(raw)) return null;
  if (currency.toUpperCase() === "CAD") return raw;
  const fx = prices.USDCAD?.[periodId];
  if (fx === undefined || !(fx > 0)) return null;
  return raw * fx;
}

/** Monthly simple return of CAD levels between consecutive periods. */
export function benchmarkMonthlyReturn(
  id: string,
  priorPeriodId: string,
  periodId: string,
  prices: BenchmarkFile["prices"],
  currency?: string,
): number | null {
  const ccy = currency ?? DEFAULT_BENCHMARK_META[id]?.currency ?? "CAD";
  const a = benchmarkCadLevel(id, priorPeriodId, prices, ccy);
  const b = benchmarkCadLevel(id, periodId, prices, ccy);
  if (a === null || b === null || !(a > 0)) return null;
  return b / a - 1;
}

/**
 * Cumulative index starting at 1.0 on the first period.
 * values[0] = 1 (base), values[t] = product_{k=1..t}(1+r_k).
 */
export function cumulativeFromMonthlyReturns(
  monthlyReturns: Array<number | null>,
): Array<number | null> {
  if (monthlyReturns.length === 0) return [];
  const out: Array<number | null> = new Array(monthlyReturns.length).fill(null);
  out[0] = 1;
  let growth = 1;
  let started = false;
  for (let i = 1; i < monthlyReturns.length; i++) {
    const r = monthlyReturns[i];
    if (r === null || !Number.isFinite(r)) {
      out[i] = started ? growth : null;
      continue;
    }
    if (!started) {
      started = true;
      if (out[i - 1] === null) out[i - 1] = 1;
      growth = 1;
    }
    growth *= 1 + r;
    out[i] = growth;
  }
  return out;
}

/**
 * Build portfolio vs benchmarks series on the portfolio period axis.
 *
 * - twrr: cumulative growth from monthly returns (no cash-flow matching).
 * - cashflow: dollar path if the same external deposits/withdrawals were
 *   applied to a shadow portfolio that only holds the index
 *   (S_0 = V_0, S_t = S_{t-1}·(1+r_t) + F_t).
 */
export function buildBenchmarkComparison(
  data: PortfolioData,
  bench: BenchmarkFile,
  mode: BenchmarkCompareMode = "twrr",
  benchmarkIds?: string[],
  configs?: BenchmarkConfig[],
): BenchmarkSeries {
  if (mode === "cashflow") {
    return buildCashFlowMatchedComparison(data, bench, benchmarkIds, configs);
  }
  return buildTwrrComparison(data, bench, benchmarkIds, configs);
}

function buildTwrrComparison(
  data: PortfolioData,
  bench: BenchmarkFile,
  benchmarkIds?: string[],
  configs?: BenchmarkConfig[],
): BenchmarkSeries {
  const periods = data.periods;
  const periodIds = periods.map((p) => p.id);
  const labels = periods.map((p) => p.label);
  const pnl = buildMonthlyPnLSeries(data);
  const portfolio = cumulativeFromMonthlyReturns(pnl.twrrMonthly);

  const ids =
    benchmarkIds ??
    listBenchmarkIds(
      bench.prices,
      configs?.map((c) => c.id),
    );
  const benchmarks: BenchmarkSeries["benchmarks"] = {};
  for (const id of ids) {
    const meta = resolveBenchmarkMeta(id, configs);
    const monthly: Array<number | null> = periods.map(() => null);
    for (let i = 1; i < periods.length; i++) {
      monthly[i] = benchmarkMonthlyReturn(
        id,
        periodIds[i - 1],
        periodIds[i],
        bench.prices,
        meta.currency,
      );
    }
    benchmarks[id] = {
      label: meta.label,
      currencyNote: meta.currencyNote,
      values: cumulativeFromMonthlyReturns(monthly),
    };
  }

  return {
    periods: labels,
    periodIds,
    portfolio,
    benchmarks,
    mode: "twrr",
  };
}

/**
 * Shadow index balance with the same external net flows as the real portfolio.
 * S_0 = V_0; S_t = S_{t-1} × (1 + r_t) + F_t where F_t = deposits − withdrawals.
 */
export function cashFlowMatchedLevels(
  data: PortfolioData,
  id: string,
  prices: BenchmarkFile["prices"],
  currency?: string,
): Array<number | null> {
  const periods = data.periods;
  if (periods.length === 0) return [];
  const periodIds = periods.map((p) => p.id);
  const out: Array<number | null> = new Array(periods.length).fill(null);
  const ccy = currency ?? DEFAULT_BENCHMARK_META[id]?.currency ?? "CAD";

  let shadow: number | null = periods[0].totalNetWorth;
  out[0] = shadow;

  for (let i = 1; i < periods.length; i++) {
    const f = externalNetFlow(
      periods[i].cashFlows.deposits,
      periods[i].cashFlows.withdrawals,
    );
    const r = benchmarkMonthlyReturn(
      id,
      periodIds[i - 1],
      periodIds[i],
      prices,
      ccy,
    );
    if (shadow === null) {
      out[i] = null;
      continue;
    }
    if (r === null || !Number.isFinite(r)) {
      shadow = shadow + f;
      out[i] = shadow;
      continue;
    }
    shadow = shadow * (1 + r) + f;
    out[i] = shadow;
  }
  return out;
}

function buildCashFlowMatchedComparison(
  data: PortfolioData,
  bench: BenchmarkFile,
  benchmarkIds?: string[],
  configs?: BenchmarkConfig[],
): BenchmarkSeries {
  const periods = data.periods;
  const labels = periods.map((p) => p.label);
  const periodIds = periods.map((p) => p.id);

  const ids =
    benchmarkIds ??
    listBenchmarkIds(
      bench.prices,
      configs?.map((c) => c.id),
    );
  const benchmarks: BenchmarkSeries["benchmarks"] = {};
  for (const id of ids) {
    const meta = resolveBenchmarkMeta(id, configs);
    benchmarks[id] = {
      label: meta.label,
      currencyNote: meta.currencyNote,
      values: cashFlowMatchedLevels(data, id, bench.prices, meta.currency),
    };
  }

  return {
    periods: labels,
    periodIds,
    portfolio: periods.map((p) => p.totalNetWorth),
    benchmarks,
    mode: "cashflow",
  };
}

/** Portfolio cumulative growth only (same convention as comparison chart). */
export function buildPortfolioCumulativeGrowth(
  data: PortfolioData,
): Array<number | null> {
  const monthly = buildMonthlyPnLSeries(data).twrrMonthly;
  return cumulativeFromMonthlyReturns(monthly);
}

/**
 * Per calendar year: portfolio MWRR vs cash-flow-matched index MWRR.
 */
export interface YearlyCashFlowMatchedRow {
  year: number;
  fromPeriodId: string;
  toPeriodId: string;
  isPartial: boolean;
  portfolioMwrr: number | null;
  /** MWRR per benchmark id (dynamic). */
  byBenchmark: Record<string, number | null>;
  /** Convenience aliases kept for chart/table compatibility. */
  xeqtMwrr?: number | null;
  vooMwrr?: number | null;
  qqqMwrr?: number | null;
}

export function computeYearlyCashFlowMatchedReturns(
  data: PortfolioData,
  bench: BenchmarkFile,
  benchmarkIds?: string[],
  configs?: BenchmarkConfig[],
): YearlyCashFlowMatchedRow[] {
  const periods = data.periods;
  if (periods.length === 0) return [];

  const years = new Set<number>();
  for (const p of periods) {
    const y = yearOfPeriodId(p.id);
    if (y !== null) years.add(y);
  }

  const ids =
    benchmarkIds ??
    listBenchmarkIds(
      bench.prices,
      configs?.map((c) => c.id),
    );
  const portfolioValues = periods.map((p) => p.totalNetWorth as number | null);
  const levelsById: Record<string, Array<number | null>> = {};
  for (const id of ids) {
    const meta = resolveBenchmarkMeta(id, configs);
    levelsById[id] = cashFlowMatchedLevels(
      data,
      id,
      bench.prices,
      meta.currency,
    );
  }

  const rows: YearlyCashFlowMatchedRow[] = [];
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

    const byBenchmark: Record<string, number | null> = {};
    for (const id of ids) {
      byBenchmark[id] = yearlyMwrrForValues(data, year, levelsById[id]);
    }

    rows.push({
      year,
      fromPeriodId,
      toPeriodId,
      isPartial,
      portfolioMwrr: yearlyMwrrForValues(data, year, portfolioValues),
      byBenchmark,
      xeqtMwrr: byBenchmark.XEQT ?? null,
      vooMwrr: byBenchmark.VOO ?? null,
      qqqMwrr: byBenchmark.QQQ ?? null,
    });
  }
  return rows;
}

export { monthlyTwrr };
