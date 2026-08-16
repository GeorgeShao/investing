/**
 * Trailing-month estimates for accounts whose latest statement has not
 * arrived yet. Defaults carry the last known month-end value with $0 flows.
 * User edits are stored in the browser; data.json stays statement-only.
 */

import type { Account, Period, PortfolioData } from "@/lib/types";

export const ESTIMATE_STORAGE_KEY = "investing.account-month-estimates";

const POSITIVE_EPS = 0.005;

export interface MonthEstimate {
  marketValue: number;
  deposits: number;
  withdrawals: number;
}

/** accountId → periodId → estimate */
export type EstimateMap = Record<string, Record<string, MonthEstimate>>;

export interface TrailingGap {
  accountId: string;
  name: string;
  lastPeriodId: string;
  lastMarketValue: number;
  missingPeriodIds: string[];
}

export function nextPeriodId(periodId: string): string | null {
  const y = Number(periodId.slice(0, 4));
  const m = Number(periodId.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return null;
  }
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function periodIdsAfterThrough(
  lastSeenId: string,
  latestId: string,
): string[] {
  const out: string[] = [];
  let id = nextPeriodId(lastSeenId);
  while (id && id <= latestId) {
    out.push(id);
    id = nextPeriodId(id);
  }
  return out;
}

export function periodCalendarMeta(periodId: string): {
  label: string;
  startDate: string;
  endDate: string;
} {
  const y = Number(periodId.slice(0, 4));
  const m = Number(periodId.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return {
    label,
    startDate: `${periodId}-01`,
    endDate: `${periodId}-${String(lastDay).padStart(2, "0")}`,
  };
}

function lastBalance(
  periods: Period[],
  accountId: string,
): { periodId: string; marketValue: number } | null {
  for (let i = periods.length - 1; i >= 0; i--) {
    const row = periods[i].balances.find((b) => b.accountId === accountId);
    if (row) return { periodId: periods[i].id, marketValue: row.marketValue };
  }
  return null;
}

/**
 * Accounts with a positive last statement that do not appear in the latest
 * month. Missing months are every calendar month after last-seen through
 * the portfolio's latest period (inclusive).
 */
export function findTrailingGaps(data: PortfolioData): TrailingGap[] {
  const periods = data.periods;
  if (periods.length < 2) return [];
  const latestId = periods[periods.length - 1].id;
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const gaps: TrailingGap[] = [];

  const consider = (account: Account) => {
    if (account.status === "closed") return;
    const last = lastBalance(periods, account.id);
    if (!last || !(last.marketValue > POSITIVE_EPS)) return;
    if (last.periodId >= latestId) return;
    const missingPeriodIds = periodIdsAfterThrough(last.periodId, latestId);
    if (missingPeriodIds.length === 0) return;
    gaps.push({
      accountId: account.id,
      name: account.name || account.id,
      lastPeriodId: last.periodId,
      lastMarketValue: last.marketValue,
      missingPeriodIds,
    });
  };

  for (const account of data.accounts) {
    seen.add(account.id);
    consider(account);
  }
  for (const period of periods) {
    for (const bal of period.balances) {
      if (seen.has(bal.accountId)) continue;
      seen.add(bal.accountId);
      consider({
        id: bal.accountId,
        name: bal.accountId,
        institution: "",
        type: "other",
        currency: data.meta.currency,
        status: "active",
      });
    }
  }
  return gaps;
}

export function defaultEstimates(gaps: TrailingGap[]): EstimateMap {
  const map: EstimateMap = {};
  for (const gap of gaps) {
    map[gap.accountId] = {};
    for (const periodId of gap.missingPeriodIds) {
      map[gap.accountId][periodId] = {
        marketValue: gap.lastMarketValue,
        deposits: 0,
        withdrawals: 0,
      };
    }
  }
  return map;
}

/** Keep override months that are still missing; drop stale keys after extract. */
export function mergeEstimates(
  defaults: EstimateMap,
  overrides: EstimateMap,
): EstimateMap {
  const out: EstimateMap = {};
  for (const accountId of Object.keys(defaults)) {
    out[accountId] = { ...defaults[accountId] };
    const ov = overrides[accountId];
    if (!ov) continue;
    for (const periodId of Object.keys(defaults[accountId])) {
      if (ov[periodId]) {
        out[accountId][periodId] = sanitizeEstimate(
          ov[periodId],
          defaults[accountId][periodId],
        );
      }
    }
  }
  return out;
}

function sanitizeEstimate(
  raw: Partial<MonthEstimate>,
  fallback: MonthEstimate,
): MonthEstimate {
  const num = (v: unknown, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : d;
  return {
    marketValue: num(raw.marketValue, fallback.marketValue),
    deposits: num(raw.deposits, 0),
    withdrawals: num(raw.withdrawals, 0),
  };
}

export function estimateMapIsEmpty(map: EstimateMap): boolean {
  return Object.values(map).every((months) => Object.keys(months).length === 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyPeriod(periodId: string): Period {
  const meta = periodCalendarMeta(periodId);
  return {
    id: periodId,
    label: meta.label,
    startDate: meta.startDate,
    endDate: meta.endDate,
    balances: [],
    totalNetWorth: 0,
    cashFlows: {
      deposits: 0,
      withdrawals: 0,
      dividends: 0,
      interest: 0,
    },
  };
}

function clonePeriod(period: Period): Period {
  return {
    ...period,
    balances: period.balances.map((b) => ({ ...b })),
    cashFlows: { ...period.cashFlows },
    accountCashFlows: period.accountCashFlows
      ? Object.fromEntries(
          Object.entries(period.accountCashFlows).map(([id, f]) => [
            id,
            { ...f },
          ]),
        )
      : undefined,
    holdings: period.holdings?.map((h) => ({ ...h })),
    transactions: period.transactions?.map((t) => ({ ...t })),
  };
}

/**
 * Stitch estimates into a copy of the portfolio. Always call on statement
 * data, not on a previously estimated copy (flows would double-count).
 */
export function applyEstimates(
  data: PortfolioData,
  estimates: EstimateMap,
): PortfolioData {
  if (estimateMapIsEmpty(estimates)) return data;

  const periods = data.periods.map(clonePeriod);
  const byId = new Map(periods.map((p) => [p.id, p]));

  for (const [accountId, months] of Object.entries(estimates)) {
    for (const [periodId, est] of Object.entries(months)) {
      let period = byId.get(periodId);
      if (!period) {
        period = emptyPeriod(periodId);
        periods.push(period);
        byId.set(periodId, period);
      }
      period.balances = period.balances.filter((b) => b.accountId !== accountId);
      period.balances.push({
        accountId,
        marketValue: round2(est.marketValue),
        estimated: true,
      });
      period.cashFlows.deposits = round2(
        period.cashFlows.deposits + est.deposits,
      );
      period.cashFlows.withdrawals = round2(
        period.cashFlows.withdrawals + est.withdrawals,
      );
      period.accountCashFlows = {
        ...(period.accountCashFlows ?? {}),
        [accountId]: {
          deposits: round2(est.deposits),
          withdrawals: round2(est.withdrawals),
          dividends: 0,
          interest: 0,
          fees: 0,
        },
      };
      period.totalNetWorth = round2(
        period.balances.reduce((s, b) => s + b.marketValue, 0),
      );
    }
  }

  periods.sort((a, b) => a.id.localeCompare(b.id));
  return { ...data, periods };
}

export function loadStoredEstimates(): EstimateMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ESTIMATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { entries?: EstimateMap } | EstimateMap;
    if (parsed && typeof parsed === "object" && "entries" in parsed) {
      return parsed.entries ?? {};
    }
    return (parsed as EstimateMap) ?? {};
  } catch {
    return {};
  }
}

export function saveStoredEstimates(overrides: EstimateMap): void {
  if (typeof window === "undefined") return;
  try {
    if (estimateMapIsEmpty(overrides)) {
      window.localStorage.removeItem(ESTIMATE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      ESTIMATE_STORAGE_KEY,
      JSON.stringify({ version: 1, entries: overrides }),
    );
  } catch {
    // private mode / quota
  }
}

export function setMonthEstimate(
  map: EstimateMap,
  accountId: string,
  periodId: string,
  patch: Partial<MonthEstimate>,
): EstimateMap {
  return {
    ...map,
    [accountId]: {
      ...(map[accountId] ?? {}),
      [periodId]: {
        marketValue: patch.marketValue ?? map[accountId]?.[periodId]?.marketValue ?? 0,
        deposits: patch.deposits ?? map[accountId]?.[periodId]?.deposits ?? 0,
        withdrawals:
          patch.withdrawals ?? map[accountId]?.[periodId]?.withdrawals ?? 0,
      },
    },
  };
}

export function clearMonthEstimate(
  map: EstimateMap,
  accountId: string,
  periodId: string,
): EstimateMap {
  const months = { ...(map[accountId] ?? {}) };
  delete months[periodId];
  const next = { ...map };
  if (Object.keys(months).length === 0) delete next[accountId];
  else next[accountId] = months;
  return next;
}
