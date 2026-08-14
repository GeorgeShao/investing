"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { EChartsWrapper } from "@/components/charts/echarts-wrapper";
import type { ForecastSeries } from "@/lib/forecast";

export interface ForecastChartProps {
  series: ForecastSeries;
  currency?: string;
  height?: number;
  /** Legend / series name for the optional what-if path. */
  historicalLabel?: string;
}

const COLORS = {
  min: "#94a3b8",
  expected: "#0f172a",
  max: "#6366f1",
  historical: "#f59e0b",
};

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function buildOption(
  series: ForecastSeries,
  currency: string,
  historicalLabel: string,
): EChartsOption {
  const labels = series.points.map((p) => p.label);
  const hasHistorical = series.points.some(
    (p) => p.historical != null && Number.isFinite(p.historical),
  );

  const line = (
    name: string,
    data: Array<number | null>,
    color: string,
    width = 2,
    dashed = false,
  ) => ({
    name,
    type: "line" as const,
    data,
    showSymbol: series.points.length <= 24,
    symbolSize: 6,
    smooth: false,
    lineStyle: {
      width,
      color,
      type: dashed ? ("dashed" as const) : ("solid" as const),
    },
    itemStyle: { color },
    connectNulls: false,
  });

  const seriesList = [
    line(
      "Min",
      series.points.map((p) => p.min),
      COLORS.min,
      1.5,
      true,
    ),
    line(
      "Expected",
      series.points.map((p) => p.expected),
      COLORS.expected,
      2.5,
    ),
    line(
      "Max",
      series.points.map((p) => p.max),
      COLORS.max,
      1.5,
      true,
    ),
  ];
  if (hasHistorical) {
    seriesList.push(
      line(
        historicalLabel,
        series.points.map((p) => p.historical),
        COLORS.historical,
        2,
      ),
    );
  }

  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" && Number.isFinite(value)
          ? formatMoney(value, currency)
          : "—",
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
      data: labels,
      axisLabel: {
        rotate: labels.length > 14 ? 40 : 0,
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
          new Intl.NumberFormat("en-CA", {
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(v),
      },
      splitLine: { lineStyle: { color: "#e2e8f0", type: "dashed" } },
    },
    series: seriesList,
  };
}

export function ForecastChart({
  series,
  currency = "CAD",
  height = 400,
  historicalLabel = "Your holdings",
}: ForecastChartProps) {
  const option = useMemo(
    () => buildOption(series, currency, historicalLabel),
    [series, currency, historicalLabel],
  );

  if (series.points.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        Adjust the horizon or rates to project portfolio value.
      </p>
    );
  }

  return (
    <EChartsWrapper
      option={option}
      height={height}
      ariaLabel="Investment forecast min expected max and what-if scenarios"
    />
  );
}
