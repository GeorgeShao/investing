"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  applyEstimates,
  clearMonthEstimate,
  defaultEstimates,
  findTrailingGaps,
  loadStoredEstimates,
  mergeEstimates,
  saveStoredEstimates,
  setMonthEstimate,
  type EstimateMap,
  type MonthEstimate,
  type TrailingGap,
} from "@/lib/estimates";
import type { PortfolioData } from "@/lib/types";
import { cn } from "@/lib/utils";

export function useEstimatedPortfolio(baseData: PortfolioData): {
  data: PortfolioData;
  gaps: TrailingGap[];
  estimates: EstimateMap;
  defaults: EstimateMap;
  setMonth: (
    accountId: string,
    periodId: string,
    patch: Partial<MonthEstimate>,
  ) => void;
  resetMonth: (accountId: string, periodId: string) => void;
} {
  const gaps = useMemo(() => findTrailingGaps(baseData), [baseData]);
  const defaults = useMemo(() => defaultEstimates(gaps), [gaps]);
  const [overrides, setOverrides] = useState<EstimateMap>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setOverrides(loadStoredEstimates());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveStoredEstimates(overrides);
  }, [hydrated, overrides]);

  const estimates = useMemo(
    () => mergeEstimates(defaults, overrides),
    [defaults, overrides],
  );
  const data = useMemo(
    () => applyEstimates(baseData, estimates),
    [baseData, estimates],
  );

  return {
    data,
    gaps,
    estimates,
    defaults,
    setMonth: (accountId, periodId, patch) => {
      setOverrides((prev) => {
        const current =
          mergeEstimates(defaults, prev)[accountId]?.[periodId] ??
          defaults[accountId]?.[periodId];
        if (!current) return prev;
        const next = { ...current, ...patch };
        if (
          !Number.isFinite(next.marketValue) ||
          !Number.isFinite(next.deposits) ||
          !Number.isFinite(next.withdrawals)
        ) {
          return prev;
        }
        return setMonthEstimate(prev, accountId, periodId, next);
      });
    },
    resetMonth: (accountId, periodId) => {
      setOverrides((prev) => clearMonthEstimate(prev, accountId, periodId));
    },
  };
}

function fieldClassName() {
  return cn(
    "border-input bg-background ring-offset-background placeholder:text-muted-foreground",
    "focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs",
    "focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
    "tabular-nums",
  );
}

function formatCad(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function MissingMonthEstimates({
  gaps,
  estimates,
  defaults,
  onChange,
  onReset,
}: {
  gaps: TrailingGap[];
  estimates: EstimateMap;
  defaults: EstimateMap;
  onChange: (
    accountId: string,
    periodId: string,
    patch: Partial<MonthEstimate>,
  ) => void;
  onReset: (accountId: string, periodId: string) => void;
}) {
  if (gaps.length === 0) return null;

  const title =
    gaps.length === 1
      ? "Fill in the missing month"
      : "Fill in the missing months";

  return (
    <Alert className="border-amber-500/40 bg-amber-500/5 px-4 py-4 sm:px-5 sm:py-5">
      <CircleAlert className="text-amber-600" />
      <AlertTitle className="text-base">{title}</AlertTitle>
      <AlertDescription className="mt-2 space-y-4 text-sm">
        <p>
          These accounts have no statement in the newest month. Charts and
          returns use the numbers below so the money does not vanish. Ending
          value starts as the last statement; deposits and withdrawals start
          at $0. Edit if you have a better figure from the brokerage app.
          Saved in this browser only — not written into the extract.
        </p>
        {gaps.map((gap) => (
          <div key={gap.accountId} className="space-y-3">
            <p>
              <span className="text-foreground font-medium">{gap.name}</span>
              <span className="text-muted-foreground">
                {" "}
                · last statement{" "}
                <span className="tabular-nums">{gap.lastPeriodId}</span>
                {" · "}
                <span className="tabular-nums">
                  {formatCad(gap.lastMarketValue)}
                </span>
              </span>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="pr-3 pb-2 font-medium">Month</th>
                    <th className="pr-3 pb-2 font-medium">Ending value</th>
                    <th className="pr-3 pb-2 font-medium">Deposits</th>
                    <th className="pr-3 pb-2 font-medium">Withdrawals</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {gap.missingPeriodIds.map((periodId) => {
                    const est = estimates[gap.accountId]?.[periodId];
                    const def = defaults[gap.accountId]?.[periodId];
                    const dirty =
                      est != null &&
                      def != null &&
                      (est.marketValue !== def.marketValue ||
                        est.deposits !== def.deposits ||
                        est.withdrawals !== def.withdrawals);
                    return (
                      <tr key={periodId}>
                        <td className="py-1.5 pr-3 tabular-nums align-middle">
                          {periodId}
                        </td>
                        <td className="py-1.5 pr-3">
                          <input
                            type="number"
                            step={1}
                            className={fieldClassName()}
                            aria-label={`${gap.name} ${periodId} ending value`}
                            value={est?.marketValue ?? ""}
                            onChange={(e) =>
                              onChange(gap.accountId, periodId, {
                                marketValue: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td className="py-1.5 pr-3">
                          <input
                            type="number"
                            step={1}
                            min={0}
                            className={fieldClassName()}
                            aria-label={`${gap.name} ${periodId} deposits`}
                            value={est?.deposits ?? 0}
                            onChange={(e) =>
                              onChange(gap.accountId, periodId, {
                                deposits: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td className="py-1.5 pr-3">
                          <input
                            type="number"
                            step={1}
                            min={0}
                            className={fieldClassName()}
                            aria-label={`${gap.name} ${periodId} withdrawals`}
                            value={est?.withdrawals ?? 0}
                            onChange={(e) =>
                              onChange(gap.accountId, periodId, {
                                withdrawals: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td className="py-1.5 align-middle">
                          {dirty ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => onReset(gap.accountId, periodId)}
                            >
                              Reset
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              carried
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}
