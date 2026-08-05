"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { EChartsWrapper } from "@/components/charts/echarts-wrapper";
import type { CashFlowSeries } from "@/lib/types";

export interface CashFlowChartProps {
  series: CashFlowSeries;
  currency?: string;
  height?: number;
}

function buildOption(series: CashFlowSeries, currency: string): EChartsOption {
  const money = (value: unknown) =>
    typeof value === "number"
      ? new Intl.NumberFormat("en-CA", {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(value)
      : String(value ?? "");

  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: money,
    },
    legend: {
      top: 0,
      data: ["Deposits", "Withdrawals", "Net flow"],
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
      {
        name: "Deposits",
        type: "bar",
        data: series.deposits,
        barMaxWidth: 28,
        itemStyle: { color: "#22c55e", borderRadius: [4, 4, 0, 0] },
        emphasis: { focus: "series" },
      },
      {
        name: "Withdrawals",
        type: "bar",
        data: series.withdrawals,
        barMaxWidth: 28,
        itemStyle: { color: "#ef4444", borderRadius: [4, 4, 0, 0] },
        emphasis: { focus: "series" },
      },
      {
        name: "Net flow",
        type: "line",
        data: series.net,
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        itemStyle: { color: "#6366f1" },
        lineStyle: { width: 2, color: "#6366f1" },
        emphasis: { focus: "series" },
      },
    ],
  };
}

export function CashFlowChart({
  series,
  currency = "CAD",
  height = 400,
}: CashFlowChartProps) {
  const option = useMemo(
    () => buildOption(series, currency),
    [series, currency],
  );

  return (
    <EChartsWrapper
      option={option}
      height={height}
      ariaLabel="Net cash flows over time: deposits versus withdrawals"
    />
  );
}
