"use client";

import { useMemo, useState } from "react";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import { HoldingWeightChart } from "@/components/charts/holding-weight-chart";
import { MonthlyPnLChart } from "@/components/charts/monthly-pnl-chart";
import { NetWorthChart } from "@/components/charts/net-worth-chart";
import { ChartSection } from "@/components/dashboard/chart-section";
import { ForecastSection } from "@/components/dashboard/forecast-section";
import {
  MissingMonthEstimates,
  useEstimatedPortfolio,
} from "@/components/dashboard/missing-month-estimates";
import { StartWindowToggle } from "@/components/dashboard/start-window-toggle";
import { VsOpponentSection } from "@/components/dashboard/vs-opponent-section";
import type {
  AccountGroupConfig,
  BenchmarkConfig,
  ChartStartWindow,
} from "@/lib/config";
import type { BenchmarkFile } from "@/lib/benchmarks";
import { buildMonthlyPnLSeries } from "@/lib/performance";
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
      title="Portfolio value over time"
      description="Stacked month-end brokerage balances by account. Bank cash, credit cards, and other debt are not included."
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
      description="Stocks, options, and cash in brokerage accounts. Toggle Asset mix (always 100%) vs % of equity (can exceed 100% with margin)."
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
  const { data, gaps, estimates, defaults, setMonth, resetMonth } =
    useEstimatedPortfolio(baseData);

  return (
    <>
      <MissingMonthEstimates
        gaps={gaps}
        estimates={estimates}
        defaults={defaults}
        onChange={setMonth}
        onReset={resetMonth}
      />
      <VsOpponentSection
        baseData={data}
        benchmarks={benchmarks}
        currency={currency}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
        benchmarkConfigs={benchmarkConfigs}
      />
      <WindowedNetWorthSection
        baseData={data}
        currency={currency}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
        accountGroups={accountGroups}
      />
      <WindowedCashFlowSection
        baseData={data}
        currency={currency}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
      />
      <WindowedMonthlyPnLSection
        baseData={data}
        currency={currency}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
      />
      <WindowedHoldingWeightSection
        baseData={data}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
      />
      <ForecastSection
        data={data}
        currency={currency}
        benchmarks={benchmarks}
        benchmarkConfigs={benchmarkConfigs}
        chartStartWindows={chartStartWindows}
        defaultChartStart={defaultChartStart}
      />
    </>
  );
}
