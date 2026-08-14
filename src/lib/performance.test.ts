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
  mwrrStatsForValues,
  simpleInvestedReturn,
  simpleReturnForValues,
  sumExternalFlowsAfter,
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

/** Modified Dietz: (V1 − V0 − F) / (V0 + 0.5 F) */
function dietz(
  v0: number,
  v1: number,
  deposits: number,
  withdrawals: number,
): number {
  const f = deposits - withdrawals;
  return (v1 - v0 - f) / (v0 + 0.5 * f);
}

describe("monthlyDollarPnL / monthlyTwrr (Modified Dietz)", () => {
  it("uses P&L = ΔV − deposits + withdrawals", () => {
    expect(monthlyDollarPnL(100, 120, 10, 0)).toBe(10);
    expect(monthlyDollarPnL(120, 110, 0, 5)).toBe(-5);
    expect(externalNetFlow(10, 3)).toBe(7);
  });

  it("matches Modified Dietz with mid-period flows", () => {
    // (120 − 100 − 10) / (100 + 5) = 10/105
    expect(monthlyTwrr(100, 120, 10, 0)).toBeCloseTo(dietz(100, 120, 10, 0), 10);
    // (110 − 120 − (−5)) / (120 + 0.5*(−5)) = (−5) / 117.5
    expect(monthlyTwrr(120, 110, 0, 5)).toBeCloseTo(dietz(120, 110, 0, 5), 10);
  });

  it("no-flow month reduces to simple return", () => {
    expect(monthlyTwrr(100, 110, 0, 0)).toBeCloseTo(0.1, 10);
  });

  it("null when average capital is non-positive", () => {
    // V0=0, no flow → denom 0
    expect(monthlyTwrr(0, 50, 0, 0)).toBeNull();
    // withdraw more than twice prior capital mid-period → denom ≤ 0
    expect(monthlyTwrr(100, 10, 0, 250)).toBeNull();
  });

  it("large mid-month deposit does not report sub-−100% when terminal NW is positive", () => {
    // Regression: end-of-period formula gave (121403 − 127583)/16863 − 1 ≈ −136%
    const v0 = 16862.93;
    const v1 = 121403.4;
    const dep = 127583.33;
    const wd = 0.57;
    const r = monthlyTwrr(v0, v1, dep, wd);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(dietz(v0, v1, dep, wd), 8);
    // Should be a moderate negative (market drag on capital), not < −100%
    expect(r!).toBeGreaterThan(-1);
    expect(r!).toBeLessThan(0);
    expect(r!).toBeCloseTo(-0.2857, 2);
  });

  it("large withdrawal month stays well-defined", () => {
    const v0 = 219035.77;
    const v1 = 16862.93;
    const dep = 12.87;
    const wd = 182077.55;
    const r = monthlyTwrr(v0, v1, dep, wd);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(-1);
    expect(r!).toBeCloseTo(dietz(v0, v1, dep, wd), 8);
  });
});

describe("buildMonthlyPnLSeries", () => {
  it("null first month then Dietz-driven values", () => {
    const data = syntheticPortfolio();
    const series = buildMonthlyPnLSeries(data);
    expect(series.pnl[0]).toBeNull();
    expect(series.twrrMonthly[0]).toBeNull();
    expect(series.pnl[1]).toBe(10);
    expect(series.twrrMonthly[1]).toBeCloseTo(dietz(100, 120, 10, 0), 10);
    expect(series.pnl[2]).toBe(-5);
    expect(series.twrrMonthly[2]).toBeCloseTo(dietz(120, 110, 0, 5), 10);
  });
});

describe("linkTwrr + CAGR", () => {
  it("links monthly returns and annualizes when 1+total > 0", () => {
    const r1 = dietz(100, 120, 10, 0);
    const r2 = dietz(120, 110, 0, 5);
    const linked = linkTwrr([r1, r2]);
    expect(linked).not.toBeNull();
    const expected = (1 + r1) * (1 + r2) - 1;
    expect(linked!).toBeCloseTo(expected, 10);
    const cagr = cagrFromTotalReturn(linked, 2);
    expect(cagr).toBeCloseTo(Math.pow(1 + expected, 12 / 2) - 1, 10);
  });

  it("CAGR is null when linked total ≤ −100%", () => {
    expect(cagrFromTotalReturn(-1, 12)).toBeNull();
    expect(cagrFromTotalReturn(-1.5, 12)).toBeNull();
    expect(cagrFromTotalReturn(0.5, 12)).toBeCloseTo(Math.pow(1.5, 1) - 1, 10);
  });
});

describe("irrPeriodic + MWRR cash flows", () => {
  it("solves a known two-period IRR", () => {
    const r = irrPeriodic([-100, 110]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.1, 6);
  });

  it("builds investor cash flows −V0 … −F_t … +V_T", () => {
    const data = syntheticPortfolio();
    const cfs = buildMwrrCashFlows(data);
    expect(cfs[0]).toBe(-100);
    expect(cfs[1]).toBe(-10);
    expect(cfs[2]).toBe(115);
  });

  it("MWRR total is (1+r_m)^intervals − 1 and ann is (1+r_m)^12 − 1", () => {
    // Flat 1% per month, no intermediate flows: −100, 0, 0, 103.0301...
    const v0 = 100;
    const months = 3;
    let v = v0;
    const periods = [];
    for (let m = 0; m <= months; m++) {
      if (m > 0) v *= 1.01;
      const id = `2024-${String(m + 1).padStart(2, "0")}`;
      periods.push({
        id,
        label: id,
        startDate: `${id}-01`,
        endDate: `${id}-28`,
        balances: [{ accountId: "a", marketValue: v }],
        totalNetWorth: v,
        cashFlows: {
          deposits: 0,
          withdrawals: 0,
          dividends: 0,
          interest: 0,
        },
      });
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
    const stats = computeReturnStats(data);
    // TWRR with no flows: pure product of 1% months
    expect(stats.twrrTotal).toBeCloseTo(Math.pow(1.01, months) - 1, 8);
    expect(stats.cagr).toBeCloseTo(Math.pow(1.01, 12) - 1, 6);
    // MWRR should match TWRR when no intermediate external flows
    expect(stats.mwrrTotal).toBeCloseTo(Math.pow(1.01, months) - 1, 6);
    expect(stats.mwrrAnnualized).toBeCloseTo(Math.pow(1.01, 12) - 1, 6);
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
    // Cross-check TWRR link manually
    const r1 = dietz(100, 120, 10, 0);
    const r2 = dietz(120, 110, 0, 5);
    expect(stats.twrrTotal!).toBeCloseTo((1 + r1) * (1 + r2) - 1, 10);
    expect(stats.cagr!).toBeCloseTo(
      Math.pow(1 + stats.twrrTotal!, 12 / 2) - 1,
      10,
    );
  });
});

describe("computeYearlyReturns", () => {
  it("splits TWRR/MWRR by calendar year on synthetic multi-year data", () => {
    const periods = [];
    let v = 1000;
    for (const [y, months] of [
      [2024, 12],
      [2025, 6],
    ] as const) {
      for (let m = 1; m <= months; m++) {
        const id = `${y}-${String(m).padStart(2, "0")}`;
        if (!(y === 2024 && m === 1)) {
          v = v * 1.01;
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
    expect(yearly[0].monthCount).toBe(11);
    expect(yearly[0].twrr).toBeCloseTo(Math.pow(1.01, 11) - 1, 8);
    expect(yearly[0].mwrr).not.toBeNull();
    expect(Number.isFinite(yearly[0].mwrr!)).toBe(true);
    expect(yearly[1].monthCount).toBe(6);
    expect(yearly[1].twrr).toBeCloseTo(Math.pow(1.01, 6) - 1, 8);
  });
});

describe("June withdraw + July deposit style path", () => {
  it("keeps linked TWRR > −100% and CAGR defined", () => {
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
      periods: [
        {
          id: "2026-05",
          label: "May 2026",
          startDate: "2026-05-01",
          endDate: "2026-05-31",
          balances: [{ accountId: "a", marketValue: 219035.77 }],
          totalNetWorth: 219035.77,
          cashFlows: {
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            interest: 0,
          },
        },
        {
          id: "2026-06",
          label: "Jun 2026",
          startDate: "2026-06-01",
          endDate: "2026-06-30",
          balances: [{ accountId: "a", marketValue: 16862.93 }],
          totalNetWorth: 16862.93,
          cashFlows: {
            deposits: 12.87,
            withdrawals: 182077.55,
            dividends: 0,
            interest: 0,
          },
        },
        {
          id: "2026-07",
          label: "Jul 2026",
          startDate: "2026-07-01",
          endDate: "2026-07-31",
          balances: [{ accountId: "a", marketValue: 121403.4 }],
          totalNetWorth: 121403.4,
          cashFlows: {
            deposits: 127583.33,
            withdrawals: 0.57,
            dividends: 0,
            interest: 0,
          },
        },
      ],
    };
    const stats = computeReturnStats(data);
    expect(stats.twrrTotal).not.toBeNull();
    // Old end-of-period math linked below −100%; Dietz must not
    expect(stats.twrrTotal!).toBeGreaterThan(-1);
    expect(stats.cagr).not.toBeNull();
    expect(Number.isFinite(stats.cagr!)).toBe(true);
    expect(stats.mwrrTotal).not.toBeNull();
    expect(stats.mwrrAnnualized).not.toBeNull();

    const series = buildMonthlyPnLSeries(data);
    expect(series.twrrMonthly[1]!).toBeGreaterThan(-1);
    expect(series.twrrMonthly[2]!).toBeGreaterThan(-1);
  });
});

describe("performance on optional data/data.json", () => {
  const path = resolve(__dirname, "../../data/data.json");
  const has = existsSync(path);

  it.runIf(has)("produces finite P&L and sensible return stats from extract", () => {
    const data = JSON.parse(readFileSync(path, "utf8")) as PortfolioData;
    // May 2023 window like the UI default
    const sliced: PortfolioData = {
      ...data,
      periods: data.periods.filter((p) => p.id >= "2023-05"),
    };
    const series = buildMonthlyPnLSeries(sliced);
    expect(series.pnl.length).toBe(sliced.periods.length);
    expect(series.pnl[0]).toBeNull();
    for (let i = 1; i < series.pnl.length; i++) {
      expect(series.pnl[i]).not.toBeNull();
      expect(Number.isFinite(series.pnl[i] as number)).toBe(true);
      const r = series.twrrMonthly[i];
      if (r !== null) {
        expect(Number.isFinite(r)).toBe(true);
        // No month should wipe more than 100% under Dietz when NW stayed positive
        if (sliced.periods[i].totalNetWorth > 0) {
          expect(r).toBeGreaterThan(-1.0000001);
        }
      }
    }
    const stats = computeReturnStats(sliced);
    expect(stats.monthCount).toBeGreaterThan(0);
    expect(stats.twrrTotal).not.toBeNull();
    expect(Number.isFinite(stats.twrrTotal!)).toBe(true);
    // With real data + Dietz, total should not be the absurd −184% path
    expect(stats.twrrTotal!).toBeGreaterThan(-1);
    if (stats.twrrTotal! > -1) {
      expect(stats.cagr).not.toBeNull();
      expect(Number.isFinite(stats.cagr!)).toBe(true);
    }
    expect(stats.mwrrTotal).not.toBeNull();
    expect(stats.mwrrAnnualized).not.toBeNull();
    const yearly = computeYearlyReturns(sliced);
    expect(yearly.length).toBeGreaterThan(0);
  });
});

describe("simpleInvestedReturn (brokerage homepage gain)", () => {
  it("is (end − start − netFlow) / (start + netFlow)", () => {
    // start 100, deposit 50, end 180 → gain 30, invested 150, rate 20%
    const r = simpleInvestedReturn(100, 180, 50, 0);
    expect(r.gain).toBe(30);
    expect(r.invested).toBe(150);
    expect(r.rate).toBeCloseTo(0.2, 10);
  });

  it("treats withdrawals as reducing invested capital", () => {
    // start 100, withdraw 20, end 90 → gain 10, invested 80
    const r = simpleInvestedReturn(100, 90, 0, 20);
    expect(r.gain).toBe(10);
    expect(r.invested).toBe(80);
    expect(r.rate).toBeCloseTo(0.125, 10);
  });

  it("is not (end − start) / start — deposits do not inflate the %", () => {
    const r = simpleInvestedReturn(100, 200, 100, 0);
    expect(r.gain).toBe(0);
    expect(r.rate).toBeCloseTo(0, 10);
    expect((200 - 100) / 100).toBe(1);
  });

  it("blanks the % when invested capital is not positive", () => {
    expect(simpleInvestedReturn(0, 10, 0, 0).rate).toBeNull();
    expect(simpleInvestedReturn(50, 10, 0, 80).rate).toBeNull();
    expect(simpleInvestedReturn(50, 10, 0, 80).gain).toBe(40);
  });

  it("sums flows after the opening snapshot, not the opening month itself", () => {
    const data = syntheticPortfolio();
    const flows = sumExternalFlowsAfter(data, 0, 2);
    expect(flows.deposits).toBe(10);
    expect(flows.withdrawals).toBe(5);
    const simple = simpleReturnForValues(
      data,
      data.periods.map((p) => p.totalNetWorth),
      0,
      2,
    );
    expect(simple).not.toBeNull();
    expect(simple!.start).toBe(100);
    expect(simple!.end).toBe(110);
    expect(simple!.gain).toBe(5); // 110 − 100 − 10 + 5
    expect(simple!.rate).toBeCloseTo(5 / 105, 10);
  });

  it("MWRR on the same values as the portfolio matches computeReturnStats", () => {
    const data = syntheticPortfolio();
    const fromStats = computeReturnStats(data);
    const fromValues = mwrrStatsForValues(
      data,
      data.periods.map((p) => p.totalNetWorth),
    );
    expect(fromValues.total).toBeCloseTo(fromStats.mwrrTotal!, 10);
    expect(fromValues.annualized).toBeCloseTo(fromStats.mwrrAnnualized!, 10);
  });
});
