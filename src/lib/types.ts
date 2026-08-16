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

export interface PortfolioWarning {
  code: string;
  periodId?: string;
  /** Latest portfolio month (for coverage gaps: the month the account is absent from). */
  latestPeriodId?: string;
  accountId?: string;
  accountNumber?: string;
  institution?: string;
  nativeMarketValue?: number;
  /** Last known market value in portfolio currency (CAD). */
  marketValue?: number;
  message: string;
}

export interface PortfolioMeta {
  schemaVersion: number;
  currency: string;
  generatedAt: string;
  description?: string;
  notes?: string[];
  /** Data-quality issues (e.g. USD balance with no exact-month USDCAD rate). */
  warnings?: PortfolioWarning[];
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
  /** True when this row is a user/carry-forward estimate, not a statement. */
  estimated?: boolean;
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
  /**
   * External cash flows per account (same units as `cashFlows`).
   * Household `cashFlows` should equal the sum of these rows.
   */
  accountCashFlows?: Record<string, PeriodCashFlows>;
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

/** Chart series payload for portfolio-value stacked bars + total. */
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
 * - equity: value / month-end portfolio value (may exceed 100% with margin)
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
  /** Portfolio total (CAD) per period (equity), for reference. */
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
