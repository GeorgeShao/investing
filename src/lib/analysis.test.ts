import { describe, expect, it } from "vitest";
import { buildWindowedAnalysis, resolveStartPeriodId } from "@/lib/analysis";
import type { BenchmarkFile } from "@/lib/benchmarks";
import { computeOpponentComparison } from "@/lib/benchmarks";
import { computeOpponentPain } from "@/lib/pain";
import { typicalMonthlyDeposits } from "@/lib/forecast";
import { buildMonthlyPnLSeries, computeReturnStats } from "@/lib/performance";
import {
  buildCashFlowSeries,
  buildHoldingWeightSeries,
  buildNetWorthSeries,
  sliceFromPeriodId,
} from "@/lib/series";
import type { PortfolioData } from "@/lib/types";

const WINDOWS = [
  { id: "2022-02", label: "Feb 2022" },
  { id: "2023-05", label: "May 2023" },
];

/**
 * Two start ids, uneven returns so the later window’s holdings rate
 * is not the same number as the full span.
 */
function multiStartPortfolio(): PortfolioData {
  return {
    meta: { schemaVersion: 1, currency: "CAD", generatedAt: "test" },
    accounts: [
      {
        id: "pick",
        name: "Picks",
        institution: "T",
        type: "non_registered",
        currency: "CAD",
        status: "active",
      },
    ],
    periods: [
      period("2022-02", "Feb 2022", 10_000, 10_000, 200),
      period("2022-03", "Mar 2022", 10_200, 0, 0),
      period("2023-05", "May 2023", 11_220, 1_000, 50),
      period("2023-06", "Jun 2023", 13_464, 500, 0),
    ],
  };
}

function period(
  id: string,
  label: string,
  value: number,
  deposits: number,
  withdrawals: number,
) {
  const [y, m] = id.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    id,
    label,
    startDate: `${id}-01`,
    endDate: `${id}-${String(lastDay).padStart(2, "0")}`,
    balances: [{ accountId: "pick", marketValue: value, cash: 100 }],
    totalNetWorth: value,
    cashFlows: {
      deposits,
      withdrawals,
      dividends: 0,
      interest: 0,
    },
    holdings: [
      {
        accountId: "pick",
        symbol: "AAA",
        marketValue: value - 100,
        currency: "CAD",
      },
    ],
  };
}

const benches: BenchmarkFile = {
  meta: { source: "fixture" },
  prices: {
    QQQ: {
      "2022-02": 100,
      "2022-03": 105,
      "2023-05": 110,
      "2023-06": 121,
    },
    USDCAD: {
      "2022-02": 1.3,
      "2022-03": 1.3,
      "2023-05": 1.3,
      "2023-06": 1.3,
    },
  },
};

describe("resolveStartPeriodId", () => {
  it("keeps an exact period id and otherwise the first id >= requested", () => {
    const data = multiStartPortfolio();
    expect(resolveStartPeriodId(data, "2023-05", WINDOWS)).toBe("2023-05");
    expect(resolveStartPeriodId(data, "2023-01", WINDOWS)).toBe("2023-05");
    expect(resolveStartPeriodId(data, "2022-02", WINDOWS)).toBe("2022-02");
  });
});

describe("buildWindowedAnalysis", () => {
  it("changing the shared start moves every surface together", () => {
    const data = multiStartPortfolio();
    const early = buildWindowedAnalysis(data, {
      startPeriodId: "2022-02",
      benchmarks: benches,
      opponentId: "QQQ",
    });
    const late = buildWindowedAnalysis(data, {
      startPeriodId: "2023-05",
      benchmarks: benches,
      opponentId: "QQQ",
    });

    expect(early.fromPeriodId).toBe("2022-02");
    expect(late.fromPeriodId).toBe("2023-05");
    expect(early.toPeriodId).toBe("2023-06");
    expect(late.toPeriodId).toBe("2023-06");

    expect(early.netWorth.periodIds[0]).toBe("2022-02");
    expect(late.netWorth.periodIds[0]).toBe("2023-05");
    expect(early.cashFlow.periodIds[0]).toBe("2022-02");
    expect(late.cashFlow.periodIds[0]).toBe("2023-05");
    expect(early.pnl.periodIds[0]).toBe("2022-02");
    expect(late.pnl.periodIds[0]).toBe("2023-05");
    expect(early.weights.periodIds[0]).toBe("2022-02");
    expect(late.weights.periodIds[0]).toBe("2023-05");

    expect(early.comparison?.headline.fromPeriodId).toBe("2022-02");
    expect(late.comparison?.headline.fromPeriodId).toBe("2023-05");
    expect(early.comparison?.headline.toPeriodId).toBe("2023-06");
    expect(late.comparison?.headline.toPeriodId).toBe("2023-06");

    expect(early.holdingsCagr).not.toBeNull();
    expect(late.holdingsCagr).not.toBeNull();
    expect(early.holdingsCagr).not.toBeCloseTo(late.holdingsCagr as number, 8);
    expect(early.opponentHoldingsAnn).not.toBeNull();
    expect(late.opponentHoldingsAnn).not.toBeNull();
    expect(early.opponentHoldingsAnn).not.toBeCloseTo(
      late.opponentHoldingsAnn as number,
      8,
    );
  });

  it("is the shipped slice + comparison + series builders, not a fork", () => {
    const data = multiStartPortfolio();
    const start = "2023-05";
    const built = buildWindowedAnalysis(data, {
      startPeriodId: start,
      benchmarks: benches,
      opponentId: "QQQ",
    });
    const sliced = sliceFromPeriodId(data, start);

    expect(built.data.periods.map((p) => p.id)).toEqual(
      sliced.periods.map((p) => p.id),
    );
    expect(built.netWorth).toEqual(buildNetWorthSeries(sliced));
    expect(built.cashFlow).toEqual(buildCashFlowSeries(sliced));
    expect(built.pnl).toEqual(buildMonthlyPnLSeries(sliced));
    expect(built.weights).toEqual(buildHoldingWeightSeries(sliced));
    expect(built.comparison).toEqual(
      computeOpponentComparison(sliced, benches, "QQQ"),
    );
    expect(built.holdingsCagr).toBe(computeReturnStats(sliced).cagr);
    expect(built.typicalMonthlyDeposit).toBe(
      typicalMonthlyDeposits(sliced.periods.map((p) => p.cashFlows.deposits))
        .amount,
    );
    expect(built.pain).toEqual(computeOpponentPain(built.comparison!));
  });
});
