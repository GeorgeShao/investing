import { describe, expect, it } from "vitest";
import { computeOpponentComparison, type BenchmarkFile } from "@/lib/benchmarks";
import {
  DEFAULT_OPPONENT_MER,
  OPPONENT_MER,
  computeFeeDrag,
  opponentMerDrag,
  sumExtractedFees,
} from "@/lib/fees";
import type { PortfolioData } from "@/lib/types";

describe("OPPONENT_MER", () => {
  it("documents QQQ as the published 0.20% expense ratio", () => {
    expect(OPPONENT_MER.QQQ.mer).toBe(0.002);
    expect(OPPONENT_MER.QQQ.label).toBe("0.20%");
    expect(OPPONENT_MER.QQQ.source.toLowerCase()).toContain("0.20");
    expect(DEFAULT_OPPONENT_MER).toBe(OPPONENT_MER.QQQ);
  });
});

describe("sumExtractedFees / opponentMerDrag", () => {
  it("sums extracted fees on the window", () => {
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
          cashFlows: {
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            interest: 0,
            fees: 0,
          },
        },
        {
          id: "2024-02",
          label: "Feb",
          startDate: "2024-02-01",
          endDate: "2024-02-29",
          balances: [{ accountId: "a", marketValue: 1090 }],
          totalNetWorth: 1090,
          cashFlows: {
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            interest: 0,
            fees: 12.5,
          },
        },
        {
          id: "2024-03",
          label: "Mar",
          startDate: "2024-03-01",
          endDate: "2024-03-31",
          balances: [{ accountId: "a", marketValue: 1080 }],
          totalNetWorth: 1080,
          cashFlows: {
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            interest: 0,
            fees: 7.5,
          },
        },
      ],
    };
    expect(sumExtractedFees(data)).toBeCloseTo(20, 10);
    expect(opponentMerDrag([1000, 1100, 1210], OPPONENT_MER.QQQ.mer)).toBeCloseTo(
      (1000 * 0.002) / 12 + (1100 * 0.002) / 12,
      10,
    );
  });
});

describe("computeFeeDrag", () => {
  it("pairs extracted fees with QQQ MER on the shadow path", () => {
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
          balances: [{ accountId: "a", marketValue: 12000 }],
          totalNetWorth: 12000,
          cashFlows: {
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            interest: 0,
            fees: 0,
          },
        },
        {
          id: "2024-02",
          label: "Feb",
          startDate: "2024-02-01",
          endDate: "2024-02-29",
          balances: [{ accountId: "a", marketValue: 13190 }],
          totalNetWorth: 13190,
          cashFlows: {
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            interest: 0,
            fees: 10,
          },
        },
      ],
    };
    const benches: BenchmarkFile = {
      meta: { source: "fixture" },
      prices: {
        QQQ: { "2024-01": 100, "2024-02": 110 },
        USDCAD: { "2024-01": 1.3, "2024-02": 1.3 },
      },
    };
    const cmp = computeOpponentComparison(data, benches, "QQQ");
    const fees = computeFeeDrag(data, cmp);
    expect(fees.youPaid).toBe(10);
    expect(fees.mer).toBe(OPPONENT_MER.QQQ.mer);
    expect(fees.opponentDrag).toBeCloseTo((12000 * 0.002) / 12, 8);
    expect(fees.merSource).toBe(OPPONENT_MER.QQQ.source);
  });
});
