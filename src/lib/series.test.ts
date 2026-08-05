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

function loadSample(): PortfolioData {
  const path = resolve(__dirname, "../../data/sample-portfolio.json");
  return JSON.parse(readFileSync(path, "utf8")) as PortfolioData;
}

describe("sample-portfolio.json (shipped fixture)", () => {
  it("is valid investment-only multi-period portfolio data", () => {
    const data = loadSample();

    expect(data.meta.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(data.meta.currency).toBe("CAD");
    expect(data.accounts.length).toBeGreaterThanOrEqual(2);
    expect(data.periods.length).toBeGreaterThanOrEqual(6);

    for (const account of data.accounts) {
      expect(account.id).toBeTruthy();
      expect(account.name).toBeTruthy();
      expect(account.institution).toBeTruthy();
      expect(["tfsa", "rrsp", "fhsa", "margin", "non_registered", "other"]).toContain(
        account.type,
      );
    }

    for (const period of data.periods) {
      expect(period.id).toMatch(/^\d{4}-\d{2}$/);
      expect(period.balances.length).toBeGreaterThan(0);
      expect(typeof period.totalNetWorth).toBe("number");
      expect(period.totalNetWorth).toBeGreaterThanOrEqual(0);
      expect(typeof period.cashFlows.deposits).toBe("number");
      expect(typeof period.cashFlows.withdrawals).toBe("number");
    }

    const mismatches = findNetWorthMismatches(data);
    expect(mismatches).toEqual([]);
  });
});

describe("sliceFromFirstPositiveNetWorth / sliceFromPeriodId", () => {
  it("drops leading zero-NW months", () => {
    const base = loadSample();
    const withLead: PortfolioData = {
      ...base,
      periods: [
        {
          ...base.periods[0],
          id: "2023-01",
          label: "Jan 2023",
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
    const data = loadSample();
    const mid = data.periods[Math.floor(data.periods.length / 2)].id;
    const sliced = sliceFromPeriodId(data, mid);
    expect(sliced.periods[0].id).toBe(mid);
    expect(sliced.periods.length).toBeLessThan(data.periods.length);
  });
});

describe("buildNetWorthSeries / buildCashFlowSeries", () => {
  it("builds aligned series from sample portfolio", () => {
    const data = loadSample();
    const nw = buildNetWorthSeries(data);
    expect(nw.periodIds.length).toBe(data.periods.length);
    expect(nw.totals.length).toBe(data.periods.length);
    expect(nw.accounts.length).toBeGreaterThan(0);
    expect(nw.totals[nw.totals.length - 1]).toBe(
      data.periods[data.periods.length - 1].totalNetWorth,
    );

    const groups = [
      {
        name: "Combined sample",
        memberIds: data.accounts.map((a) => a.id),
      },
    ];
    const grouped = buildNetWorthSeries(data, groups);
    expect(grouped.accounts.length).toBe(1);
    expect(grouped.accounts[0].name).toBe("Combined sample");

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
    const data = loadSample();
    const equity = buildHoldingWeightSeries(data, "equity");
    expect(equity.mode).toBe("equity");
    expect(equity.instruments.length).toBeGreaterThan(0);
    expect(equity.periodIds.length).toBe(data.periods.length);

    const mix = buildHoldingWeightSeries(data, "assetMix");
    expect(mix.mode).toBe("assetMix");
    // Asset mix weights should sum ~1 when denom > 0
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
    const data = loadSample();
    const active = getActiveAccounts(data);
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((a) => a.id)).toBe(true);
  });
});

describe("optional data/data.json", () => {
  const path = resolve(__dirname, "../../data/data.json");
  const has = existsSync(path);

  it.runIf(has)("real extract also matches net-worth invariant", () => {
    const data = JSON.parse(readFileSync(path, "utf8")) as PortfolioData;
    expect(findNetWorthMismatches(data)).toEqual([]);
  });
});
