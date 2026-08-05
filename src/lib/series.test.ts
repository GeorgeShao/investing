import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCashFlowSeries,
  buildHoldingWeightSeries,
  buildNetWorthSeries,
  CASH_INSTRUMENT_ID,
  findNetWorthMismatches,
  getActiveAccounts,
  holdingMarketValueCad,
  instrumentIdentity,
  periodCashCad,
  sliceFromFirstPositiveNetWorth,
  sliceFromPeriodId,
  sumDeposits,
  sumWithdrawals,
} from "@/lib/series";
import type { HoldingSnapshot, Period, PortfolioData } from "@/lib/types";

/** Minimal multi-period fixture (no sample-portfolio.json in repo). */
function syntheticPortfolio(): PortfolioData {
  return {
    meta: { schemaVersion: 2, currency: "CAD", generatedAt: "test" },
    accounts: [
      {
        id: "ws-example1cad",
        name: "WS Non-Registered (CAD)",
        institution: "Wealthsimple",
        type: "non_registered",
        currency: "CAD",
        status: "active",
        color: "#6366f1",
      },
      {
        id: "ws-example1usd",
        name: "WS Non-Registered (USD)",
        institution: "Wealthsimple",
        type: "non_registered",
        currency: "USD",
        status: "active",
        color: "#818cf8",
      },
      {
        id: "qt-examplemargin",
        name: "QT Margin",
        institution: "Questrade",
        type: "margin",
        currency: "CAD",
        status: "active",
        color: "#ef4444",
      },
    ],
    periods: [
      {
        id: "2022-02",
        label: "Feb 2022",
        startDate: "2022-02-01",
        endDate: "2022-02-28",
        balances: [
          { accountId: "ws-example1cad", marketValue: 5000, cash: 100 },
          { accountId: "ws-example1usd", marketValue: 2000, cash: 50 },
          { accountId: "qt-examplemargin", marketValue: 0 },
        ],
        totalNetWorth: 7000,
        cashFlows: {
          deposits: 7000,
          withdrawals: 0,
          dividends: 0,
          interest: 0,
        },
        holdings: [
          {
            accountId: "ws-example1cad",
            symbol: "XEQT",
            marketValue: 4900,
            currency: "CAD",
          },
        ],
      },
      {
        id: "2023-05",
        label: "May 2023",
        startDate: "2023-05-01",
        endDate: "2023-05-31",
        balances: [
          { accountId: "ws-example1cad", marketValue: 8000, cash: 200 },
          { accountId: "ws-example1usd", marketValue: 3500, cash: 100 },
          { accountId: "qt-examplemargin", marketValue: 1000, cash: 50 },
        ],
        totalNetWorth: 12500,
        cashFlows: {
          deposits: 2000,
          withdrawals: 0,
          dividends: 20,
          interest: 0,
        },
        holdings: [
          {
            accountId: "ws-example1cad",
            symbol: "XEQT",
            marketValue: 7800,
            currency: "CAD",
          },
          {
            accountId: "ws-example1usd",
            symbol: "VOO",
            marketValue: 2500,
            currency: "USD",
          },
        ],
        fxRates: { "ws-example1usd": 1.35 },
      },
      {
        id: "2023-06",
        label: "Jun 2023",
        startDate: "2023-06-01",
        endDate: "2023-06-30",
        balances: [
          { accountId: "ws-example1cad", marketValue: 8200, cash: 200 },
          { accountId: "ws-example1usd", marketValue: 3600, cash: 100 },
          { accountId: "qt-examplemargin", marketValue: 1100, cash: 50 },
        ],
        totalNetWorth: 12900,
        cashFlows: {
          deposits: 100,
          withdrawals: 50,
          dividends: 22,
          interest: 0,
        },
        holdings: [
          {
            accountId: "ws-example1cad",
            symbol: "XEQT",
            marketValue: 8000,
            currency: "CAD",
          },
        ],
        fxRates: { "ws-example1usd": 1.35 },
      },
    ],
  };
}

describe("synthetic portfolio fixture", () => {
  it("is valid investment-only multi-period data", () => {
    const data = syntheticPortfolio();
    expect(data.meta.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(data.meta.currency).toBe("CAD");
    expect(data.accounts.length).toBeGreaterThanOrEqual(2);
    expect(data.periods.length).toBeGreaterThanOrEqual(2);
    expect(findNetWorthMismatches(data)).toEqual([]);
  });

  it("covers config.example chart windows and account group ids", () => {
    const data = syntheticPortfolio();
    const cfgPath = resolve(__dirname, "../../config/config.example.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as {
      chartStartWindows: Array<{ id: string }>;
      accountGroups: Array<{ name: string; memberIds: string[] }>;
    };
    const periodIds = new Set(data.periods.map((p) => p.id));
    for (const w of cfg.chartStartWindows) {
      expect(periodIds.has(w.id)).toBe(true);
    }
    // Non-registered group from example (first group) should group correctly
    const nonReg = cfg.accountGroups.find((g) =>
      g.memberIds.includes("ws-example1cad"),
    );
    expect(nonReg).toBeTruthy();
    const series = buildNetWorthSeries(data, nonReg ? [nonReg] : []);
    if (nonReg) {
      expect(series.accounts.some((a) => a.name === nonReg.name)).toBe(true);
    }
  });
});

describe("sliceFromFirstPositiveNetWorth / sliceFromPeriodId", () => {
  it("drops leading zero-NW months", () => {
    const base = syntheticPortfolio();
    const withLead: PortfolioData = {
      ...base,
      periods: [
        {
          ...base.periods[0],
          id: "2022-01",
          label: "Jan 2022",
          totalNetWorth: 0,
          balances: base.periods[0].balances.map((b) => ({
            ...b,
            marketValue: 0,
          })),
        },
        ...base.periods,
      ],
    };
    const sliced = sliceFromFirstPositiveNetWorth(withLead);
    expect(sliced.periods[0].totalNetWorth).toBeGreaterThan(0);
    expect(sliced.periods[0].id).toBe(base.periods[0].id);
  });

  it("slices from configured start period id", () => {
    const data = syntheticPortfolio();
    const sliced = sliceFromPeriodId(data, "2023-05");
    expect(sliced.periods[0].id).toBe("2023-05");
    expect(sliced.periods.length).toBeLessThan(data.periods.length);
  });
});

describe("buildNetWorthSeries / buildCashFlowSeries", () => {
  it("builds aligned series from synthetic portfolio", () => {
    const data = syntheticPortfolio();
    const nw = buildNetWorthSeries(data);
    expect(nw.periodIds.length).toBe(data.periods.length);
    expect(nw.totals.length).toBe(data.periods.length);
    expect(nw.accounts.length).toBeGreaterThan(0);
    expect(nw.totals[nw.totals.length - 1]).toBe(
      data.periods[data.periods.length - 1].totalNetWorth,
    );

    const groups = [
      {
        name: "WS Non-Registered",
        memberIds: ["ws-example1cad", "ws-example1usd"],
      },
    ];
    const grouped = buildNetWorthSeries(data, groups);
    expect(grouped.accounts.some((a) => a.name === "WS Non-Registered")).toBe(
      true,
    );

    const cf = buildCashFlowSeries(data);
    expect(cf.deposits.length).toBe(data.periods.length);
    expect(sumDeposits(data)).toBe(
      data.periods.reduce((s, p) => s + p.cashFlows.deposits, 0),
    );
    expect(sumWithdrawals(data)).toBe(
      data.periods.reduce((s, p) => s + p.cashFlows.withdrawals, 0),
    );
  });
});

describe("holding weights", () => {
  it("builds equity and asset-mix series with cash instrument", () => {
    const data = syntheticPortfolio();
    const equity = buildHoldingWeightSeries(data, "equity");
    expect(equity.mode).toBe("equity");
    expect(equity.instruments.length).toBeGreaterThan(0);
    expect(equity.periodIds.length).toBe(data.periods.length);

    const mix = buildHoldingWeightSeries(data, "assetMix");
    expect(mix.mode).toBe("assetMix");
    for (let i = 0; i < mix.periodIds.length; i++) {
      if (mix.denominators[i] > 0) {
        const sum = mix.instruments.reduce((s, inst) => s + inst.weights[i], 0);
        expect(sum).toBeCloseTo(1, 5);
      }
    }
  });

  it("instrumentIdentity and CAD conversion helpers work", () => {
    const h: HoldingSnapshot = {
      accountId: "a",
      symbol: "XEQT",
      name: "iShares",
      marketValue: 100,
      currency: "CAD",
    };
    const id = instrumentIdentity(h);
    expect(id?.id).toBe("XEQT");
    expect(id?.isOption).toBe(false);

    const period: Period = {
      id: "2024-01",
      label: "Jan 2024",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      balances: [{ accountId: "a-usd", marketValue: 100, cash: 10 }],
      totalNetWorth: 100,
      cashFlows: { deposits: 0, withdrawals: 0, dividends: 0, interest: 0 },
      fxRates: { "a-usd": 1.35 },
    };
    const usdH: HoldingSnapshot = {
      accountId: "a-usd",
      symbol: "VOO",
      marketValue: 100,
      currency: "USD",
    };
    expect(holdingMarketValueCad(usdH, period)).toBeCloseTo(135, 5);
    expect(periodCashCad(period)).toBe(10);
    expect(CASH_INSTRUMENT_ID).toBe("CASH");
  });
});

describe("getActiveAccounts", () => {
  it("returns accounts with non-zero balances", () => {
    const data = syntheticPortfolio();
    const active = getActiveAccounts(data);
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((a) => a.id)).toBe(true);
  });
});

describe("optional data/data.json", () => {
  const path = resolve(__dirname, "../../data/data.json");
  const has = existsSync(path);

  it.runIf(has)("real extract matches net-worth invariant", () => {
    const data = JSON.parse(readFileSync(path, "utf8")) as PortfolioData;
    expect(findNetWorthMismatches(data)).toEqual([]);
  });
});
