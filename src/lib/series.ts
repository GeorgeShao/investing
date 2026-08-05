import type {
  Account,
  CashFlowSeries,
  HoldingSnapshot,
  HoldingWeightMode,
  HoldingWeightSeries,
  NetWorthSeries,
  Period,
  PortfolioData,
} from "@/lib/types";
import type { AccountGroupConfig, ChartStartWindow } from "@/lib/config";

export type { HoldingWeightMode };
export type AccountGroup = AccountGroupConfig;
export type ChartStartPeriodId = string;

const FALLBACK_COLORS = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#0ea5e9",
  "#a855f7",
  "#f97316",
  "#14b8a6",
  "#e11d48",
  "#65a30d",
  "#2563eb",
  "#d946ef",
  "#ca8a04",
  "#0891b2",
];

/**
 * Accounts that appear in at least one period balance, ordered by account list.
 */
export function getActiveAccounts(data: PortfolioData): Account[] {
  const seen = new Set<string>();
  for (const period of data.periods) {
    for (const bal of period.balances) {
      if (bal.marketValue !== 0) seen.add(bal.accountId);
    }
  }
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const ordered: Account[] = [];
  for (const account of data.accounts) {
    if (seen.has(account.id)) ordered.push(account);
  }
  for (const id of seen) {
    if (!byId.has(id)) {
      ordered.push({
        id,
        name: id,
        institution: "Unknown",
        type: "other",
        currency: data.meta.currency,
        status: "active",
      });
    }
  }
  return ordered;
}

function colorFor(account: Account, index: number): string {
  return account.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function balanceFor(period: Period, accountId: string): number {
  const row = period.balances.find((b) => b.accountId === accountId);
  return row?.marketValue ?? 0;
}

/**
 * Build stacked-bar + total trajectory series for Net Worth Over Time.
 * Pass accountGroups to render several accounts as one combined series.
 */
export function buildNetWorthSeries(
  data: PortfolioData,
  accountGroups: AccountGroup[] = [],
): NetWorthSeries {
  const periods = data.periods;
  const accounts = getActiveAccounts(data);

  const groupByMemberId = new Map<string, AccountGroup>();
  for (const group of accountGroups) {
    for (const id of group.memberIds) groupByMemberId.set(id, group);
  }

  const emitted = new Set<AccountGroup>();
  const accountSeries: NetWorthSeries["accounts"] = [];
  accounts.forEach((account, index) => {
    const group = groupByMemberId.get(account.id);
    if (!group) {
      accountSeries.push({
        id: account.id,
        name: account.name,
        color: colorFor(account, index),
        values: periods.map((p) => balanceFor(p, account.id)),
      });
      return;
    }
    if (emitted.has(group)) return;
    emitted.add(group);
    const members = accounts.filter((a) => group.memberIds.includes(a.id));
    accountSeries.push({
      id: members.map((m) => m.id).join("+"),
      name: group.name,
      color: colorFor(account, index),
      values: periods.map((p) =>
        members.reduce((sum, m) => sum + balanceFor(p, m.id), 0),
      ),
    });
  });

  return {
    periods: periods.map((p) => p.label),
    periodIds: periods.map((p) => p.id),
    accounts: accountSeries,
    totals: periods.map((p) => p.totalNetWorth),
  };
}

/**
 * Build deposits vs withdrawals (and net) series for Cash Flows Over Time.
 */
export function buildCashFlowSeries(data: PortfolioData): CashFlowSeries {
  const periods = data.periods;
  return {
    periods: periods.map((p) => p.label),
    periodIds: periods.map((p) => p.id),
    deposits: periods.map((p) => p.cashFlows.deposits),
    withdrawals: periods.map((p) => p.cashFlows.withdrawals),
    net: periods.map(
      (p) => p.cashFlows.deposits - p.cashFlows.withdrawals,
    ),
    dividends: periods.map((p) => p.cashFlows.dividends),
    interest: periods.map((p) => p.cashFlows.interest),
  };
}

export function latestPeriod(data: PortfolioData): Period | undefined {
  if (data.periods.length === 0) return undefined;
  return data.periods[data.periods.length - 1];
}

export function formatCurrency(
  value: number,
  currency = "CAD",
  maximumFractionDigits = 0,
): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).format(value);
}

export function sumDeposits(data: PortfolioData): number {
  return data.periods.reduce((s, p) => s + p.cashFlows.deposits, 0);
}

export function sumWithdrawals(data: PortfolioData): number {
  return data.periods.reduce((s, p) => s + p.cashFlows.withdrawals, 0);
}

/**
 * Verify totalNetWorth matches sum of balances for each period.
 * Returns period ids that fail.
 */
export function findNetWorthMismatches(
  data: PortfolioData,
  epsilon = 0.02,
): string[] {
  return data.periods
    .filter((p) => {
      const sum = p.balances.reduce((s, b) => s + b.marketValue, 0);
      return Math.abs(sum - p.totalNetWorth) > epsilon;
    })
    .map((p) => p.id);
}

/**
 * Drop leading empty months (totalNetWorth === 0) so charts start at the
 * first month with invested capital. Full extract history remains on disk.
 */
export function sliceFromFirstPositiveNetWorth(
  data: PortfolioData,
): PortfolioData {
  const idx = data.periods.findIndex((p) => p.totalNetWorth > 0);
  if (idx <= 0) return data;
  return {
    ...data,
    periods: data.periods.slice(idx),
  };
}

/**
 * Keep periods from `fromPeriodId` onward (inclusive).
 * If that id is missing, uses the first period with id >= fromPeriodId.
 */
export function sliceFromPeriodId(
  data: PortfolioData,
  fromPeriodId: string,
): PortfolioData {
  if (data.periods.length === 0) return data;
  let idx = data.periods.findIndex((p) => p.id === fromPeriodId);
  if (idx < 0) {
    idx = data.periods.findIndex((p) => p.id >= fromPeriodId);
  }
  if (idx < 0) return data;
  if (idx === 0) return data;
  return {
    ...data,
    periods: data.periods.slice(idx),
  };
}

/** OCC-style option root embedded in a holding name, e.g. AMD 260618C00270000. */
const OCC_IN_NAME = /\b([A-Z]{1,6})\s+(\d{6}[CP]\d{8})\b/;

/** Known PDF parse noise that is not a real equity/option position. */
const HOLDING_NOISE = new Set(["CAD|UNIT", "CLASS|ETF"]);

export interface InstrumentIdentity {
  id: string;
  name: string;
  isOption: boolean;
}

/**
 * Stable id for a holding row: OCC option root when present, else ticker.
 */
export function instrumentIdentity(
  h: HoldingSnapshot,
): InstrumentIdentity | null {
  const symbol = (h.symbol ?? "").trim().toUpperCase();
  const name = (h.name ?? "").trim();
  const noiseKey = `${symbol}|${name.toUpperCase()}`;
  if (HOLDING_NOISE.has(noiseKey)) return null;

  const occ = name.match(OCC_IN_NAME);
  if (occ) {
    const root = `${occ[1]} ${occ[2]}`;
    return { id: root, name: root, isOption: true };
  }
  if (/^[A-Z]{1,6}\s+\d{6}[CP]\d{8}$/.test(symbol)) {
    return { id: symbol, name: symbol, isOption: true };
  }
  if (!symbol || symbol.length > 12) return null;
  return {
    id: symbol,
    name: name && !name.includes(symbol) ? `${symbol} · ${name}` : symbol,
    isOption: false,
  };
}

function fxRateForHolding(
  period: Period,
  accountId: string,
): number | undefined {
  const rates = period.fxRates;
  if (!rates) return undefined;
  if (rates[accountId] != null && rates[accountId]! > 0) {
    return rates[accountId];
  }
  for (const v of Object.values(rates)) {
    if (typeof v === "number" && v > 1.05 && v < 1.8) return v;
  }
  return undefined;
}

/**
 * Holding market value in portfolio CAD. USD rows converted with period FX.
 */
export function holdingMarketValueCad(
  h: HoldingSnapshot,
  period: Period,
): number {
  const mv = h.marketValue ?? 0;
  if (!Number.isFinite(mv) || mv === 0) return 0;

  const ccy = (h.currency ?? "").toUpperCase();
  const usdSleeve = h.accountId.toLowerCase().endsWith("usd");
  const needsFx = ccy === "USD" || (ccy !== "CAD" && usdSleeve);
  if (!needsFx) return mv;

  const fx = fxRateForHolding(period, h.accountId);
  return fx ? mv * fx : mv;
}

/** Synthetic series id for cash summed from balances[].cash (CAD). */
export const CASH_INSTRUMENT_ID = "CASH";

const CASH_COLOR = "#94a3b8";

/**
 * Sum statement cash across accounts for a period.
 */
export function periodCashCad(period: Period): number {
  let sum = 0;
  for (const bal of period.balances) {
    const c = bal.cash;
    if (typeof c === "number" && Number.isFinite(c) && c > 0) {
      sum += c;
    }
  }
  return sum;
}

/**
 * Build stacked weight series for each stock/option plus cash.
 */
export function buildHoldingWeightSeries(
  data: PortfolioData,
  mode: HoldingWeightMode = "equity",
): HoldingWeightSeries {
  const periods = data.periods;
  const meta = new Map<
    string,
    { name: string; isOption: boolean; isCash?: boolean }
  >();
  const valueByPeriod = periods.map(() => new Map<string, number>());

  periods.forEach((period, i) => {
    const map = valueByPeriod[i];

    for (const h of period.holdings ?? []) {
      const identity = instrumentIdentity(h);
      if (!identity) continue;
      const cad = holdingMarketValueCad(h, period);
      if (cad === 0) continue;
      meta.set(identity.id, {
        name: identity.name,
        isOption: identity.isOption,
      });
      map.set(identity.id, (map.get(identity.id) ?? 0) + cad);
    }

    const cash = periodCashCad(period);
    if (cash > 0) {
      meta.set(CASH_INSTRUMENT_ID, {
        name: "Cash",
        isOption: false,
        isCash: true,
      });
      map.set(CASH_INSTRUMENT_ID, cash);
    }
  });

  const assetTotals = valueByPeriod.map((map) => {
    let s = 0;
    for (const v of map.values()) s += v;
    return s;
  });

  const denominators = periods.map((period, i) => {
    if (mode === "assetMix") return assetTotals[i];
    return period.totalNetWorth > 0 ? period.totalNetWorth : 0;
  });

  const ids = [...meta.keys()];
  const peakValue = new Map<string, number>();
  for (const id of ids) {
    let peak = 0;
    for (let i = 0; i < periods.length; i++) {
      const v = valueByPeriod[i].get(id) ?? 0;
      if (v > peak) peak = v;
    }
    peakValue.set(id, peak);
  }

  const securities = ids
    .filter((id) => id !== CASH_INSTRUMENT_ID && (peakValue.get(id) ?? 0) > 0)
    .sort((a, b) => (peakValue.get(b) ?? 0) - (peakValue.get(a) ?? 0));

  const ordered =
    meta.has(CASH_INSTRUMENT_ID) && (peakValue.get(CASH_INSTRUMENT_ID) ?? 0) > 0
      ? [CASH_INSTRUMENT_ID, ...securities]
      : securities;

  const instruments: HoldingWeightSeries["instruments"] = ordered.map(
    (id, index) => {
      const m = meta.get(id)!;
      const isCash = m.isCash === true;
      const colorIndex = isCash
        ? 0
        : meta.has(CASH_INSTRUMENT_ID)
          ? index - 1
          : index;
      return {
        id,
        name: isCash
          ? "Cash"
          : m.isOption
            ? m.name
            : (m.name.split(" · ")[0] ?? m.name),
        isOption: m.isOption,
        isCash,
        color: isCash
          ? CASH_COLOR
          : FALLBACK_COLORS[Math.max(0, colorIndex) % FALLBACK_COLORS.length],
        weights: periods.map((_, i) => {
          const denom = denominators[i];
          if (!(denom > 0)) return 0;
          return (valueByPeriod[i].get(id) ?? 0) / denom;
        }),
      };
    },
  );

  return {
    periods: periods.map((p) => p.label),
    periodIds: periods.map((p) => p.id),
    mode,
    denominators,
    totals: periods.map((p) => p.totalNetWorth),
    instruments,
  };
}

/** Re-export window type for UI components. */
export type { ChartStartWindow };
