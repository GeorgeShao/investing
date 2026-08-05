"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { EChartsWrapper } from "@/components/charts/echarts-wrapper";
import type { NetWorthSeries } from "@/lib/types";

export interface NetWorthChartProps {
  series: NetWorthSeries;
  currency?: string;
  height?: number;
}

function buildOption(series: NetWorthSeries, currency: string): EChartsOption {
  const stackSeries = series.accounts.map((account) => ({
    name: account.name,
    type: "bar" as const,
    stack: "networth",
    emphasis: { focus: "series" as const },
    itemStyle: { color: account.color, borderRadius: [0, 0, 0, 0] },
    data: account.values,
    barMaxWidth: 42,
  }));

  return {
    color: series.accounts.map((a) => a.color),
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (value) =>
        typeof value === "number"
          ? new Intl.NumberFormat("en-CA", {
              style: "currency",
              currency,
              maximumFractionDigits: 0,
            }).format(value)
          : String(value ?? ""),
    },
    legend: {
      top: 0,
      textStyle: { color: "#64748b" },
    },
    grid: {
      left: 16,
      right: 16,
      top: 88,
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
          new Intl.NumberFormat("en-CA", {
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(v),
      },
      splitLine: { lineStyle: { color: "#e2e8f0", type: "dashed" } },
    },
    series: [
      ...stackSeries,
      {
        name: "Total net worth",
        type: "line",
        data: series.totals,
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        z: 10,
        itemStyle: { color: "#0f172a" },
        lineStyle: { width: 2.5, color: "#0f172a" },
        emphasis: { focus: "series" },
      },
    ],
  };
}

export function NetWorthChart({
  series,
  currency = "CAD",
  height = 400,
}: NetWorthChartProps) {
  const option = useMemo(
    () => buildOption(series, currency),
    [series, currency],
  );

  return (
    <EChartsWrapper
      option={option}
      height={height}
      ariaLabel="Net worth over time stacked by account"
    />
  );
}
