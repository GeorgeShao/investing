"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChartsWrapper } from "@/components/charts/echarts-wrapper";
import { Button } from "@/components/ui/button";
import type { BenchmarkConfig } from "@/lib/config";
import {
  buildBenchmarkComparison,
  computeYearlyCashFlowMatchedReturns,
  listBenchmarkIds,
  type BenchmarkCompareMode,
  type BenchmarkFile,
  type BenchmarkSeries,
  type YearlyCashFlowMatchedRow,
} from "@/lib/benchmarks";
import { formatPercent } from "@/lib/performance";
import type { PortfolioData } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface BenchmarkChartProps {
  data: PortfolioData;
  benchmarks: BenchmarkFile;
  currency?: string;
  height?: number;
  benchmarkConfigs?: BenchmarkConfig[];
}

const PORTFOLIO_COLOR = "#0f172a";
const BENCH_PALETTE = [
  "#6366f1",
  "#f59e0b",
  "#06b6d4",
  "#22c55e",
  "#ec4899",
  "#8b5cf6",
  "#ef4444",
  "#84cc16",
];

function colorForBenchmark(id: string, index: number): string {
  const defaults: Record<string, string> = {
    XEQT: "#6366f1",
    VOO: "#f59e0b",
    QQQ: "#06b6d4",
  };
  return defaults[id] ?? BENCH_PALETTE[index % BENCH_PALETTE.length];
}

function buildOption(
  series: BenchmarkSeries,
  mode: BenchmarkCompareMode,
  currency: string,
): EChartsOption {
  const line = (
    name: string,
    data: Array<number | null>,
    color: string,
    width = 2,
  ) => ({
    name,
    type: "line" as const,
    data,
    showSymbol: false,
    smooth: false,
    lineStyle: { width, color },
    itemStyle: { color },
    connectNulls: false,
  });

  const isCash = mode === "cashflow";
  const benchSeries = Object.entries(series.benchmarks).map(
    ([id, b], index) =>
      line(b.label, b.values, colorForBenchmark(id, index)),
  );

  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => {
        if (typeof value !== "number" || !Number.isFinite(value)) return "—";
        if (isCash) {
          return new Intl.NumberFormat("en-CA", {
            style: "currency",
            currency,
            maximumFractionDigits: 0,
          }).format(value);
        }
        return `${(value * 100).toFixed(1)}% of start`;
      },
    },
    legend: {
      top: 0,
      textStyle: { color: "#64748b" },
    },
    grid: {
      left: 16,
      right: 16,
      top: 48,
      bottom: 8,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: series.periods,
      axisLabel: {
        rotate: series.periods.length > 12 ? 40 : 0,
        color: "#64748b",
        fontSize: 11,
      },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: {
        color: "#64748b",
        formatter: (v: number) =>
          isCash
            ? new Intl.NumberFormat("en-CA", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(v)
            : `${(v * 100).toFixed(0)}%`,
      },
      splitLine: { lineStyle: { color: "#e2e8f0", type: "dashed" } },
    },
    series: [
      line(
        isCash ? "Portfolio (CAD)" : "Portfolio (TWRR)",
        series.portfolio,
        PORTFOLIO_COLOR,
        2.5,
      ),
      ...benchSeries,
    ],
  };
}

export function BenchmarkChart({
  data,
  benchmarks,
  currency = "CAD",
  height = 400,
  benchmarkConfigs,
}: BenchmarkChartProps) {
  const [mode, setMode] = useState<BenchmarkCompareMode>("twrr");

  const preferredIds = benchmarkConfigs?.map((c) => c.id);
  const ids = useMemo(
    () => listBenchmarkIds(benchmarks.prices, preferredIds),
    [benchmarks.prices, preferredIds],
  );

  const series = useMemo(
    () =>
      buildBenchmarkComparison(
        data,
        benchmarks,
        mode,
        ids,
        benchmarkConfigs,
      ),
    [data, benchmarks, mode, ids, benchmarkConfigs],
  );

  const yearlyMatched = useMemo(
    () =>
      computeYearlyCashFlowMatchedReturns(
        data,
        benchmarks,
        ids,
        benchmarkConfigs,
      ),
    [data, benchmarks, ids, benchmarkConfigs],
  );

  const option = useMemo(
    () => buildOption(series, mode, currency),
    [series, mode, currency],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div
            className="bg-muted inline-flex rounded-lg p-0.5"
            role="group"
            aria-label="Benchmark comparison mode"
          >
            <Button
              type="button"
              size="sm"
              variant={mode === "twrr" ? "default" : "ghost"}
              className={cn(
                "h-7 px-2.5 text-xs sm:px-3",
                mode !== "twrr" && "text-muted-foreground",
              )}
              onClick={() => setMode("twrr")}
              aria-pressed={mode === "twrr"}
            >
              Time-weighted
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "cashflow" ? "default" : "ghost"}
              className={cn(
                "h-7 px-2.5 text-xs sm:px-3",
                mode !== "cashflow" && "text-muted-foreground",
              )}
              onClick={() => setMode("cashflow")}
              aria-pressed={mode === "cashflow"}
            >
              Same cash flows
            </Button>
          </div>
        </div>
        <EChartsWrapper
          option={option}
          height={height}
          ariaLabel={
            mode === "twrr"
              ? "Portfolio time-weighted growth versus benchmarks"
              : "Portfolio value versus cash-flow matched benchmark portfolios"
          }
        />
        <p className="text-muted-foreground text-xs leading-relaxed">
          {mode === "twrr"
            ? "Time-weighted: each line is pure growth of $1 left invested (portfolio TWRR vs index price returns). Deposits and withdrawals do not change the shape beyond what you held."
            : "Same cash flows: index lines start with your opening net worth, then each month grow with the index return and apply your external deposits (−withdrawals). Answers “what if I put the same money into the index on the same dates?”"}
        </p>
      </div>

      <YearlyCashFlowMatchedTable rows={yearlyMatched} ids={ids} />
    </div>
  );
}

function YearlyCashFlowMatchedTable({
  rows,
  ids,
}: {
  rows: YearlyCashFlowMatchedRow[];
  ids: string[];
}) {
  if (rows.length === 0) return null;
  const columns = ids.length > 0 ? ids : ["XEQT", "VOO", "QQQ"];
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">By calendar year (same cash flows)</p>
      <p className="text-muted-foreground text-xs">
        Money-weighted return for the year: your portfolio vs putting the same
        external deposits/withdrawals into each index.
      </p>
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="bg-muted/50 border-b text-left">
              <th className="text-muted-foreground px-3 py-2 font-medium">
                Year
              </th>
              <th className="text-muted-foreground px-3 py-2 font-medium">
                Portfolio
              </th>
              {columns.map((id) => (
                <th
                  key={id}
                  className="text-muted-foreground px-3 py-2 font-medium"
                >
                  {id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.year}
                className="border-border border-b last:border-0"
              >
                <td className="px-3 py-2 tabular-nums">
                  {row.year}
                  {row.isPartial ? (
                    <span className="text-muted-foreground ml-1 text-xs">
                      (partial)
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatPercent(row.portfolioMwrr)}
                </td>
                {columns.map((id) => (
                  <td key={id} className="px-3 py-2 tabular-nums">
                    {formatPercent(
                      row.byBenchmark?.[id] ??
                        (id === "XEQT"
                          ? row.xeqtMwrr
                          : id === "VOO"
                            ? row.vooMwrr
                            : id === "QQQ"
                              ? row.qqqMwrr
                              : null) ??
                        null,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
