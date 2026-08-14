"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { ChartSection } from "@/components/dashboard/chart-section";
import { Button } from "@/components/ui/button";
import type { BenchmarkConfig, ChartStartWindow } from "@/lib/config";
import {
  computeOpponentComparison,
  listBenchmarkIds,
  pickDefaultOpponentId,
  type BenchmarkFile,
} from "@/lib/benchmarks";
import {
  CONTRIBUTION_FREQUENCY_OPTIONS,
  HORIZON_YEAR_OPTIONS,
  PLANNING_ANNUAL_RETURN_PCT,
  buildForecastProjection,
  percentToDecimal,
  ratePercentFromDecimal,
  typicalMonthlyDeposits,
  type ContributionFrequency,
} from "@/lib/forecast";
import { computeReturnStats } from "@/lib/performance";
import { latestPeriod, sliceFromPeriodId } from "@/lib/series";
import type { PortfolioData } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ForecastSectionProps {
  data: PortfolioData;
  currency: string;
  benchmarks: BenchmarkFile;
  benchmarkConfigs: BenchmarkConfig[];
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
}

type RatePreset = "holdings" | "opponent" | "planning" | "custom";

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

function formatRateChip(pct: number): string {
  const abs = Math.abs(pct).toFixed(1);
  return pct < 0 ? `−${abs}%` : `${abs}%`;
}

/** Keep the field tied to a computed default until the user edits it. */
function useSyncedDefault(defaultValue: string): [string, (v: string) => void] {
  const [override, setOverride] = useState<string | null>(null);
  return [override ?? defaultValue, setOverride];
}

/**
 * Customizable multi-scenario investment forecast.
 * All projection math goes through buildForecastProjection (pure).
 */
export function ForecastSection({
  data,
  currency,
  benchmarks,
  benchmarkConfigs,
  chartStartWindows,
  defaultChartStart,
}: ForecastSectionProps) {
  const windowStart =
    chartStartWindows.find((w) => w.id === defaultChartStart)?.id ??
    chartStartWindows[0]?.id ??
    data.periods[0]?.id ??
    "";
  const windowLabel =
    chartStartWindows.find((w) => w.id === windowStart)?.label ?? windowStart;

  const defaults = useMemo(() => {
    const latest = latestPeriod(data);
    const principal = latest?.totalNetWorth ?? 0;
    const windowed = windowStart
      ? sliceFromPeriodId(data, windowStart)
      : data;
    const youStats = computeReturnStats(windowed);
    const preferredIds = benchmarkConfigs.map((c) => c.id);
    const ids = listBenchmarkIds(benchmarks.prices, preferredIds);
    const opponentId = pickDefaultOpponentId(ids);
    const comparison =
      ids.length > 0 && windowed.periods.length >= 2
        ? computeOpponentComparison(
            windowed,
            benchmarks,
            opponentId,
            benchmarkConfigs,
          )
        : null;
    const holdingsPct = ratePercentFromDecimal(youStats.cagr);
    const opponentPct = ratePercentFromDecimal(
      comparison?.headline.opponentHoldingsAnn ?? null,
    );
    const lookback = data.periods.slice(-12).map((p) => p.cashFlows.deposits);
    const contrib = typicalMonthlyDeposits(lookback);
    const startFromData = latest?.id ?? todayMonth();
    return {
      principal,
      principalText: String(Math.round(principal)),
      holdingsPct,
      opponentPct,
      opponentLabel: comparison?.headline.opponentLabel ?? opponentId,
      contributionAmount: String(contrib.amount),
      droppedOutlier: contrib.droppedOutlier,
      startDate: startFromData.length === 7 ? startFromData : todayMonth(),
      windowLabel,
    };
  }, [data, windowStart, windowLabel, benchmarks, benchmarkConfigs]);

  const [principal, setPrincipal] = useSyncedDefault(defaults.principalText);
  const [contributionAmount, setContributionAmount] = useSyncedDefault(
    defaults.contributionAmount,
  );
  const [frequency, setFrequency] =
    useState<ContributionFrequency>("monthly");
  const [startDate, setStartDate] = useSyncedDefault(defaults.startDate);
  const [endDate, setEndDate] = useState("");
  const [horizonYears, setHorizonYears] = useState("20");
  const [useEndDate, setUseEndDate] = useState(false);
  const [minPct, setMinPct] = useState("3");
  const [expectedPct, setExpectedPct] = useState(
    String(PLANNING_ANNUAL_RETURN_PCT),
  );
  const [maxPct, setMaxPct] = useState("12");
  const [includeHistorical, setIncludeHistorical] = useState(true);
  const [ratePreset, setRatePreset] = useState<RatePreset>(
    defaults.holdingsPct != null ? "holdings" : "planning",
  );
  const [customHistoricalPct, setCustomHistoricalPct] = useState(
    String(
      defaults.holdingsPct ?? PLANNING_ANNUAL_RETURN_PCT,
    ),
  );

  const historicalPct = useMemo(() => {
    if (ratePreset === "holdings" && defaults.holdingsPct != null) {
      return String(defaults.holdingsPct);
    }
    if (ratePreset === "opponent" && defaults.opponentPct != null) {
      return String(defaults.opponentPct);
    }
    if (ratePreset === "planning") {
      return String(PLANNING_ANNUAL_RETURN_PCT);
    }
    return customHistoricalPct;
  }, [ratePreset, defaults.holdingsPct, defaults.opponentPct, customHistoricalPct]);

  const pathLabel = useMemo(() => {
    if (ratePreset === "holdings") return "Your holdings";
    if (ratePreset === "opponent") return defaults.opponentLabel;
    if (ratePreset === "planning") return "7% planning";
    return "Custom rate";
  }, [ratePreset, defaults.opponentLabel]);

  const pathHint = useMemo(() => {
    if (ratePreset === "holdings") {
      return `If your holdings keep returning like they have since ${defaults.windowLabel}.`;
    }
    if (ratePreset === "opponent") {
      return `If ${defaults.opponentLabel} keeps returning like it has since ${defaults.windowLabel}. Recent realized is not a 20-year expected.`;
    }
    if (ratePreset === "planning") {
      return "Long-run planning rate. Same as the expected path.";
    }
    return "Your own going-forward rate.";
  }, [ratePreset, defaults.windowLabel, defaults.opponentLabel]);

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
      compounding: "monthly",
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
    minPct,
    expectedPct,
    maxPct,
    historicalPct,
    includeHistorical,
  ]);

  const applyPreset = (preset: RatePreset) => {
    setRatePreset(preset);
    if (preset === "holdings" && defaults.holdingsPct != null) {
      setCustomHistoricalPct(String(defaults.holdingsPct));
    } else if (preset === "opponent" && defaults.opponentPct != null) {
      setCustomHistoricalPct(String(defaults.opponentPct));
    } else if (preset === "planning") {
      setCustomHistoricalPct(String(PLANNING_ANNUAL_RETURN_PCT));
    }
  };

  const horizonNum = Number(horizonYears);
  const contribHint = defaults.droppedOutlier
    ? `Default: average monthly deposits over the last 12 months, ignoring one large transfer (${formatMoney(Number(defaults.contributionAmount), currency)}).`
    : `Default: average monthly deposits over the last 12 months (${formatMoney(Number(defaults.contributionAmount), currency)}).`;

  return (
    <ChartSection
      title="Forecast"
      description="What this portfolio could be worth if you keep depositing. Planning band is conservative (3 / 7 / 12). The extra path is a what-if — not a promise that last stretch repeats. Deterministic compound growth, not a simulation."
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
              Default: latest portfolio value (
              {formatMoney(defaults.principal, currency)})
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
            <p className="text-muted-foreground text-[11px]">{contribHint}</p>
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
            <p className="text-muted-foreground text-xs font-medium tracking-wide">
              Horizon
            </p>
            <div
              className="bg-muted inline-flex flex-wrap rounded-lg p-0.5"
              role="group"
              aria-label="Forecast horizon in years"
            >
              {HORIZON_YEAR_OPTIONS.map((y) => (
                <Button
                  key={y}
                  type="button"
                  size="sm"
                  variant={
                    !useEndDate && horizonNum === y ? "default" : "ghost"
                  }
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    (useEndDate || horizonNum !== y) && "text-muted-foreground",
                  )}
                  disabled={useEndDate}
                  onClick={() => setHorizonYears(String(y))}
                  aria-pressed={!useEndDate && horizonNum === y}
                >
                  {y}y
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-[11px]">
              {useEndDate
                ? "Using the end date instead."
                : "How far to project from the start date."}
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

          <div className="space-y-1.5 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="fc-hist">If this continues %</Label>
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                id="fc-hist"
                type="number"
                step={0.1}
                className={cn(fieldClassName(), "sm:max-w-[8rem]")}
                value={historicalPct}
                onChange={(e) => {
                  setRatePreset("custom");
                  setCustomHistoricalPct(e.target.value);
                }}
                disabled={!includeHistorical}
                aria-label="If this continues annual return percent"
              />
              <div
                className="bg-muted inline-flex flex-wrap rounded-lg p-0.5"
                role="group"
                aria-label="Return assumption"
              >
                {defaults.holdingsPct != null ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={ratePreset === "holdings" ? "default" : "ghost"}
                    className={cn(
                      "h-7 px-2.5 text-xs",
                      ratePreset !== "holdings" && "text-muted-foreground",
                    )}
                    disabled={!includeHistorical}
                    onClick={() => applyPreset("holdings")}
                    aria-pressed={ratePreset === "holdings"}
                  >
                    Your holdings ({formatRateChip(defaults.holdingsPct)})
                  </Button>
                ) : null}
                {defaults.opponentPct != null ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={ratePreset === "opponent" ? "default" : "ghost"}
                    className={cn(
                      "h-7 px-2.5 text-xs",
                      ratePreset !== "opponent" && "text-muted-foreground",
                    )}
                    disabled={!includeHistorical}
                    onClick={() => applyPreset("opponent")}
                    aria-pressed={ratePreset === "opponent"}
                  >
                    {defaults.opponentLabel} ({formatRateChip(defaults.opponentPct)})
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant={ratePreset === "planning" ? "default" : "ghost"}
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    ratePreset !== "planning" && "text-muted-foreground",
                  )}
                  disabled={!includeHistorical}
                  onClick={() => applyPreset("planning")}
                  aria-pressed={ratePreset === "planning"}
                >
                  7% planning
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground text-[11px]">{pathHint}</p>
          </div>
        </div>

        <div
          className={cn(
            "grid gap-3 sm:grid-cols-2 lg:grid-cols-4",
            includeHistorical &&
              series.terminal.historical != null &&
              "xl:grid-cols-5",
          )}
        >
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
          {includeHistorical && series.terminal.historical != null ? (
            <SummaryCard
              label={`${pathLabel} terminal`}
              value={formatMoney(series.terminal.historical, currency)}
            />
          ) : null}
          <SummaryCard
            label="Range (min – max)"
            value={`${formatMoney(series.terminal.min, currency)} – ${formatMoney(series.terminal.max, currency)}`}
          />
        </div>

        <ForecastChart
          series={series}
          currency={currency}
          historicalLabel={pathLabel}
        />

        <p className="text-muted-foreground text-xs leading-relaxed">
          Contributions land at the end of each period; returns compound
          monthly. Min / expected / max is a planning band. {pathLabel} is{" "}
          {ratePreset === "holdings"
            ? `your holdings rate since ${defaults.windowLabel}`
            : ratePreset === "opponent"
              ? `${defaults.opponentLabel}'s holdings rate since ${defaults.windowLabel}`
              : ratePreset === "planning"
                ? "the same 7% planning rate as expected"
                : "the rate you typed"}
          . This is a planning tool, not a guarantee of future results.
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
