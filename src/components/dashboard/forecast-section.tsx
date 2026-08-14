"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { ChartSection } from "@/components/dashboard/chart-section";
import {
  COMPOUNDING_OPTIONS,
  CONTRIBUTION_FREQUENCY_OPTIONS,
  buildForecastProjection,
  decimalToPercent,
  percentToDecimal,
  type CompoundingFrequency,
  type ContributionFrequency,
} from "@/lib/forecast";
import { computeReturnStats } from "@/lib/performance";
import { latestPeriod } from "@/lib/series";
import type { PortfolioData } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ForecastSectionProps {
  data: PortfolioData;
  currency: string;
}

function todayMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function fieldClassName() {
  return cn(
    "border-input bg-background ring-offset-background placeholder:text-muted-foreground",
    "focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs",
    "focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-50",
  );
}

function Label({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-muted-foreground text-xs font-medium tracking-wide"
    >
      {children}
    </label>
  );
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Customizable multi-scenario investment forecast.
 * All projection math goes through buildForecastProjection (pure).
 */
export function ForecastSection({ data, currency }: ForecastSectionProps) {
  const defaults = useMemo(() => {
    const latest = latestPeriod(data);
    const stats = computeReturnStats(data);
    const principal = latest?.totalNetWorth ?? 0;
    const histDecimal =
      stats.cagr != null && Number.isFinite(stats.cagr) ? stats.cagr : null;
    const startFromData = latest?.id ?? todayMonth();
    return {
      principal,
      historicalPct:
        histDecimal != null
          ? Math.round(decimalToPercent(histDecimal) * 10) / 10
          : 7,
      startDate: startFromData.length === 7 ? startFromData : todayMonth(),
    };
  }, [data]);

  const [principal, setPrincipal] = useState(String(Math.round(defaults.principal)));
  const [contributionAmount, setContributionAmount] = useState("500");
  const [frequency, setFrequency] =
    useState<ContributionFrequency>("monthly");
  const [compounding, setCompounding] =
    useState<CompoundingFrequency>("monthly");
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState("");
  const [horizonYears, setHorizonYears] = useState("20");
  const [useEndDate, setUseEndDate] = useState(false);
  const [minPct, setMinPct] = useState("3");
  const [expectedPct, setExpectedPct] = useState("7");
  const [maxPct, setMaxPct] = useState("12");
  const [historicalPct, setHistoricalPct] = useState(
    String(defaults.historicalPct),
  );
  const [includeHistorical, setIncludeHistorical] = useState(true);

  const series = useMemo(() => {
    const p = Number(principal);
    const amt = Number(contributionAmount);
    const min = Number(minPct);
    const exp = Number(expectedPct);
    const max = Number(maxPct);
    const hist = Number(historicalPct);
    const horizon = Number(horizonYears);

    return buildForecastProjection({
      principal: Number.isFinite(p) && p >= 0 ? p : 0,
      contributionAmount: Number.isFinite(amt) && amt > 0 ? amt : 0,
      contributionFrequency: frequency,
      startDate: startDate || todayMonth(),
      endDate: useEndDate && endDate.trim() ? endDate.trim() : null,
      horizonYears:
        Number.isFinite(horizon) && horizon > 0 ? horizon : 20,
      compounding,
      rates: {
        min: percentToDecimal(Number.isFinite(min) ? min : 0),
        expected: percentToDecimal(Number.isFinite(exp) ? exp : 0),
        max: percentToDecimal(Number.isFinite(max) ? max : 0),
        historical:
          includeHistorical && Number.isFinite(hist)
            ? percentToDecimal(hist)
            : null,
      },
    });
  }, [
    principal,
    contributionAmount,
    frequency,
    startDate,
    endDate,
    useEndDate,
    horizonYears,
    compounding,
    minPct,
    expectedPct,
    maxPct,
    historicalPct,
    includeHistorical,
  ]);

  return (
    <ChartSection
      title="Forecast"
      description="Project portfolio value under custom contributions and annual return scenarios (min / expected / max / historical). Deterministic compound growth — not a Monte Carlo simulation."
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="fc-principal">Starting principal</Label>
            <input
              id="fc-principal"
              type="number"
              min={0}
              step={100}
              className={fieldClassName()}
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              aria-label="Starting principal"
            />
            <p className="text-muted-foreground text-[11px]">
              Default: latest portfolio value ({formatMoney(defaults.principal, currency)})
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-contrib">Contribution amount</Label>
            <input
              id="fc-contrib"
              type="number"
              min={0}
              step={50}
              className={fieldClassName()}
              value={contributionAmount}
              onChange={(e) => setContributionAmount(e.target.value)}
              aria-label="Contribution amount per event"
              disabled={frequency === "none"}
            />
            <p className="text-muted-foreground text-[11px]">
              Per contribution event (not annual total)
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-freq">Contribution frequency</Label>
            <select
              id="fc-freq"
              className={fieldClassName()}
              value={frequency}
              onChange={(e) =>
                setFrequency(e.target.value as ContributionFrequency)
              }
              aria-label="Contribution frequency"
            >
              {CONTRIBUTION_FREQUENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-compound">Compounding</Label>
            <select
              id="fc-compound"
              className={fieldClassName()}
              value={compounding}
              onChange={(e) =>
                setCompounding(e.target.value as CompoundingFrequency)
              }
              aria-label="Compounding frequency"
            >
              {COMPOUNDING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-start">Start date</Label>
            <input
              id="fc-start"
              type="month"
              className={fieldClassName()}
              value={startDate.slice(0, 7)}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="Forecast start date"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="fc-end">End date</Label>
              <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={useEndDate}
                  onChange={(e) => setUseEndDate(e.target.checked)}
                  className="size-3.5 rounded border"
                />
                Use end date
              </label>
            </div>
            <input
              id="fc-end"
              type="month"
              className={fieldClassName()}
              value={endDate.slice(0, 7)}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!useEndDate}
              aria-label="Forecast end date"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-horizon">Horizon (years)</Label>
            <input
              id="fc-horizon"
              type="number"
              min={0.5}
              max={100}
              step={0.5}
              className={fieldClassName()}
              value={horizonYears}
              onChange={(e) => setHorizonYears(e.target.value)}
              disabled={useEndDate}
              aria-label="Forecast horizon in years when no end date"
            />
            <p className="text-muted-foreground text-[11px]">
              Used when end date is off (open-ended)
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-min">Min annual return %</Label>
            <input
              id="fc-min"
              type="number"
              step={0.1}
              className={fieldClassName()}
              value={minPct}
              onChange={(e) => setMinPct(e.target.value)}
              aria-label="Minimum annual return percent"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-exp">Expected annual return %</Label>
            <input
              id="fc-exp"
              type="number"
              step={0.1}
              className={fieldClassName()}
              value={expectedPct}
              onChange={(e) => setExpectedPct(e.target.value)}
              aria-label="Expected annual return percent"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-max">Max annual return %</Label>
            <input
              id="fc-max"
              type="number"
              step={0.1}
              className={fieldClassName()}
              value={maxPct}
              onChange={(e) => setMaxPct(e.target.value)}
              aria-label="Maximum annual return percent"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="fc-hist">Historical annual return %</Label>
              <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  checked={includeHistorical}
                  onChange={(e) => setIncludeHistorical(e.target.checked)}
                  className="size-3.5 rounded border"
                />
                Show path
              </label>
            </div>
            <input
              id="fc-hist"
              type="number"
              step={0.1}
              className={fieldClassName()}
              value={historicalPct}
              onChange={(e) => setHistoricalPct(e.target.value)}
              disabled={!includeHistorical}
              aria-label="Historical annual return percent"
            />
            <p className="text-muted-foreground text-[11px]">
              Default from portfolio CAGR (
              {defaults.historicalPct.toFixed(1)}%) when available
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Horizon"
            value={`${series.years.toFixed(series.years % 1 === 0 ? 0 : 1)} years`}
          />
          <SummaryCard
            label="Total contributions"
            value={formatMoney(series.totalContributions, currency)}
          />
          <SummaryCard
            label="Expected terminal"
            value={formatMoney(series.terminal.expected, currency)}
          />
          <SummaryCard
            label="Range (min – max)"
            value={`${formatMoney(series.terminal.min, currency)} – ${formatMoney(series.terminal.max, currency)}`}
          />
        </div>

        <ForecastChart series={series} currency={currency} />

        <p className="text-muted-foreground text-xs leading-relaxed">
          Contributions are applied at the end of each contribution period;
          returns compound at the selected compounding frequency. Historical is
          your portfolio&apos;s annualized TWRR/CAGR when computable (editable).
          This is a planning tool, not a guarantee of future results.
        </p>
      </div>
    </ChartSection>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded-lg border px-3 py-2.5">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}
