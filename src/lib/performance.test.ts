import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMonthlyPnLSeries,
  buildMwrrCashFlows,
  cagrFromTotalReturn,
  computeReturnStats,
  computeYearlyReturns,
  externalNetFlow,
  irrPeriodic,
  linkTwrr,
  monthlyDollarPnL,
  monthlyTwrr,
} from "@/lib/performance";
import type { PortfolioData } from "@/lib/types";

function syntheticPortfolio(): PortfolioData {
  // V: 100 → 120 with +10 deposit → P&L = 10; then 120 → 110 with −5 withdrawal → P&L = −5
  return {
    meta: { schemaVersion: 1, currency: "CAD", generatedAt: "test" },
    accounts: [
      {
        id: "a",
        name: "A",
        institution: "Test",
        type: "non_registered",
        currency: "CAD",
        status: "active",
      },
    ],
    periods: [
      {
        id: "2024-01",
        label: "Jan 2024",
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        balances: [{ accountId: "a", marketValue: 100 }],
        totalNetWorth: 100,
        cashFlows: {
          deposits: 100,
          withdrawals: 0,
          dividends: 0,
          interest: 0,
        },
      },
      {
        id: "2024-02",
        label: "Feb 2024",
        startDate: "2024-02-01",
        endDate: "2024-02-29",
        balances: [{ accountId: "a", marketValue: 120 }],
        totalNetWorth: 120,
        cashFlows: {
          deposits: 10,
          withdrawals: 0,
          dividends: 0,
          interest: 0,
        },
      },
      {
        id: "2024-03",
        label: "Mar 2024",
        startDate: "2024-03-01",
        endDate: "2024-03-31",
        balances: [{ accountId: "a", marketValue: 110 }],
        totalNetWorth: 110,
        cashFlows: {
          deposits: 0,
          withdrawals: 5,
          dividends: 0,
          interest: 0,
        },
      },
    ],
  };
}

describe("monthlyDollarPnL / monthlyTwrr", () => {
  it("uses P&L = ΔV − deposits + withdrawals", () => {
    // 100 → 120, deposit 10 → P&L 10
    expect(monthlyDollarPnL(100, 120, 10, 0)).toBe(10);
    // 120 → 110, withdraw 5 → P&L = −5
    expect(monthlyDollarPnL(120, 110, 0, 5)).toBe(-5);
    expect(externalNetFlow(10, 3)).toBe(7);
  });

  it("computes monthly TWRR as (V_t − F)/V_{t-1} − 1", () => {
    // (120 − 10) / 100 − 1 = 0.1
    expect(monthlyTwrr(100, 120, 10, 0)).toBeCloseTo(0.1, 10);
    // (110 − (−5)) / 120 − 1 = 115/120 − 1
    expect(monthlyTwrr(120, 110, 0, 5)).toBeCloseTo(115 / 120 - 1, 10);
    expect(monthlyTwrr(0, 50, 50, 0)).toBeNull();
  });
});

describe("buildMonthlyPnLSeries", () => {
  it("null first month then formula-driven values", () => {
    const data = syntheticPortfolio();
    const series = buildMonthlyPnLSeries(data);
    expect(series.pnl[0]).toBeNull();
    expect(series.twrrMonthly[0]).toBeNull();
    expect(series.pnl[1]).toBe(10);
    expect(series.twrrMonthly[1]).toBeCloseTo(0.1, 10);
    expect(series.pnl[2]).toBe(-5);
    expect(series.twrrMonthly[2]).toBeCloseTo(115 / 120 - 1, 10);
  });
});

describe("linkTwrr + CAGR", () => {
  it("links monthly returns and annualizes", () => {
    const linked = linkTwrr([0.1, 115 / 120 - 1]);
    expect(linked).not.toBeNull();
    const expected = 1.1 * (115 / 120) - 1;
    expect(linked!).toBeCloseTo(expected, 10);
    const cagr = cagrFromTotalReturn(linked, 2);
    expect(cagr).toBeCloseTo(Math.pow(1 + expected, 12 / 2) - 1, 10);
  });
});

describe("irrPeriodic + MWRR cash flows", () => {
  it("solves a known two-period IRR", () => {
    // −100, +110 → 10%
    const r = irrPeriodic([-100, 110]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.1, 6);
  });

  it("builds investor cash flows −V0 … −F_t … +V_T", () => {
    const data = syntheticPortfolio();
    const cfs = buildMwrrCashFlows(data);
    // t0: -100
    expect(cfs[0]).toBe(-100);
    // t1: -10 deposit
    expect(cfs[1]).toBe(-10);
    // t2: -(-5) + 110 = 5 + 110 = 115
    expect(cfs[2]).toBe(115);
  });

  it("computeReturnStats returns finite stats for synthetic data", () => {
    const stats = computeReturnStats(syntheticPortfolio());
    expect(stats.monthCount).toBe(2);
    expect(stats.twrrTotal).not.toBeNull();
    expect(Number.isFinite(stats.twrrTotal!)).toBe(true);
    expect(stats.cagr).not.toBeNull();
    expect(Number.isFinite(stats.cagr!)).toBe(true);
    expect(stats.mwrrTotal).not.toBeNull();
    expect(Number.isFinite(stats.mwrrTotal!)).toBe(true);
    expect(stats.mwrrAnnualized).not.toBeNull();
    expect(Number.isFinite(stats.mwrrAnnualized!)).toBe(true);
  });
});

describe("computeYearlyReturns", () => {
  it("splits TWRR/MWRR by calendar year on synthetic multi-year data", () => {
    // Two full-ish years of simple growth, no flows after open
    const periods = [];
    let v = 1000;
    for (const [y, months] of [
      [2024, 12],
      [2025, 6],
    ] as const) {
      for (let m = 1; m <= months; m++) {
        const id = `${y}-${String(m).padStart(2, "0")}`;
        if (!(y === 2024 && m === 1)) {
          v = v * 1.01; // +1% per month when prior exists
        }
        periods.push({
          id,
          label: id,
          startDate: `${id}-01`,
          endDate: `${id}-28`,
          balances: [{ accountId: "a", marketValue: v }],
          totalNetWorth: v,
          cashFlows: {
            deposits: y === 2024 && m === 1 ? 1000 : 0,
            withdrawals: 0,
            dividends: 0,
            interest: 0,
          },
        });
      }
    }
    const data: PortfolioData = {
      meta: { schemaVersion: 1, currency: "CAD", generatedAt: "t" },
      accounts: [
        {
          id: "a",
          name: "A",
          institution: "T",
          type: "non_registered",
          currency: "CAD",
          status: "active",
        },
      ],
      periods,
    };
    const yearly = computeYearlyReturns(data);
    expect(yearly.map((r) => r.year)).toEqual([2024, 2025]);
    expect(yearly[0].isPartial).toBe(false);
    expect(yearly[1].isPartial).toBe(true);
    // 11 monthly +1% steps in 2024 after Jan (first month has no prior return in series if open is Jan)
    // first period is 2024-01: no TWRR; 2024-02..12 = 11 months of 1%
    expect(yearly[0].monthCount).toBe(11);
    expect(yearly[0].twrr).toBeCloseTo(Math.pow(1.01, 11) - 1, 8);
    expect(yearly[0].mwrr).not.toBeNull();
    expect(Number.isFinite(yearly[0].mwrr!)).toBe(true);
    expect(yearly[1].monthCount).toBe(6); // 2025-01 uses 2024-12 prior
    expect(yearly[1].twrr).toBeCloseTo(Math.pow(1.01, 6) - 1, 8);
  });
});

describe("performance on sample portfolio (shipped fixture)", () => {
  it("produces finite P&L and return stats from sample-portfolio.json", () => {
    const path = resolve(__dirname, "../../data/sample-portfolio.json");
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, "utf8")) as PortfolioData;
    const series = buildMonthlyPnLSeries(data);
    expect(series.pnl.length).toBe(data.periods.length);
    expect(series.pnl[0]).toBeNull();
    for (let i = 1; i < series.pnl.length; i++) {
      expect(series.pnl[i]).not.toBeNull();
      expect(Number.isFinite(series.pnl[i] as number)).toBe(true);
    }
    const stats = computeReturnStats(data);
    expect(stats.monthCount).toBeGreaterThan(0);
    expect(stats.twrrTotal).not.toBeNull();
    expect(Number.isFinite(stats.twrrTotal!)).toBe(true);
    expect(stats.mwrrTotal).not.toBeNull();
    expect(Number.isFinite(stats.mwrrTotal!)).toBe(true);
    const yearly = computeYearlyReturns(data);
    expect(yearly.length).toBeGreaterThan(0);
    for (const row of yearly) {
      if (row.twrr !== null) expect(Number.isFinite(row.twrr)).toBe(true);
      if (row.mwrr !== null) expect(Number.isFinite(row.mwrr)).toBe(true);
    }
  });
});
