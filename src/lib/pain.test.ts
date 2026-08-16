import { describe, expect, it } from "vitest";
import { computeOpponentComparison, type BenchmarkFile } from "@/lib/benchmarks";
import { computeOpponentPain, computePathPain } from "@/lib/pain";
import type { PortfolioData } from "@/lib/types";

describe("computePathPain", () => {
  it("measures max drawdown on a known dip", () => {
    const pain = computePathPain(
      [100, 110, 90, 95, 120],
      ["2024-01", "2024-02", "2024-03", "2024-04", "2024-05"],
    );
    expect(pain.maxDrawdown).toBeCloseTo(90 / 110 - 1, 10);
    expect(pain.peakValue).toBe(110);
    expect(pain.troughValue).toBe(90);
    expect(pain.peakPeriodId).toBe("2024-02");
    expect(pain.troughPeriodId).toBe("2024-03");
  });

  it("stays at 0 drawdown when the path only rises", () => {
    const pain = computePathPain(
      [100, 110, 121],
      ["2024-01", "2024-02", "2024-03"],
    );
    expect(pain.maxDrawdown).toBe(0);
  });

  it("keeps peak and trough when the path has not recovered", () => {
    const pain = computePathPain(
      [100, 80, 70],
      ["2024-01", "2024-02", "2024-03"],
    );
    expect(pain.maxDrawdown).toBeCloseTo(-0.3, 10);
    expect(pain.peakPeriodId).toBe("2024-01");
    expect(pain.troughPeriodId).toBe("2024-03");
  });

  it("takes the worst exact 1 / 3 / 6 / 12-calendar-month return", () => {
    const ids = [
      "2023-01",
      "2023-02",
      "2023-04",
      "2023-07",
      "2024-01",
    ];
    const values = [100, 110, 80, 70, 90];
    const pain = computePathPain(values, ids);
    // 1m: Jan→Feb +10%; only adjacent pair
    expect(pain.worst[1].value).toBeCloseTo(110 / 100 - 1, 10);
    expect(pain.worst[1].fromId).toBe("2023-01");
    expect(pain.worst[1].toId).toBe("2023-02");
    // 3m: Jan→Apr 80/100 − 1; Apr→Jul 70/80 − 1
    expect(pain.worst[3].value).toBeCloseTo(80 / 100 - 1, 10);
    expect(pain.worst[3].fromId).toBe("2023-01");
    expect(pain.worst[3].toId).toBe("2023-04");
    // 6m: Jan→Jul 70/100; Feb→? none at 6
    expect(pain.worst[6].value).toBeCloseTo(70 / 100 - 1, 10);
    expect(pain.worst[6].fromId).toBe("2023-01");
    expect(pain.worst[6].toId).toBe("2023-07");
    // 12m: Jan→Jan 90/100 − 1
    expect(pain.worst[12].value).toBeCloseTo(90 / 100 - 1, 10);
    expect(pain.worst[12].fromId).toBe("2023-01");
    expect(pain.worst[12].toId).toBe("2024-01");
  });
});

describe("computeOpponentPain", () => {
  it("reads you vs opponent from the same comparison paths", () => {
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
          id: "2024-01",
          label: "Jan",
          startDate: "2024-01-01",
          endDate: "2024-01-31",
          balances: [{ accountId: "a", marketValue: 1000 }],
          totalNetWorth: 1000,
          cashFlows: { deposits: 0, withdrawals: 0, dividends: 0, interest: 0 },
        },
        {
          id: "2024-02",
          label: "Feb",
          startDate: "2024-02-01",
          endDate: "2024-02-29",
          balances: [{ accountId: "a", marketValue: 1200 }],
          totalNetWorth: 1200,
          cashFlows: { deposits: 0, withdrawals: 0, dividends: 0, interest: 0 },
        },
        {
          id: "2024-03",
          label: "Mar",
          startDate: "2024-03-01",
          endDate: "2024-03-31",
          balances: [{ accountId: "a", marketValue: 840 }],
          totalNetWorth: 840,
          cashFlows: { deposits: 0, withdrawals: 0, dividends: 0, interest: 0 },
        },
      ],
    };
    const benches: BenchmarkFile = {
      meta: { source: "fixture" },
      prices: {
        QQQ: { "2024-01": 100, "2024-02": 110, "2024-03": 99 },
        USDCAD: { "2024-01": 1.3, "2024-02": 1.3, "2024-03": 1.3 },
      },
    };
    const cmp = computeOpponentComparison(data, benches, "QQQ");
    const pain = computeOpponentPain(cmp);

    expect(pain.youHoldings.maxDrawdown).toBeCloseTo(840 / 1200 - 1, 8);
    expect(pain.youDollars.maxDrawdown).toBeCloseTo(840 / 1200 - 1, 8);
    expect(pain.youHoldings.peakPeriodId).toBe("2024-02");
    expect(pain.youHoldings.troughPeriodId).toBe("2024-03");
    expect(pain.opponentHoldings.maxDrawdown).toBeCloseTo(99 / 110 - 1, 8);
    expect(pain.youHoldings.maxDrawdown).toBeLessThan(
      pain.opponentHoldings.maxDrawdown as number,
    );
  });
});
