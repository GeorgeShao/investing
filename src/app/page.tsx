import { WindowedSections } from "@/components/dashboard/windowed-sections";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SetupAlert } from "@/components/dashboard/setup-alert";
import {
  getBenchmarkData,
  hasBenchmarkData,
} from "@/lib/benchmark-data";
import { getAppConfig } from "@/lib/config";
import {
  getPortfolioData,
  hasLocalConfig,
  hasPortfolioData,
} from "@/lib/data";
import { sliceFromFirstPositiveNetWorth } from "@/lib/series";

export default function HomePage() {
  const config = getAppConfig();
  const portfolio = getPortfolioData();
  const ready = portfolio !== null && hasPortfolioData();

  return (
    <DashboardShell
      title="Portfolio overview"
      subtitle="Investment performance from brokerage statement PDFs. Net worth, external cash flows, TWRR/MWRR, and vs-benchmark comparison — runs locally with no auth."
    >
      {ready && portfolio ? (
        <WindowedSections
          baseData={sliceFromFirstPositiveNetWorth(portfolio)}
          benchmarks={getBenchmarkData()}
          currency={portfolio.meta.currency || config.currency}
          chartStartWindows={config.chartStartWindows}
          defaultChartStart={config.defaultChartStart}
          accountGroups={config.accountGroups}
          benchmarkConfigs={config.benchmarks}
        />
      ) : (
        <SetupAlert
          hasLocalConfig={hasLocalConfig()}
          hasPortfolioData={hasPortfolioData()}
          hasBenchmarkData={hasBenchmarkData()}
        />
      )}
    </DashboardShell>
  );
}
