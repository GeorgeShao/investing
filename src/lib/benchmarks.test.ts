import { describe, expect, it } from "vitest";
import {
  benchmarkCadLevel,
  benchmarkMonthlyReturn,
  buildBenchmarkComparison,
  cashFlowMatchedLevels,
  computeOpponentComparison,
  computeYearlyCashFlowMatchedReturns,
  cumulativeFromMonthlyReturns,
  listBenchmarkIds,
  pickDefaultOpponentId,
  type BenchmarkFile,
} from "@/lib/benchmarks";
import type { PortfolioData } from "@/lib/types";

const fixture: BenchmarkFile = {
  meta: { source: "fixture" },
  prices: {
    XEQT: { "2024-01": 100, "2024-02": 110, "2024-03": 121 },
    VOO: { "2024-01": 50, "2024-02": 55, "2024-03": 60.5 },
    QQQ: { "2024-01": 20, "2024-02": 22, "2024-03": 24.2 },
    USDCAD: { "2024-01": 1.3, "2024-02": 1.3, "2024-03": 1.3 },
  },
};

const portfolio: PortfolioData = {
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
      id: "2024-01",
      label: "Jan 2024",
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      balances: [{ accountId: "a", marketValue: 1000 }],
      totalNetWorth: 1000,
      cashFlows: { deposits: 0, withdrawals: 0, dividends: 0, interest: 0 },
    },
    {
      id: "2024-02",
      label: "Feb 2024",
      startDate: "2024-02-01",
      endDate: "2024-02-29",
      balances: [{ accountId: "a", marketValue: 1100 }],
      totalNetWorth: 1100,
      cashFlows: { deposits: 0, withdrawals: 0, dividends: 0, interest: 0 },
    },
    {
      id: "2024-03",
      label: "Mar 2024",
      startDate: "2024-03-01",
      endDate: "2024-03-31",
      balances: [{ accountId: "a", marketValue: 1210 }],
      totalNetWorth: 1210,
      cashFlows: { deposits: 0, withdrawals: 0, dividends: 0, interest: 0 },
    },
  ],
};

describe("benchmarkCadLevel / monthly return", () => {
  it("leaves XEQT in CAD and converts VOO with USDCAD", () => {
    expect(benchmarkCadLevel("XEQT", "2024-01", fixture.prices, "CAD")).toBe(
      100,
    );
    expect(
      benchmarkCadLevel("VOO", "2024-01", fixture.prices, "USD"),
    ).toBeCloseTo(50 * 1.3, 10);
    expect(
      benchmarkMonthlyReturn("XEQT", "2024-01", "2024-02", fixture.prices, "CAD"),
    ).toBeCloseTo(0.1, 10);
  });
});

describe("cumulativeFromMonthlyReturns", () => {
  it("starts at 1 and compounds defined returns", () => {
    const c = cumulativeFromMonthlyReturns([null, 0.1, 0.1]);
    expect(c[0]).toBe(1);
    expect(c[1]).toBeCloseTo(1.1, 10);
    expect(c[2]).toBeCloseTo(1.21, 10);
  });
});

describe("buildBenchmarkComparison", () => {
  it("builds twrr growth series for dynamic benchmark ids", () => {
    const series = buildBenchmarkComparison(portfolio, fixture, "twrr");
    expect(series.mode).toBe("twrr");
    expect(series.portfolio[0]).toBe(1);
    expect(series.portfolio[1]).toBeCloseTo(1.1, 8);
    expect(series.benchmarks.XEQT.values[1]).toBeCloseTo(1.1, 8);
    expect(Object.keys(series.benchmarks).sort()).toEqual(
      ["QQQ", "VOO", "XEQT"].sort(),
    );
  });

  it("builds cash-flow matched levels", () => {
    const series = buildBenchmarkComparison(portfolio, fixture, "cashflow");
    expect(series.mode).toBe("cashflow");
    expect(series.portfolio[0]).toBe(1000);
    const xeqt = cashFlowMatchedLevels(portfolio, "XEQT", fixture.prices, "CAD");
    expect(xeqt[0]).toBe(1000);
    expect(xeqt[1]).toBeCloseTo(1000 * 1.1, 6);
  });
});

describe("listBenchmarkIds", () => {
  it("excludes USDCAD and respects preferred order", () => {
    const ids = listBenchmarkIds(fixture.prices, ["QQQ", "XEQT"]);
    expect(ids[0]).toBe("QQQ");
    expect(ids).toContain("VOO");
    expect(ids).not.toContain("USDCAD");
  });
});

describe("computeYearlyCashFlowMatchedReturns", () => {
  it("returns per-year portfolio vs index MWRR", () => {
    const rows = computeYearlyCashFlowMatchedReturns(portfolio, fixture);
    expect(rows.length).toBe(1);
    expect(rows[0].year).toBe(2024);
    expect(rows[0].byBenchmark.XEQT).not.toBeNull();
  });
});

describe("pickDefaultOpponentId", () => {
  it("prefers QQQ when present", () => {
    expect(pickDefaultOpponentId(["XEQT", "VOO", "QQQ"])).toBe("QQQ");
  });

  it("falls back to the first id when QQQ is missing", () => {
    expect(pickDefaultOpponentId(["XEQT", "VOO"])).toBe("XEQT");
  });
});

describe("computeOpponentComparison", () => {
  it("same holdings as XEQT: dollar path matches and holdings rates match", () => {
    const cmp = computeOpponentComparison(portfolio, fixture, "XEQT");
    expect(cmp.headline.opponentId).toBe("XEQT");
    expect(cmp.headline.youEnd).toBe(1210);
    expect(cmp.headline.opponentEnd).toBeCloseTo(1210, 6);
    expect(cmp.headline.dollarDelta).toBeCloseTo(0, 6);
    expect(cmp.headline.youHoldingsAnn).not.toBeNull();
    expect(cmp.headline.opponentHoldingsAnn).toBeCloseTo(
      cmp.headline.youHoldingsAnn!,
      8,
    );
    expect(cmp.yearly).toHaveLength(1);
    expect(cmp.yearly[0].you?.gain).toBeCloseTo(210, 6);
    expect(cmp.yearly[0].opponent?.gain).toBeCloseTo(210, 6);
    expect(cmp.yearly[0].you?.rate).toBeCloseTo(0.21, 8);
    expect(cmp.yearly[0].opponent?.rate).toBeCloseTo(0.21, 8);
  });

  it("paycheck-honest yearly % uses start + net deposits, not end/start", () => {
    const withDeposit: typeof portfolio = {
      ...portfolio,
      periods: [
        portfolio.periods[0],
        {
          ...portfolio.periods[1],
          totalNetWorth: 2100,
          cashFlows: {
            deposits: 1000,
            withdrawals: 0,
            dividends: 0,
            interest: 0,
          },
        },
        {
          ...portfolio.periods[2],
          totalNetWorth: 2310,
        },
      ],
    };
    const cmp = computeOpponentComparison(withDeposit, fixture, "XEQT");
    const row = cmp.yearly[0];
    expect(row.you).not.toBeNull();
    // start 1000 + 1000 deposit = 2000 invested; end 2310 → gain 310 → 15.5%
    expect(row.you!.gain).toBeCloseTo(310, 6);
    expect(row.you!.rate).toBeCloseTo(310 / 2000, 8);
    expect((2310 - 1000) / 1000).toBe(1.31);
    expect(row.you!.rate).not.toBeCloseTo(1.31, 2);
  });
});
