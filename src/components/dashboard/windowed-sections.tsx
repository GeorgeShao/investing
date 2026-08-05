"use client";

import { useMemo, useState } from "react";
import { BenchmarkChart } from "@/components/charts/benchmark-chart";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import { HoldingWeightChart } from "@/components/charts/holding-weight-chart";
import { MonthlyPnLChart } from "@/components/charts/monthly-pnl-chart";
import { NetWorthChart } from "@/components/charts/net-worth-chart";
import { ChartSection } from "@/components/dashboard/chart-section";
import { ForecastSection } from "@/components/dashboard/forecast-section";
import { ReturnStatsPanel } from "@/components/dashboard/return-stats";
import { StartWindowToggle } from "@/components/dashboard/start-window-toggle";
import type {
  AccountGroupConfig,
  BenchmarkConfig,
  ChartStartWindow,
} from "@/lib/config";
import type { BenchmarkFile } from "@/lib/benchmarks";
import {
  buildMonthlyPnLSeries,
  computeReturnStats,
  computeYearlyReturns,
} from "@/lib/performance";
import {
  buildCashFlowSeries,
  buildNetWorthSeries,
  sliceFromPeriodId,
} from "@/lib/series";
import type { PortfolioData } from "@/lib/types";

function useWindowedData(
  base: PortfolioData,
  defaultStart: string,
  windows: ChartStartWindow[],
) {
  const initial =
    windows.find((w) => w.id === defaultStart)?.id ??
    windows[0]?.id ??
    base.periods[0]?.id ??
    "";
  const [start, setStart] = useState(initial);
  const data = useMemo(
    () => (start ? sliceFromPeriodId(base, start) : base),
    [base, start],
  );
  return { start, setStart, data };
}

export interface WindowedSectionsProps {
  baseData: PortfolioData;
  benchmarks: BenchmarkFile;
  currency: string;
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
  accountGroups: AccountGroupConfig[];
  benchmarkConfigs: BenchmarkConfig[];
}

function Toggle({
  start,
  setStart,
  windows,
}: {
  start: string;
  setStart: (v: string) => void;
  windows: ChartStartWindow[];
}) {
  return (
    <StartWindowToggle windows={windows} value={start} onChange={setStart} />
  );
}

export function WindowedNetWorthSection({
  baseData,
  currency,
  chartStartWindows,
  defaultChartStart,
  accountGroups,
}: {
  baseData: PortfolioData;
  currency: string;
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
  accountGroups: AccountGroupConfig[];
}) {
  const { start, setStart, data } = useWindowedData(
    baseData,
    defaultChartStart,
    chartStartWindows,
  );
  const series = useMemo(
    () => buildNetWorthSeries(data, accountGroups),
    [data, accountGroups],
  );
  return (
    <ChartSection
      title="Net worth over time"
      description="Stacked month-end balances by account, with total net worth trajectory overlaid."
      action={
        <Toggle start={start} setStart={setStart} windows={chartStartWindows} />
      }
    >
      <NetWorthChart series={series} currency={currency} />
    </ChartSection>
  );
}

export function WindowedCashFlowSection({
  baseData,
  currency,
  chartStartWindows,
  defaultChartStart,
}: {
  baseData: PortfolioData;
  currency: string;
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
}) {
  const { start, setStart, data } = useWindowedData(
    baseData,
    defaultChartStart,
    chartStartWindows,
  );
  const series = useMemo(() => buildCashFlowSeries(data), [data]);
  return (
    <ChartSection
      title="Net cash flows over time"
      description="External deposits vs withdrawals each month, with net flow as a line. Internal transfers excluded."
      action={
        <Toggle start={start} setStart={setStart} windows={chartStartWindows} />
      }
    >
      <CashFlowChart series={series} currency={currency} />
    </ChartSection>
  );
}

export function WindowedMonthlyPnLSection({
  baseData,
  currency,
  chartStartWindows,
  defaultChartStart,
}: {
  baseData: PortfolioData;
  currency: string;
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
}) {
  const { start, setStart, data } = useWindowedData(
    baseData,
    defaultChartStart,
    chartStartWindows,
  );
  const series = useMemo(() => buildMonthlyPnLSeries(data), [data]);
  return (
    <ChartSection
      title="Monthly P&L"
      description="Green = gain, red = loss. $ is dollar P&L; % is monthly time-weighted return."
      action={
        <Toggle start={start} setStart={setStart} windows={chartStartWindows} />
      }
    >
      <MonthlyPnLChart series={series} currency={currency} />
    </ChartSection>
  );
}

export function WindowedReturnStatsSection({
  baseData,
  chartStartWindows,
  defaultChartStart,
}: {
  baseData: PortfolioData;
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
}) {
  const { start, setStart, data } = useWindowedData(
    baseData,
    defaultChartStart,
    chartStartWindows,
  );
  const stats = useMemo(() => computeReturnStats(data), [data]);
  const yearly = useMemo(() => computeYearlyReturns(data), [data]);
  return (
    <ChartSection
      title="Return statistics"
      action={
        <Toggle start={start} setStart={setStart} windows={chartStartWindows} />
      }
    >
      <ReturnStatsPanel stats={stats} yearly={yearly} />
    </ChartSection>
  );
}

export function WindowedBenchmarkSection({
  baseData,
  benchmarks,
  currency,
  chartStartWindows,
  defaultChartStart,
  benchmarkConfigs,
}: {
  baseData: PortfolioData;
  benchmarks: BenchmarkFile;
  currency: string;
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
  benchmarkConfigs: BenchmarkConfig[];
}) {
  const { start, setStart, data } = useWindowedData(
    baseData,
    defaultChartStart,
    chartStartWindows,
  );
  return (
    <ChartSection
      title="Vs benchmarks"
      action={
        <Toggle start={start} setStart={setStart} windows={chartStartWindows} />
      }
    >
      <BenchmarkChart
        data={data}
        benchmarks={benchmarks}
        currency={currency}
        benchmarkConfigs={benchmarkConfigs}
      />
    </ChartSection>
  );
}

export function WindowedHoldingWeightSection({
  baseData,
  chartStartWindows,
  defaultChartStart,
}: {
  baseData: PortfolioData;
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
}) {
  const { start, setStart, data } = useWindowedData(
    baseData,
    defaultChartStart,
    chartStartWindows,
  );
  return (
    <ChartSection
      title="Position weights over time"
      description="Stocks, options, and cash across all accounts. Toggle Asset mix (always 100%) vs % of equity (can exceed 100% with margin)."
      action={
        <Toggle start={start} setStart={setStart} windows={chartStartWindows} />
      }
    >
      <HoldingWeightChart data={data} />
    </ChartSection>
  );
}

export function WindowedSections({
  baseData,
  benchmarks,
  currency,
  chartStartWindows,
  defaultChartStart,
  accountGroups,
  benchmarkConfigs,
}: WindowedSectionsProps) {
  return (
    <>
      <WindowedNetWorthSection
        baseData={baseData}
        currency={currency}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
        accountGroups={accountGroups}
      />
      <WindowedCashFlowSection
        baseData={baseData}
        currency={currency}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
      />
      <WindowedMonthlyPnLSection
        baseData={baseData}
        currency={currency}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
      />
      <WindowedReturnStatsSection
        baseData={baseData}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
      />
      <WindowedBenchmarkSection
        baseData={baseData}
        benchmarks={benchmarks}
        currency={currency}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
        benchmarkConfigs={benchmarkConfigs}
      />
      <WindowedHoldingWeightSection
        baseData={baseData}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
      />
      <ForecastSection data={baseData} currency={currency} />
    </>
  );
}
