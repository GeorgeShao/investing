import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyEstimates,
  defaultEstimates,
  findTrailingGaps,
  mergeEstimates,
  nextPeriodId,
  periodIdsAfterThrough,
} from "@/lib/estimates";
import { monthlyDollarPnL } from "@/lib/performance";
import type { Account, Period, PortfolioData } from "@/lib/types";

function account(id: string, name = id): Account {
  return {
    id,
    name,
    institution: "Questrade",
    type: "rrsp",
    currency: "CAD",
    status: "active",
  };
}

function period(
  id: string,
  balances: Array<{ accountId: string; marketValue: number }>,
  flows: { deposits?: number; withdrawals?: number } = {},
): Period {
  return {
    id,
    label: id,
    startDate: `${id}-01`,
    endDate: `${id}-28`,
    balances,
    totalNetWorth: balances.reduce((s, b) => s + b.marketValue, 0),
    cashFlows: {
      deposits: flows.deposits ?? 0,
      withdrawals: flows.withdrawals ?? 0,
      dividends: 0,
      interest: 0,
    },
  };
}

function portfolio(accounts: Account[], periods: Period[]): PortfolioData {
  return {
    meta: { schemaVersion: 2, currency: "CAD", generatedAt: "t" },
    accounts,
    periods,
  };
}

describe("period id helpers", () => {
  it("walks across a year boundary", () => {
    expect(nextPeriodId("2025-12")).toBe("2026-01");
    expect(periodIdsAfterThrough("2026-05", "2026-07")).toEqual([
      "2026-06",
      "2026-07",
    ]);
  });
});

describe("findTrailingGaps + defaultEstimates", () => {
  it("fills every month after last seen through the latest period", () => {
    const data = portfolio(
      [account("qt-rrsp", "QT RRSP"), account("fid")],
      [
        period("2026-05", [
          { accountId: "qt-rrsp", marketValue: 16000 },
          { accountId: "fid", marketValue: 100 },
        ]),
        period("2026-07", [{ accountId: "fid", marketValue: 120000 }]),
      ],
    );
    const gaps = findTrailingGaps(data);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].accountId).toBe("qt-rrsp");
    expect(gaps[0].missingPeriodIds).toEqual(["2026-06", "2026-07"]);
    const defaults = defaultEstimates(gaps);
    expect(defaults["qt-rrsp"]["2026-06"].marketValue).toBe(16000);
    expect(defaults["qt-rrsp"]["2026-07"].deposits).toBe(0);
    expect(defaults["qt-rrsp"]["2026-07"].withdrawals).toBe(0);
  });

  it("does not flag an account present in the latest month", () => {
    const data = portfolio(
      [account("qt-rrsp")],
      [
        period("2026-06", [{ accountId: "qt-rrsp", marketValue: 100 }]),
        period("2026-07", [{ accountId: "qt-rrsp", marketValue: 110 }]),
      ],
    );
    expect(findTrailingGaps(data)).toEqual([]);
  });
});

describe("applyEstimates", () => {
  it("adds the carried balance so July P&L is not a fake disappearance", () => {
    const data = portfolio(
      [account("qt-rrsp"), account("fid")],
      [
        period("2026-06", [
          { accountId: "qt-rrsp", marketValue: 16794 },
          { accountId: "fid", marketValue: 69 },
        ]),
        period(
          "2026-07",
          [{ accountId: "fid", marketValue: 121000 }],
          { deposits: 127000 },
        ),
      ],
    );
    const gaps = findTrailingGaps(data);
    const estimated = applyEstimates(data, defaultEstimates(gaps));
    const jun = estimated.periods[0];
    const jul = estimated.periods[1];
    const rrsp = jul.balances.find((b) => b.accountId === "qt-rrsp");
    expect(rrsp?.estimated).toBe(true);
    expect(rrsp?.marketValue).toBe(16794);
    expect(jul.totalNetWorth).toBe(121000 + 16794);
    const pnl = monthlyDollarPnL(
      jun.totalNetWorth,
      jul.totalNetWorth,
      jul.cashFlows.deposits,
      jul.cashFlows.withdrawals,
    );
    const pnlWithout = monthlyDollarPnL(
      data.periods[0].totalNetWorth,
      data.periods[1].totalNetWorth,
      data.periods[1].cashFlows.deposits,
      data.periods[1].cashFlows.withdrawals,
    );
    expect(pnlWithout).toBeCloseTo(121000 - 16863 - 127000, 0);
    expect(pnl).toBeCloseTo(pnlWithout + 16794, 0);
  });

  it("creates an intermediate month that has no period row yet", () => {
    const data = portfolio(
      [account("qt-rrsp"), account("fid")],
      [
        period("2026-05", [{ accountId: "qt-rrsp", marketValue: 16000 }]),
        period("2026-07", [{ accountId: "fid", marketValue: 1000 }]),
      ],
    );
    const estimated = applyEstimates(data, defaultEstimates(findTrailingGaps(data)));
    expect(estimated.periods.map((p) => p.id)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
    expect(
      estimated.periods[1].balances.find((b) => b.accountId === "qt-rrsp")
        ?.marketValue,
    ).toBe(16000);
  });

  it("adds typed deposits onto the month's existing external flows", () => {
    const data = portfolio(
      [account("qt-rrsp"), account("fid")],
      [
        period("2026-06", [{ accountId: "qt-rrsp", marketValue: 100 }]),
        period("2026-07", [{ accountId: "fid", marketValue: 50 }], {
          deposits: 10,
        }),
      ],
    );
    const estimated = applyEstimates(data, {
      "qt-rrsp": {
        "2026-07": { marketValue: 200, deposits: 25, withdrawals: 5 },
      },
    });
    expect(estimated.periods[1].cashFlows.deposits).toBe(35);
    expect(estimated.periods[1].cashFlows.withdrawals).toBe(5);
  });

  it("drops stale overrides after the statement month is no longer missing", () => {
    const defaults = {
      "qt-rrsp": { "2026-07": { marketValue: 1, deposits: 0, withdrawals: 0 } },
    };
    const overrides = {
      "qt-rrsp": { "2026-07": { marketValue: 9, deposits: 1, withdrawals: 0 } },
      "qt-rrsp-old": {
        "2026-06": { marketValue: 8, deposits: 0, withdrawals: 0 },
      },
    };
    const merged = mergeEstimates(defaults, overrides);
    expect(merged["qt-rrsp"]["2026-07"].marketValue).toBe(9);
    expect(merged["qt-rrsp-old"]).toBeUndefined();
  });
});

describe("real extract", () => {
  const path = resolve(__dirname, "../../data/data.json");
  it.runIf(existsSync(path))(
    "carries QT RRSP into July at the June statement value",
    () => {
      const data = JSON.parse(readFileSync(path, "utf8")) as PortfolioData;
      const gaps = findTrailingGaps(data);
      const qt = gaps.find((g) => g.accountId === "qt-53511380");
      expect(qt).toBeDefined();
      expect(qt!.lastPeriodId).toBe("2026-06");
      expect(qt!.missingPeriodIds).toContain("2026-07");
      const estimated = applyEstimates(data, defaultEstimates(gaps));
      const jul = estimated.periods.find((p) => p.id === "2026-07");
      const row = jul?.balances.find((b) => b.accountId === "qt-53511380");
      expect(row?.marketValue).toBeCloseTo(qt!.lastMarketValue, 2);
      expect(row?.estimated).toBe(true);
    },
  );
});
