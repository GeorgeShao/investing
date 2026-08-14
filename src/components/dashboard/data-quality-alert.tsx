import { CircleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { MISSING_LATEST_STATEMENT } from "@/lib/data-quality";
import type { PortfolioWarning } from "@/lib/types";

export interface DataQualityAlertProps {
  warnings: PortfolioWarning[];
}

function formatCad(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Surfaces extract-time and load-time data quality issues.
 */
export function DataQualityAlert({ warnings }: DataQualityAlertProps) {
  if (!warnings.length) return null;

  const missingLatest = warnings.filter(
    (w) => w.code === MISSING_LATEST_STATEMENT,
  );
  const missingFx = warnings.filter((w) => w.code === "usd_missing_exact_month_fx");
  const other = warnings.filter(
    (w) =>
      w.code !== MISSING_LATEST_STATEMENT &&
      w.code !== "usd_missing_exact_month_fx",
  );

  if (!missingLatest.length && !missingFx.length && !other.length) return null;

  const title =
    missingLatest.length && !missingFx.length && !other.length
      ? missingLatest.length === 1
        ? "An account is missing from the latest month"
        : "Accounts are missing from the latest month"
      : missingFx.length && !missingLatest.length && !other.length
        ? "USD→CAD rate missing for some months"
        : "Data quality";

  return (
    <Alert className="border-amber-500/40 bg-amber-500/5 px-4 py-4 sm:px-5 sm:py-5">
      <CircleAlert className="text-amber-600" />
      <AlertTitle className="text-base">{title}</AlertTitle>
      <AlertDescription className="mt-2 space-y-4 text-sm">
        {missingLatest.length > 0 ? (
          <div className="space-y-2">
            {!(missingLatest.length && !missingFx.length && !other.length) ? (
              <p className="font-medium text-foreground">
                Missing from the latest month
              </p>
            ) : null}
            <p>
              These accounts had a positive month-end balance the last time they
              appeared, but there is no statement in the newest month. That
              usually means a PDF has not arrived yet — not that the account
              went to zero. Latest portfolio totals and returns omit this money until
              you add the statement and re-run extract.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {missingLatest.map((w) => (
                <li key={`${w.accountId}-${w.periodId}`}>
                  <span className="text-foreground font-medium">
                    {accountLabel(w)}
                  </span>
                  {" · last seen "}
                  <span className="tabular-nums">{w.periodId}</span>
                  {w.marketValue != null ? (
                    <>
                      {" at "}
                      <span className="tabular-nums">
                        {formatCad(w.marketValue)}
                      </span>
                    </>
                  ) : null}
                  {w.latestPeriodId ? (
                    <>
                      {" · absent in "}
                      <span className="tabular-nums">{w.latestPeriodId}</span>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {missingFx.length > 0 ? (
          <FxWarningBlock warnings={missingFx} />
        ) : null}

        {other.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {other.map((w, i) => (
              <li key={`other-${i}`}>{w.message}</li>
            ))}
          </ul>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function accountLabel(w: PortfolioWarning): string {
  if (w.message) {
    const name = w.message.split(" had a positive")[0];
    if (name && name !== w.message) return name;
  }
  return w.accountId ?? "Account";
}

function FxWarningBlock({ warnings }: { warnings: PortfolioWarning[] }) {
  const periods = [
    ...new Set(warnings.map((w) => w.periodId).filter(Boolean) as string[]),
  ].sort();
  return (
    <div className="space-y-2">
      <p className="font-medium text-foreground">USD→CAD rate missing</p>
      <p>
        Some USD account balances have no conversion rate for their{" "}
        <strong>exact statement month</strong> (same-period statement FX or
        month-end <code className="text-xs">USDCAD</code> in{" "}
        <code className="text-xs">data/benchmarks.json</code>). Neighboring
        months are never used. CAD portfolio totals for those rows are unconverted
        until you fix this.
      </p>
      {periods.length > 0 && (
        <p>
          Affected periods:{" "}
          <span className="font-medium tabular-nums">{periods.join(", ")}</span>
          {" "}
          ({warnings.length} account-month
          {warnings.length === 1 ? "" : "s"})
        </p>
      )}
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {warnings.slice(0, 8).map((w) => (
          <li key={`${w.periodId}-${w.accountId}`}>
            <span className="tabular-nums">{w.periodId}</span>
            {w.accountId ? ` · ${w.accountId}` : ""}
            {w.nativeMarketValue != null
              ? ` · $${w.nativeMarketValue.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })} USD`
              : ""}
          </li>
        ))}
        {warnings.length > 8 && <li>…and {warnings.length - 8} more</li>}
      </ul>
      <p className="text-muted-foreground">
        Fix: re-run{" "}
        <code className="text-xs">python scripts/fetch_benchmarks.py</code> so
        month-end <code className="text-xs">USDCAD</code> covers those periods,
        then <code className="text-xs">python scripts/run_extract.py</code>.
      </p>
    </div>
  );
}
