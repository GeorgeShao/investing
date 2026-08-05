"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChartsWrapper } from "@/components/charts/echarts-wrapper";
import { Button } from "@/components/ui/button";
import type { MonthlyPnLSeries } from "@/lib/performance";
import { cn } from "@/lib/utils";

export type MonthlyPnLMode = "dollar" | "percent";

export interface MonthlyPnLChartProps {
  series: MonthlyPnLSeries;
  currency?: string;
  height?: number;
}

function buildOption(
  series: MonthlyPnLSeries,
  currency: string,
  mode: MonthlyPnLMode,
): EChartsOption {
  const raw =
    mode === "dollar"
      ? series.pnl
      : series.twrrMonthly.map((v) =>
          v === null || !Number.isFinite(v) ? null : v * 100,
        );

  const formatValue = (value: unknown) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    if (mode === "percent") {
      return `${value.toFixed(1)}%`;
    }
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: formatValue,
    },
    grid: {
      left: 16,
      right: 16,
      top: 24,
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
      axisLabel: {
        color: "#64748b",
        formatter: (v: number) =>
          mode === "percent"
            ? `${v.toFixed(0)}%`
            : new Intl.NumberFormat("en-CA", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(v),
      },
      splitLine: { lineStyle: { color: "#e2e8f0", type: "dashed" } },
    },
    series: [
      {
        name: mode === "dollar" ? "Monthly P&L ($)" : "Monthly return (%)",
        type: "bar",
        data: raw.map((v) =>
          v === null
            ? null
            : {
                value: v,
                itemStyle: {
                  color: v >= 0 ? "#22c55e" : "#ef4444",
                  borderRadius: v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
                },
              },
        ),
        barMaxWidth: 28,
      },
    ],
  };
}

export function MonthlyPnLChart({
  series,
  currency = "CAD",
  height = 380,
}: MonthlyPnLChartProps) {
  const [mode, setMode] = useState<MonthlyPnLMode>("dollar");

  const option = useMemo(
    () => buildOption(series, currency, mode),
    [series, currency, mode],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div
          className="bg-muted inline-flex rounded-lg p-0.5"
          role="group"
          aria-label="Monthly P&L unit"
        >
          <Button
            type="button"
            size="sm"
            variant={mode === "dollar" ? "default" : "ghost"}
            className={cn(
              "h-7 min-w-12 px-3",
              mode !== "dollar" && "text-muted-foreground",
            )}
            onClick={() => setMode("dollar")}
            aria-pressed={mode === "dollar"}
          >
            $
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "percent" ? "default" : "ghost"}
            className={cn(
              "h-7 min-w-12 px-3",
              mode !== "percent" && "text-muted-foreground",
            )}
            onClick={() => setMode("percent")}
            aria-pressed={mode === "percent"}
          >
            %
          </Button>
        </div>
      </div>
      <EChartsWrapper
        option={option}
        height={height}
        ariaLabel={
          mode === "dollar"
            ? "Monthly portfolio profit and loss in dollars"
            : "Monthly portfolio percent return"
        }
      />
      <p className="text-muted-foreground text-xs">
        {mode === "dollar"
          ? "Dollar P&L: Δ net worth − external deposits + withdrawals."
          : "Percent return: monthly TWRR (V_t − F_t) / V_{t−1} − 1. Months with zero prior net worth are blank."}
      </p>
    </div>
  );
}
