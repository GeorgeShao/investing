/**
 * Portfolio data schema for monthly statement extracts.
 * Extensible: add holdings, transactions, returns, etc. without breaking consumers.
 */

export type AccountType =
  | "non_registered"
  | "tfsa"
  | "rrsp"
  | "fhsa"
  | "margin"
  | "other";

export type AccountStatus = "active" | "closed" | "inactive";

export interface PortfolioMeta {
  schemaVersion: number;
  currency: string;
  generatedAt: string;
  description?: string;
  notes?: string[];
}

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  currency: string;
  openedAt?: string;
  status: AccountStatus;
  /** Preferred chart color (CSS hex). */
  color?: string;
  /** Broker account numbers / external ids from statement PDFs. */
  externalIds?: {
    accountNumber?: string;
    [key: string]: string | undefined;
  };
}

export interface AccountBalance {
  accountId: string;
  /** Month-end market value of cash + securities in portfolio base currency (CAD). */
  marketValue: number;
  cash?: number;
  bookCost?: number;
  /** Original statement total before CAD conversion (when nativeCurrency is USD). */
  nativeMarketValue?: number;
  nativeCurrency?: string;
}

export interface PeriodCashFlows {
  deposits: number;
  withdrawals: number;
  dividends: number;
  interest: number;
  fees?: number;
  transfersIn?: number;
  transfersOut?: number;
}

/** Optional holding snapshot for future position analytics. */
export interface HoldingSnapshot {
  accountId: string;
  symbol: string;
  name?: string | null;
  quantity?: number | null;
  marketPrice?: number | null;
  marketValue?: number | null;
  bookCost?: number | null;
  currency?: string | null;
}

/** Optional activity line for future trade analytics. */
export interface TransactionSnapshot {
  accountId: string;
  date?: string | null;
  code?: string | null;
  description?: string;
  debit?: number | null;
  credit?: number | null;
  balance?: number | null;
  symbol?: string | null;
  net?: number | null;
}

export interface Period {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  balances: AccountBalance[];
  /** Precomputed sum of balances; should equal sum of marketValue. */
  totalNetWorth: number;
  cashFlows: PeriodCashFlows;
  /** Extensibility: month-end holdings when extracted from statements. */
  holdings?: HoldingSnapshot[];
  /** Extensibility: activity ledger lines when extracted. */
  transactions?: TransactionSnapshot[];
  /** Per-account USD→CAD FX rates used for this period. */
  fxRates?: Record<string, number>;
}

export interface PortfolioData {
  meta: PortfolioMeta & {
    source?: {
      pdfRoot?: string;
      extractCount?: number;
      errorCount?: number;
    };
  };
  accounts: Account[];
  periods: Period[];
}

/** Chart series payload for net worth stacked bars + total line. */
export interface NetWorthSeries {
  periods: string[];
  periodIds: string[];
  accounts: Array<{
    id: string;
    name: string;
    color: string;
    values: number[];
  }>;
  totals: number[];
}

/** Chart series payload for deposits vs withdrawals. */
export interface CashFlowSeries {
  periods: string[];
  periodIds: string[];
  deposits: number[];
  withdrawals: number[];
  net: number[];
  dividends: number[];
  interest: number[];
}

/**
 * Position weight chart modes:
 * - equity: value / month-end net worth (may exceed 100% with margin)
 * - assetMix: value / sum(securities + cash) that month (always totals 100%)
 */
export type HoldingWeightMode = "equity" | "assetMix";

/** Chart series payload for per-instrument portfolio weight over time. */
export interface HoldingWeightSeries {
  periods: string[];
  periodIds: string[];
  mode: HoldingWeightMode;
  /**
   * Per-period denominator used for weights:
   * equity mode → totalNetWorth; assetMix → sum of plotted asset CAD values.
   */
  denominators: number[];
  /** Portfolio total net worth (CAD) per period (equity), for reference. */
  totals: number[];
  instruments: Array<{
    /** Stable id (ticker, OCC option root, or CASH). */
    id: string;
    /** Legend / tooltip label. */
    name: string;
    /** True when the instrument is an option contract. */
    isOption: boolean;
    /** True for aggregated cash across accounts (from balance.cash). */
    isCash?: boolean;
    color: string;
    /** Weight as fraction of the mode denominator (0–1+ in equity mode). */
    weights: number[];
  }>;
}
