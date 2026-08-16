"use client";

import { useMemo, useState } from "react";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import { HoldingWeightChart } from "@/components/charts/holding-weight-chart";
import { MonthlyPnLChart } from "@/components/charts/monthly-pnl-chart";
import { NetWorthChart } from "@/components/charts/net-worth-chart";
import { AnalysisControls } from "@/components/dashboard/analysis-controls";
import { ChartSection } from "@/components/dashboard/chart-section";
import { ForecastSection } from "@/components/dashboard/forecast-section";
import {
  MissingMonthEstimates,
  useEstimatedPortfolio,
} from "@/components/dashboard/missing-month-estimates";
import { VsOpponentSection } from "@/components/dashboard/vs-opponent-section";
import type {
  AccountGroupConfig,
  BenchmarkConfig,
  ChartStartWindow,
} from "@/lib/config";
import { buildWindowedAnalysis, resolveStartPeriodId } from "@/lib/analysis";
import {
  listBenchmarkIds,
  pickDefaultOpponentId,
  type BenchmarkFile,
} from "@/lib/benchmarks";
import type { PortfolioData } from "@/lib/types";

export interface WindowedSectionsProps {
  baseData: PortfolioData;
  benchmarks: BenchmarkFile;
  currency: string;
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
  accountGroups: AccountGroupConfig[];
  benchmarkConfigs: BenchmarkConfig[];
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

  const initialStart = resolveStartPeriodId(
    data,
    chartStartWindows.find((w) => w.id === defaultChartStart)?.id ??
      defaultChartStart,
    chartStartWindows,
  );
  const [start, setStart] = useState(initialStart);

  const preferredIds = benchmarkConfigs.map((c) => c.id);
  const opponentIds = useMemo(
    () => listBenchmarkIds(benchmarks.prices, preferredIds),
    [benchmarks.prices, preferredIds],
  );
  const [opponentId, setOpponentId] = useState(() =>
    pickDefaultOpponentId(opponentIds),
  );

  const analysis = useMemo(
    () =>
      buildWindowedAnalysis(data, {
        startPeriodId: start,
        accountGroups,
        benchmarks,
        opponentId,
        benchmarkConfigs,
      }),
    [data, start, accountGroups, benchmarks, opponentId, benchmarkConfigs],
  );

  const windowLabel =
    chartStartWindows.find((w) => w.id === analysis.startPeriodId)?.label ??
    analysis.startPeriodId;

  return (
    <>
      <MissingMonthEstimates
        gaps={gaps}
        estimates={estimates}
        defaults={defaults}
        onChange={setMonth}
        onReset={resetMonth}
      />
      <AnalysisControls
        windows={chartStartWindows}
        start={analysis.startPeriodId}
        onStartChange={setStart}
      />
      <VsOpponentSection
        comparison={analysis.comparison}
        opponentIds={opponentIds}
        selectedId={analysis.opponentId}
        onOpponentChange={setOpponentId}
        currency={currency}
        pain={analysis.pain}
        attribution={analysis.attribution}
      />
      <ChartSection
        title="Portfolio value over time"
        description="Stacked month-end brokerage balances by account. Bank cash, credit cards, and other debt are not included."
      >
        <NetWorthChart series={analysis.netWorth} currency={currency} />
      </ChartSection>
      <ChartSection
        title="Net cash flows over time"
        description="External deposits vs withdrawals each month, with net flow as a line. Internal transfers excluded."
      >
        <CashFlowChart series={analysis.cashFlow} currency={currency} />
      </ChartSection>
      <ChartSection
        title="Monthly P&L"
        description="Green = gain, red = loss. $ is dollar P&L; % is monthly time-weighted return."
      >
        <MonthlyPnLChart series={analysis.pnl} currency={currency} />
      </ChartSection>
      <ChartSection
        title="Position weights over time"
        description="Stocks, options, and cash in brokerage accounts. Toggle Asset mix (always 100%) vs % of equity (can exceed 100% with margin)."
      >
        <HoldingWeightChart data={analysis.data} />
      </ChartSection>
      <ForecastSection
        data={data}
        windowLabel={windowLabel}
        holdingsCagr={analysis.holdingsCagr}
        opponentHoldingsAnn={analysis.opponentHoldingsAnn}
        opponentLabel={analysis.opponentLabel}
        typicalMonthlyDeposit={analysis.typicalMonthlyDeposit}
        currency={currency}
      />
    </>
  );
}
