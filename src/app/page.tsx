import { WindowedSections } from "@/components/dashboard/windowed-sections";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getBenchmarkData } from "@/lib/benchmark-data";
import { getAppConfig } from "@/lib/config";
import { getPortfolioData } from "@/lib/data";
import { sliceFromFirstPositiveNetWorth } from "@/lib/series";

export default function HomePage() {
  const config = getAppConfig();
  const baseData = sliceFromFirstPositiveNetWorth(getPortfolioData());
  const currency = baseData.meta.currency || config.currency;

  return (
    <DashboardShell
      title="Portfolio overview"
      subtitle="Investment performance from brokerage statement PDFs. Net worth, external cash flows, TWRR/MWRR, and vs-benchmark comparison — runs locally with no auth."
    >
      <WindowedSections
        baseData={baseData}
        benchmarks={getBenchmarkData()}
        currency={currency}
        chartStartWindows={config.chartStartWindows}
        defaultChartStart={config.defaultChartStart}
        accountGroups={config.accountGroups}
        benchmarkConfigs={config.benchmarks}
      />
    </DashboardShell>
  );
}
