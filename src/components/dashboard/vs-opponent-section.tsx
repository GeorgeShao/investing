"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { EChartsOption } from "echarts";
import { EChartsWrapper } from "@/components/charts/echarts-wrapper";
import { ChartSection } from "@/components/dashboard/chart-section";
import { StartWindowToggle } from "@/components/dashboard/start-window-toggle";
import { Button } from "@/components/ui/button";
import type { BenchmarkConfig, ChartStartWindow } from "@/lib/config";
import {
  computeOpponentComparison,
  listBenchmarkIds,
  pickDefaultOpponentId,
  type BenchmarkFile,
  type BenchmarkSeries,
  type OpponentComparison,
} from "@/lib/benchmarks";
import { formatPercent } from "@/lib/performance";
import { sliceFromPeriodId } from "@/lib/series";
import type { PortfolioData } from "@/lib/types";
import { cn } from "@/lib/utils";

const YOU_COLOR = "#0f172a";
const OPPONENT_COLOR = "#06b6d4";

export interface VsOpponentSectionProps {
  baseData: PortfolioData;
  benchmarks: BenchmarkFile;
  currency: string;
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
  benchmarkConfigs: BenchmarkConfig[];
}

function formatMoney(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSignedMoney(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = formatMoney(Math.abs(value), currency);
  if (Math.abs(value) < 0.5) return formatMoney(0, currency);
  return value > 0 ? `+${abs}` : `−${abs}`;
}

function deltaClass(value: number | null): string {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 0.5) {
    return "text-foreground";
  }
  return value > 0 ? "text-emerald-600" : "text-red-600";
}

function buildPathOption(
  series: BenchmarkSeries,
  mode: "cashflow" | "twrr",
  currency: string,
  opponentLabel: string,
): EChartsOption {
  const isCash = mode === "cashflow";
  const opponent = Object.values(series.benchmarks)[0];
  const line = (
    name: string,
    data: Array<number | null>,
    color: string,
    width: number,
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
      line(isCash ? "You" : "Your holdings", series.portfolio, YOU_COLOR, 2.5),
      line(
        isCash ? `Same deposits in ${opponentLabel}` : opponentLabel,
        opponent?.values ?? [],
        OPPONENT_COLOR,
        2,
      ),
    ],
  };
}

export function VsOpponentSection({
  baseData,
  benchmarks,
  currency,
  chartStartWindows,
  defaultChartStart,
  benchmarkConfigs,
}: VsOpponentSectionProps) {
  const initialStart =
    chartStartWindows.find((w) => w.id === defaultChartStart)?.id ??
    chartStartWindows[0]?.id ??
    baseData.periods[0]?.id ??
    "";
  const [start, setStart] = useState(initialStart);
  const data = useMemo(
    () => (start ? sliceFromPeriodId(baseData, start) : baseData),
    [baseData, start],
  );

  const preferredIds = benchmarkConfigs.map((c) => c.id);
  const ids = useMemo(
    () => listBenchmarkIds(benchmarks.prices, preferredIds),
    [benchmarks.prices, preferredIds],
  );
  const [opponentId, setOpponentId] = useState(() => pickDefaultOpponentId(ids));
  const selectedId = ids.includes(opponentId)
    ? opponentId
    : pickDefaultOpponentId(ids);

  const comparison: OpponentComparison | null = useMemo(() => {
    if (ids.length === 0 || data.periods.length < 2) return null;
    return computeOpponentComparison(
      data,
      benchmarks,
      selectedId,
      benchmarkConfigs,
    );
  }, [data, benchmarks, selectedId, benchmarkConfigs, ids.length]);

  const label = comparison?.headline.opponentLabel ?? selectedId;
  const cashOption = useMemo(
    () =>
      comparison
        ? buildPathOption(comparison.cashflow, "cashflow", currency, label)
        : null,
    [comparison, currency, label],
  );
  const twrrOption = useMemo(
    () =>
      comparison
        ? buildPathOption(comparison.twrr, "twrr", currency, label)
        : null,
    [comparison, currency, label],
  );

  return (
    <ChartSection
      title={`You vs ${label}`}
      description="Two scores. Dollars first: would the same paychecks in the index have made you richer? Then: did the stocks you held grow faster, ignoring when the paycheck landed."
      action={
        <StartWindowToggle
          windows={chartStartWindows}
          value={start}
          onChange={setStart}
        />
      }
    >
      {ids.length === 0 || !comparison ? (
        <p className="text-muted-foreground text-sm">
          Fetch month-end index prices to compare with {label}. Until then this
          section stays empty so a lonely personal rate is never shown as a
          win or loss.
        </p>
      ) : (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Compare to
            </span>
            <div
              className="bg-muted inline-flex flex-wrap rounded-lg p-0.5"
              role="group"
              aria-label="Opponent"
            >
              {ids.map((id) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={id === selectedId ? "default" : "ghost"}
                  className={cn(
                    "h-7 px-2.5 text-xs",
                    id !== selectedId && "text-muted-foreground",
                  )}
                  onClick={() => setOpponentId(id)}
                  aria-pressed={id === selectedId}
                >
                  {id}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <VerdictCard
              eyebrow="Same paychecks"
              title={
                comparison.headline.dollarDelta === null ? (
                  "Not enough data for a dollar score."
                ) : (
                  <>
                    You have{" "}
                    <span className="tabular-nums">
                      {formatMoney(comparison.headline.youEnd, currency)}
                    </span>
                    . Same deposits into {label} would be{" "}
                    <span className="tabular-nums">
                      {formatMoney(comparison.headline.opponentEnd, currency)}
                    </span>
                    .{" "}
                    <span
                      className={cn(
                        "tabular-nums",
                        deltaClass(comparison.headline.dollarDelta),
                      )}
                    >
                      {comparison.headline.dollarDelta >= 0
                        ? "Ahead"
                        : "Behind"}{" "}
                      by{" "}
                      {formatMoney(
                        Math.abs(comparison.headline.dollarDelta),
                        currency,
                      )}
                    </span>
                    .
                  </>
                )
              }
              support={
                comparison.headline.youEarnedAnn !== null &&
                comparison.headline.opponentEarnedAnn !== null
                  ? `Your money earned ${formatPercent(comparison.headline.youEarnedAnn)}/year. ${label}, same deposits, earned ${formatPercent(comparison.headline.opponentEarnedAnn)}/year.`
                  : "Replay of your opening balance and every deposit or withdrawal into the index on the same dates."
              }
            />
            <VerdictCard
              eyebrow="Stock picks"
              title={
                comparison.headline.youHoldingsAnn === null ||
                comparison.headline.opponentHoldingsAnn === null ? (
                  "Not enough data for a holdings score."
                ) : (
                  <>
                    Your holdings grew{" "}
                    <span className="tabular-nums">
                      {formatPercent(comparison.headline.youHoldingsAnn)}
                    </span>
                    /year. {label} grew{" "}
                    <span className="tabular-nums">
                      {formatPercent(comparison.headline.opponentHoldingsAnn)}
                    </span>
                    /year.{" "}
                    <span
                      className={cn(
                        "tabular-nums",
                        deltaClass(
                          comparison.headline.youHoldingsAnn -
                            comparison.headline.opponentHoldingsAnn,
                        ),
                      )}
                    >
                      {comparison.headline.youHoldingsAnn >=
                      comparison.headline.opponentHoldingsAnn
                        ? "Faster"
                        : "Slower"}{" "}
                      by{" "}
                      {formatPercent(
                        Math.abs(
                          comparison.headline.youHoldingsAnn -
                            comparison.headline.opponentHoldingsAnn,
                        ),
                      )}
                      /year
                    </span>
                    .
                  </>
                )
              }
              support="Ignores when the paycheck landed. This is the number that is fair vs other people and vs a published index return."
            />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Same deposits, dollar path</p>
            {cashOption ? (
              <EChartsWrapper
                option={cashOption}
                height={320}
                ariaLabel={`Your portfolio versus the same deposits into ${label}`}
              />
            ) : null}
            <p className="text-muted-foreground text-xs leading-relaxed">
              Both lines start with your opening balance. Each month they grow
              with their own return, then the same deposit or withdrawal is
              applied. If every paycheck had bought {label}, you would be on
              the {label} line.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">
              $1 left invested — stock-picker score
            </p>
            {twrrOption ? (
              <EChartsWrapper
                option={twrrOption}
                height={320}
                ariaLabel={`Holdings growth versus ${label}`}
              />
            ) : null}
            <p className="text-muted-foreground text-xs leading-relaxed">
              Growth of $1 that sat in what you held, versus $1 that sat in{" "}
              {label}. Paycheck timing is stripped out.
            </p>
          </div>

          <YearlyGainTable
            rows={comparison.yearly}
            opponentLabel={label}
            currency={currency}
          />
        </div>
      )}
    </ChartSection>
  );
}

function VerdictCard({
  eyebrow,
  title,
  support,
}: {
  eyebrow: string;
  title: ReactNode;
  support: string;
}) {
  return (
    <div className="bg-muted/40 rounded-lg border px-4 py-4">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {eyebrow}
      </p>
      <p className="mt-1.5 text-base leading-snug font-medium">{title}</p>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        {support}
      </p>
    </div>
  );
}

function YearlyGainTable({
  rows,
  opponentLabel,
  currency,
}: {
  rows: OpponentComparison["yearly"];
  opponentLabel: string;
  currency: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">By calendar year</p>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Gain $ is the change in value that is not from deposits or withdrawals.
        Gain % is that dollar amount divided by what you started the year with
        plus net deposits — the number most brokerage homepages show.{" "}
        {opponentLabel} uses the same deposits on the same dates. Holdings
        ignore paycheck timing (the stock-picker score).
      </p>
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="bg-muted/50 border-b text-left">
              <th className="text-muted-foreground px-3 py-2 font-medium">
                Year
              </th>
              <th className="text-muted-foreground px-3 py-2 font-medium">
                Your gain $
              </th>
              <th className="text-muted-foreground px-3 py-2 font-medium">
                Your gain %
              </th>
              <th className="text-muted-foreground px-3 py-2 font-medium">
                {opponentLabel} $
              </th>
              <th className="text-muted-foreground px-3 py-2 font-medium">
                {opponentLabel} %
              </th>
              <th className="text-muted-foreground px-3 py-2 font-medium">
                Ahead / behind
              </th>
              <th className="text-muted-foreground px-3 py-2 font-medium">
                Your holdings
              </th>
              <th className="text-muted-foreground px-3 py-2 font-medium">
                {opponentLabel} holdings
              </th>
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
                  {row.you ? formatSignedMoney(row.you.gain, currency) : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatPercent(row.you?.rate ?? null)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {row.opponent
                    ? formatSignedMoney(row.opponent.gain, currency)
                    : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatPercent(row.opponent?.rate ?? null)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 tabular-nums",
                    deltaClass(row.dollarDelta),
                  )}
                >
                  {formatSignedMoney(row.dollarDelta, currency)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatPercent(row.youHoldings)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatPercent(row.opponentHoldings)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
