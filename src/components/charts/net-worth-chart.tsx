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

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
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
      // Stacked accounts + total net worth (no separate total line on the chart).
      formatter: (raw) => {
        type TipItem = {
          dataIndex?: number;
          axisValueLabel?: string | number;
          axisValue?: string | number;
          data?: unknown;
          value?: unknown;
          color?: string;
          seriesName?: string;
        };
        const items = (Array.isArray(raw) ? raw : [raw]) as TipItem[];
        if (items.length === 0) return "";
        const axisLabel = String(
          items[0]?.axisValueLabel ?? items[0]?.axisValue ?? "",
        );
        const idx =
          typeof items[0]?.dataIndex === "number" ? items[0].dataIndex : 0;
        const lines: string[] = [
          `<div style="font-weight:600;margin-bottom:4px">${axisLabel}</div>`,
        ];
        for (const item of items) {
          const rawVal = item.data ?? item.value;
          const value = typeof rawVal === "number" ? rawVal : Number(rawVal);
          if (!Number.isFinite(value)) continue;
          const color = typeof item.color === "string" ? item.color : "#94a3b8";
          const name = item.seriesName ?? "";
          lines.push(
            `<div style="display:flex;align-items:center;gap:6px;line-height:1.5">` +
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>` +
              `<span style="flex:1">${name}</span>` +
              `<span style="font-variant-numeric:tabular-nums">${formatMoney(value, currency)}</span>` +
              `</div>`,
          );
        }
        const total = series.totals[idx];
        if (typeof total === "number" && Number.isFinite(total)) {
          lines.push(
            `<div style="display:flex;align-items:center;gap:6px;line-height:1.5;margin-top:4px;padding-top:4px;border-top:1px solid #e2e8f0">` +
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#0f172a"></span>` +
              `<span style="flex:1;font-weight:600">Total net worth</span>` +
              `<span style="font-variant-numeric:tabular-nums;font-weight:600">${formatMoney(total, currency)}</span>` +
              `</div>`,
          );
        }
        return lines.join("");
      },
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
    series: stackSeries,
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
