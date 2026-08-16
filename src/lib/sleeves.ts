/**
 * Filter a windowed portfolio to one sleeve so both scores (same-paycheck
 * dollars and holdings CAGR) recompute on that account set only.
 */

import type { AccountGroupConfig } from "@/lib/config";
import type {
  Account,
  Period,
  PeriodCashFlows,
  PortfolioData,
} from "@/lib/types";

export const HOUSEHOLD_SLEEVE_ID = "household";
export const STOCK_PICK_SLEEVE_ID = "stock-pick";
export const TFSA_SLEEVE_ID = "tfsa";
export const FOUR_OH_ONE_K_SLEEVE_ID = "401k";

export type SleeveKind =
  | "household"
  | "stock-pick"
  | "tfsa"
  | "401k"
  | "group";

export interface SleeveOption {
  id: string;
  label: string;
  kind: SleeveKind;
  accountIds: string[];
}

const FOUR_OH_ONE_K = /401\s*\(?k\)?/i;

export function groupId(name: string): string {
  return `group:${name}`;
}

export function groupLooksLike401k(group: AccountGroupConfig): boolean {
  if (group.notTryingToBeatIndex === true) return true;
  return FOUR_OH_ONE_K.test(group.name);
}

export function accountLooksLike401k(account: Account): boolean {
  return FOUR_OH_ONE_K.test(account.id) || FOUR_OH_ONE_K.test(account.name);
}

export function emptyCashFlows(): PeriodCashFlows {
  return {
    deposits: 0,
    withdrawals: 0,
    dividends: 0,
    interest: 0,
    fees: 0,
    transfersIn: 0,
    transfersOut: 0,
  };
}

export function addCashFlows(
  a: PeriodCashFlows,
  b: PeriodCashFlows | undefined,
): PeriodCashFlows {
  if (!b) return { ...a };
  return {
    deposits: a.deposits + b.deposits,
    withdrawals: a.withdrawals + b.withdrawals,
    dividends: a.dividends + b.dividends,
    interest: a.interest + b.interest,
    fees: (a.fees ?? 0) + (b.fees ?? 0),
    transfersIn: (a.transfersIn ?? 0) + (b.transfersIn ?? 0),
    transfersOut: (a.transfersOut ?? 0) + (b.transfersOut ?? 0),
  };
}

export function notTryingAccountIds(
  data: PortfolioData,
  groups: AccountGroupConfig[],
): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    if (groupLooksLike401k(group)) {
      for (const id of group.memberIds) ids.add(id);
    }
  }
  for (const account of data.accounts) {
    if (accountLooksLike401k(account)) ids.add(account.id);
  }
  return ids;
}

function presentAccountIds(data: PortfolioData): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const consider = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };
  for (const account of data.accounts) consider(account.id);
  for (const period of data.periods) {
    for (const bal of period.balances) consider(bal.accountId);
  }
  return ordered;
}

/**
 * Household, stock-pick (excludes 401(k) / not-trying), TFSA, 401(k),
 * then each config account group that still has members in the extract.
 */
export function listSleeves(
  data: PortfolioData,
  groups: AccountGroupConfig[] = [],
): SleeveOption[] {
  const present = presentAccountIds(data);
  const presentSet = new Set(present);
  const notTrying = notTryingAccountIds(data, groups);
  const tfsaIds = data.accounts
    .filter((a) => a.type === "tfsa" && presentSet.has(a.id))
    .map((a) => a.id);
  const fourOhOneKIds = present.filter((id) => notTrying.has(id));
  const stockPickIds = present.filter((id) => !notTrying.has(id));

  const out: SleeveOption[] = [
    {
      id: HOUSEHOLD_SLEEVE_ID,
      label: "Household",
      kind: "household",
      accountIds: present,
    },
  ];

  if (
    stockPickIds.length > 0 &&
    stockPickIds.length < present.length
  ) {
    out.push({
      id: STOCK_PICK_SLEEVE_ID,
      label: "Stock picks",
      kind: "stock-pick",
      accountIds: stockPickIds,
    });
  }

  if (tfsaIds.length > 0) {
    out.push({
      id: TFSA_SLEEVE_ID,
      label: "TFSA",
      kind: "tfsa",
      accountIds: tfsaIds,
    });
  }

  if (fourOhOneKIds.length > 0) {
    out.push({
      id: FOUR_OH_ONE_K_SLEEVE_ID,
      label: "401(k)",
      kind: "401k",
      accountIds: fourOhOneKIds,
    });
  }

  for (const group of groups) {
    const members = group.memberIds.filter((id) => presentSet.has(id));
    if (members.length === 0) continue;
    out.push({
      id: groupId(group.name),
      label: group.name,
      kind: "group",
      accountIds: members,
    });
  }

  return out;
}

export function resolveSleeve(
  data: PortfolioData,
  sleeveId: string | undefined,
  groups: AccountGroupConfig[] = [],
): SleeveOption {
  const sleeves = listSleeves(data, groups);
  return (
    sleeves.find((s) => s.id === sleeveId) ??
    sleeves.find((s) => s.id === HOUSEHOLD_SLEEVE_ID) ??
    sleeves[0] ?? {
      id: HOUSEHOLD_SLEEVE_ID,
      label: "Household",
      kind: "household",
      accountIds: presentAccountIds(data),
    }
  );
}

/**
 * Household merge already parked account-to-account moves in
 * transfersIn/Out so deposits−withdrawals stay bank-external.
 * Comparison / TWRR only read deposits−withdrawals. On a subset sleeve,
 * a transfer that left the sleeve (TFSA → taxable) must become a
 * withdrawal, and a transfer that entered must become a deposit.
 * Intra-sleeve transfers net to zero and stay out of P&L.
 */
export function foldExternalTransfers(flows: PeriodCashFlows): PeriodCashFlows {
  const netOut = (flows.transfersOut ?? 0) - (flows.transfersIn ?? 0);
  return {
    ...flows,
    deposits: flows.deposits + (netOut < 0 ? -netOut : 0),
    withdrawals: flows.withdrawals + (netOut > 0 ? netOut : 0),
    transfersIn: 0,
    transfersOut: 0,
  };
}

export function isFullHouseholdSelection(
  data: PortfolioData,
  accountIds: Set<string>,
): boolean {
  const present = presentAccountIds(data);
  return (
    present.length === accountIds.size &&
    present.every((id) => accountIds.has(id))
  );
}

export function cashFlowsForAccounts(
  period: Period,
  accountIds: Set<string>,
  foldExternalTransfersIntoFlows = false,
): PeriodCashFlows {
  let sum: PeriodCashFlows;
  if (period.accountCashFlows) {
    sum = emptyCashFlows();
    for (const id of accountIds) {
      sum = addCashFlows(sum, period.accountCashFlows[id]);
    }
  } else {
    const present = period.balances.map((b) => b.accountId);
    const selectingAll =
      present.length > 0 && present.every((id) => accountIds.has(id));
    sum = selectingAll ? { ...period.cashFlows } : emptyCashFlows();
  }
  return foldExternalTransfersIntoFlows ? foldExternalTransfers(sum) : sum;
}

/**
 * Rewrite balances, holdings, totals, and external flows to the sleeve.
 * Existing comparison / series builders then run unchanged.
 */
export function filterPortfolioToSleeve(
  data: PortfolioData,
  sleeve: Pick<SleeveOption, "accountIds">,
): PortfolioData {
  const keep = new Set(sleeve.accountIds);
  const foldTransfers = !isFullHouseholdSelection(data, keep);
  return {
    ...data,
    accounts: data.accounts.filter((a) => keep.has(a.id)),
    periods: data.periods.map((period) => {
      const balances = period.balances.filter((b) => keep.has(b.accountId));
      const totalNetWorth = balances.reduce((s, b) => s + b.marketValue, 0);
      const accountCashFlows = period.accountCashFlows
        ? Object.fromEntries(
            Object.entries(period.accountCashFlows).filter(([id]) =>
              keep.has(id),
            ),
          )
        : undefined;
      const fxRates = period.fxRates
        ? Object.fromEntries(
            Object.entries(period.fxRates).filter(([id]) => keep.has(id)),
          )
        : undefined;
      return {
        ...period,
        balances,
        totalNetWorth,
        cashFlows: cashFlowsForAccounts(period, keep, foldTransfers),
        accountCashFlows,
        holdings: period.holdings?.filter((h) => keep.has(h.accountId)),
        transactions: period.transactions?.filter((t) => keep.has(t.accountId)),
        fxRates,
      };
    }),
  };
}
