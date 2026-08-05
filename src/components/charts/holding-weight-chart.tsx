"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChartsWrapper } from "@/components/charts/echarts-wrapper";
import { Button } from "@/components/ui/button";
import {
  buildHoldingWeightSeries,
  type HoldingWeightMode,
} from "@/lib/series";
import type { HoldingWeightSeries, PortfolioData } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface HoldingWeightChartProps {
  data: PortfolioData;
  height?: number;
}

const MODE_COPY: Record<
  HoldingWeightMode,
  { label: string; aria: string; footnote: string }
> = {
  assetMix: {
    label: "Asset mix",
    aria: "Share of holdings and cash (always 100%)",
    footnote:
      "Each segment is that instrument’s share of parsed securities + cash that month. Bars always total 100% (composition of known assets, not equity).",
  },
  equity: {
    label: "% of equity",
    aria: "Share of portfolio net worth (may exceed 100%)",
    footnote:
      "Each segment is market value ÷ month-end net worth (all accounts, CAD). Stacks can exceed 100% when positions are larger than equity (margin / leverage), or fall short when cash/positions are incomplete.",
  },
};

function buildOption(
  series: HoldingWeightSeries,
  mode: HoldingWeightMode,
): EChartsOption {
  const barSeries = series.instruments.map((inst) => ({
    name: inst.name,
    type: "bar" as const,
    stack: "weights",
    data: inst.weights,
    barMaxWidth: 42,
    itemStyle: { color: inst.color },
    emphasis: { focus: "series" as const },
  }));

  return {
    color: series.instruments.map((i) => i.color),
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      confine: true,
      // Only list instruments held that month (skip 0% stack segments).
      formatter: (raw) => {
        type TipItem = {
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
        const lines: string[] = [
          `<div style="font-weight:600;margin-bottom:4px">${axisLabel}</div>`,
        ];
        let shown = 0;
        for (const item of items) {
          const rawVal = item.data ?? item.value;
          const value = typeof rawVal === "number" ? rawVal : Number(rawVal);
          if (!Number.isFinite(value) || value === 0) continue;
          const color = typeof item.color === "string" ? item.color : "#94a3b8";
          const name = item.seriesName ?? "";
          const pct = `${(value * 100).toFixed(1)}%`;
          lines.push(
            `<div style="display:flex;align-items:center;gap:6px;line-height:1.5">` +
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>` +
              `<span style="flex:1">${name}</span>` +
              `<span style="font-variant-numeric:tabular-nums">${pct}</span>` +
              `</div>`,
          );
          shown += 1;
        }
        if (shown === 0) {
          lines.push(
            `<div style="color:#64748b">No holdings parsed for this month</div>`,
          );
        }
        return lines.join("");
      },
    },
    legend: {
      type: "scroll",
      top: 0,
      textStyle: { color: "#64748b", fontSize: 11 },
      pageIconColor: "#64748b",
      pageTextStyle: { color: "#64748b" },
    },
    grid: {
      left: 16,
      right: 16,
      top: 72,
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
      min: 0,
      // Asset mix is always ≤100%; equity mode can exceed 100% with margin.
      max: mode === "assetMix" ? 1 : undefined,
      axisLabel: {
        color: "#64748b",
        formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
      },
      splitLine: { lineStyle: { color: "#e2e8f0", type: "dashed" } },
    },
    series: barSeries,
  };
}

export function HoldingWeightChart({
  data,
  height = 420,
}: HoldingWeightChartProps) {
  // Default to composition view (always 100%); equity mode shows leverage.
  const [mode, setMode] = useState<HoldingWeightMode>("assetMix");

  const series = useMemo(
    () => buildHoldingWeightSeries(data, mode),
    [data, mode],
  );

  const option = useMemo(() => buildOption(series, mode), [series, mode]);

  if (series.instruments.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        No holdings extracted for this window. Re-run PDF extraction or check
        statement coverage.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div
          className="bg-muted inline-flex rounded-lg p-0.5"
          role="group"
          aria-label="Position weight mode"
        >
          {(["assetMix", "equity"] as const).map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={mode === m ? "default" : "ghost"}
              className={cn(
                "h-7 px-2.5 text-xs sm:px-3",
                mode !== m && "text-muted-foreground",
              )}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              title={MODE_COPY[m].aria}
            >
              {MODE_COPY[m].label}
            </Button>
          ))}
        </div>
      </div>
      <EChartsWrapper
        option={option}
        height={height}
        ariaLabel={`Position weights over time (${MODE_COPY[mode].label})`}
      />
      <p className="text-muted-foreground text-xs leading-relaxed">
        {MODE_COPY[mode].footnote} Cash is slate at the base of each bar. Same
        ticker across accounts is combined.
      </p>
    </div>
  );
}
