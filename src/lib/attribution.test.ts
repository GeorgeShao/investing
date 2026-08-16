import { describe, expect, it } from "vitest";
import { attributeGap } from "@/lib/attribution";
import { computeOpponentComparison, type BenchmarkFile } from "@/lib/benchmarks";
import type { PortfolioData } from "@/lib/types";

const benches: BenchmarkFile = {
  meta: { source: "fixture" },
  prices: {
    QQQ: { "2024-01": 100, "2024-02": 110, "2024-03": 121 },
    USDCAD: { "2024-01": 1.3, "2024-02": 1.3, "2024-03": 1.3 },
  },
};

function portfolio(parts: {
  values: Array<{ aaa: number; cash: number }>;
  deposits?: number[];
}): PortfolioData {
  const deposits = parts.deposits ?? parts.values.map(() => 0);
  return {
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
    periods: parts.values.map((v, i) => {
      const id = `2024-0${i + 1}`;
      const lastDay = [31, 29, 31][i];
      const total = v.aaa + v.cash;
      return {
        id,
        label: id,
        startDate: `${id}-01`,
        endDate: `${id}-${lastDay}`,
        balances: [{ accountId: "a", marketValue: total, cash: v.cash }],
        totalNetWorth: total,
        cashFlows: {
          deposits: deposits[i] ?? 0,
          withdrawals: 0,
          dividends: 0,
          interest: 0,
        },
        holdings: [
          {
            accountId: "a",
            symbol: "AAA",
            marketValue: v.aaa,
            currency: "CAD",
          },
        ],
      };
    }),
  };
}

describe("attributeGap", () => {
  it("parts plus residual sum to the headline dollar gap", () => {
    const data = portfolio({
      values: [
        { aaa: 900, cash: 100 },
        { aaa: 1050, cash: 100 },
      ],
    });
    const cmp = computeOpponentComparison(data, benches, "QQQ");
    const attr = attributeGap(data, cmp);

    expect(cmp.headline.dollarDelta).toBeCloseTo(50, 6);
    expect(attr.dollarDelta).toBeCloseTo(50, 6);

    const aaa = attr.parts.find((p) => p.id === "AAA");
    const cash = attr.parts.find((p) => p.id === "CASH");
    expect(aaa?.youPnl).toBeCloseTo(150, 6);
    expect(aaa?.opponentPnl).toBeCloseTo(90, 6);
    expect(aaa?.contribution).toBeCloseTo(60, 6);
    expect(cash?.youPnl).toBeCloseTo(0, 6);
    expect(cash?.opponentPnl).toBeCloseTo(10, 6);
    expect(cash?.contribution).toBeCloseTo(-10, 6);

    const sum =
      attr.parts.reduce((s, p) => s + p.contribution, 0) + attr.unexplained;
    expect(sum).toBeCloseTo(attr.dollarDelta, 8);
    expect(attr.unexplained).toBeCloseTo(0, 6);
  });

  it("keeps an unexplained residual when holdings do not cover P&L", () => {
    const data = portfolio({
      values: [
        { aaa: 900, cash: 100 },
        { aaa: 950, cash: 100 },
      ],
    });
    // You P&L = 50; holdings only explain +50 on AAA; QQQ 10% on 1000 = 100
    // dollarDelta = 1050 - 1100 = -50
    const cmp = computeOpponentComparison(data, benches, "QQQ");
    const attr = attributeGap(data, cmp);
    expect(attr.dollarDelta).toBeCloseTo(-50, 6);
    const sum =
      attr.parts.reduce((s, p) => s + p.contribution, 0) + attr.unexplained;
    expect(sum).toBeCloseTo(attr.dollarDelta, 8);
  });
});
