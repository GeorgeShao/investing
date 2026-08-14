import { WindowedSections } from "@/components/dashboard/windowed-sections";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DataQualityAlert } from "@/components/dashboard/data-quality-alert";
import { SetupAlert } from "@/components/dashboard/setup-alert";
import {
  getBenchmarkData,
  hasBenchmarkData,
} from "@/lib/benchmark-data";
import { getAppConfig } from "@/lib/config";
import {
  findMissingLatestStatements,
  mergePortfolioWarnings,
  MISSING_LATEST_STATEMENT,
} from "@/lib/data-quality";
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
  const warnings = portfolio
    ? mergePortfolioWarnings(
        portfolio.meta.warnings,
        findMissingLatestStatements(portfolio),
      ).filter((w) => w.code !== MISSING_LATEST_STATEMENT)
    : [];

  return (
    <DashboardShell
      title="Portfolio overview"
      subtitle="Would the same paychecks in QQQ have made you richer? Did the stocks you held beat QQQ? Local-only, from brokerage statement PDFs."
    >
      {ready && portfolio ? (
        <div className="flex flex-col gap-6">
          <DataQualityAlert warnings={warnings} />
          <WindowedSections
            baseData={sliceFromFirstPositiveNetWorth(portfolio)}
            benchmarks={getBenchmarkData()}
            currency={portfolio.meta.currency || config.currency}
            chartStartWindows={config.chartStartWindows}
            defaultChartStart={config.defaultChartStart}
            accountGroups={config.accountGroups}
            benchmarkConfigs={config.benchmarks}
          />
        </div>
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
