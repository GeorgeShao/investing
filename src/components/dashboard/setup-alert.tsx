import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

export interface SetupAlertProps {
  hasLocalConfig: boolean;
  hasPortfolioData: boolean;
  hasBenchmarkData: boolean;
}

function StatusRow({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) {
  const Icon = ok ? CircleCheck : CircleDashed;
  return (
    <li className="flex items-start gap-2">
      <Icon
        className={
          ok
            ? "text-emerald-600 mt-0.5 size-4 shrink-0"
            : "text-muted-foreground mt-0.5 size-4 shrink-0"
        }
        aria-hidden
      />
      <span className={ok ? "text-foreground" : undefined}>{label}</span>
    </li>
  );
}

/**
 * Shown when the dashboard has nothing to chart (no data/data.json).
 * Walks the user through local config, PDF extract, and benchmark fetch.
 */
export function SetupAlert({
  hasLocalConfig,
  hasPortfolioData,
  hasBenchmarkData,
}: SetupAlertProps) {
  return (
    <Alert className="border-border px-4 py-4 sm:px-5 sm:py-5">
      <CircleAlert className="text-amber-600" />
      <AlertTitle className="text-base">No portfolio data yet</AlertTitle>
      <AlertDescription className="mt-2 space-y-4">
        <p>
          This app runs on your machine and does not ship sample portfolio data
          or benchmark prices. After setup, charts appear here automatically.
        </p>

        <ul className="space-y-1.5 text-sm">
          <StatusRow
            ok={hasLocalConfig}
            label="config/config.local.json — your PDF root, chart windows, account groups"
          />
          <StatusRow
            ok={hasPortfolioData}
            label="data/data.json — extract from brokerage statement PDFs"
          />
          <StatusRow
            ok={hasBenchmarkData}
            label="data/benchmarks.json — month-end index prices for vs-benchmark charts"
          />
        </ul>

        <div className="bg-muted/60 space-y-3 rounded-md border p-3 font-mono text-xs leading-relaxed">
          <p className="text-muted-foreground font-sans text-xs font-medium tracking-wide uppercase">
            Setup
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap text-[12px] sm:text-xs">
{`# 1. Local config (gitignored)
cp config/config.example.json config/config.local.json
# edit pdfRoot, chartStartWindows, accountGroups as needed

# 2. Python deps + extract statements → data/data.json
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt
python scripts/run_extract.py

# 3. Benchmark prices → data/benchmarks.json
python scripts/fetch_benchmarks.py

# 4. Reload the dashboard
pnpm dev`}
          </pre>
        </div>

        <p className="text-xs">
          Statement PDFs stay on your machine and are never committed. See the
          README for folder layout and how to add another brokerage.
        </p>
      </AlertDescription>
    </Alert>
  );
}
