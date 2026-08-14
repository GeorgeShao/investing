/**
 * Data-quality checks that can run on an already-built portfolio document.
 * Extract-time warnings live on meta.warnings; these run again on load so a
 * new rule shows up without re-running the Python extract.
 */

import type { Account, Period, PortfolioData, PortfolioWarning } from "@/lib/types";

export const MISSING_LATEST_STATEMENT = "missing_latest_statement";

const POSITIVE_EPS = 0.005;

function lastBalance(
  periods: Period[],
  accountId: string,
): { periodId: string; marketValue: number } | null {
  for (let i = periods.length - 1; i >= 0; i--) {
    const row = periods[i].balances.find((b) => b.accountId === accountId);
    if (row) {
      return { periodId: periods[i].id, marketValue: row.marketValue };
    }
  }
  return null;
}

function presentInPeriod(period: Period, accountId: string): boolean {
  return period.balances.some((b) => b.accountId === accountId);
}

/**
 * Account had a positive month-end balance the last time it appeared, but
 * that month is not the portfolio's latest month — usually a missing
 * statement, not a closed account (a real close would typically show $0).
 */
export function findMissingLatestStatements(
  data: PortfolioData,
): PortfolioWarning[] {
  const periods = data.periods;
  if (periods.length < 2) return [];
  const latest = periods[periods.length - 1];
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const out: PortfolioWarning[] = [];

  for (const account of data.accounts) {
    seen.add(account.id);
    const warning = warningForAccount(account, periods, latest);
    if (warning) out.push(warning);
  }

  // Balances can mention ids that never made it into accounts[]
  for (const period of periods) {
    for (const bal of period.balances) {
      if (seen.has(bal.accountId)) continue;
      seen.add(bal.accountId);
      const stub: Account = {
        id: bal.accountId,
        name: bal.accountId,
        institution: "",
        type: "other",
        currency: data.meta.currency,
        status: "active",
      };
      const warning = warningForAccount(stub, periods, latest);
      if (warning) out.push(warning);
    }
  }

  return out;
}

function warningForAccount(
  account: Account,
  periods: Period[],
  latest: Period,
): PortfolioWarning | null {
  if (account.status === "closed") return null;
  if (presentInPeriod(latest, account.id)) return null;
  const last = lastBalance(periods, account.id);
  if (!last || !(last.marketValue > POSITIVE_EPS)) return null;
  if (last.periodId === latest.id) return null;

  const label = account.name || account.id;
  const lastMv = last.marketValue;
  return {
    code: MISSING_LATEST_STATEMENT,
    periodId: last.periodId,
    latestPeriodId: latest.id,
    accountId: account.id,
    accountNumber: account.externalIds?.accountNumber,
    institution: account.institution || undefined,
    marketValue: lastMv,
    message:
      `${label} had a positive month-end balance in ${last.periodId} ` +
      `(${lastMv.toLocaleString("en-CA", { maximumFractionDigits: 2 })}) ` +
      `but does not appear in ${latest.id}, the latest month in this extract. ` +
      `Portfolio totals and returns omit that account until a statement is added.`,
  };
}

/** Merge extract-time warnings with live checks; last write for a code+account wins. */
export function mergePortfolioWarnings(
  existing: PortfolioWarning[] | undefined,
  live: PortfolioWarning[],
): PortfolioWarning[] {
  const key = (w: PortfolioWarning) =>
    `${w.code}::${w.accountId ?? ""}::${w.periodId ?? ""}`;
  const map = new Map<string, PortfolioWarning>();
  for (const w of existing ?? []) map.set(key(w), w);
  for (const w of live) map.set(key(w), w);
  return [...map.values()];
}
