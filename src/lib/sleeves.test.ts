import { describe, expect, it } from "vitest";
import { buildWindowedAnalysis } from "@/lib/analysis";
import type { BenchmarkFile } from "@/lib/benchmarks";
import type { AccountGroupConfig } from "@/lib/config";
import { computeReturnStats } from "@/lib/performance";
import {
  FOUR_OH_ONE_K_SLEEVE_ID,
  HOUSEHOLD_SLEEVE_ID,
  STOCK_PICK_SLEEVE_ID,
  TFSA_SLEEVE_ID,
  filterPortfolioToSleeve,
  groupId,
  listSleeves,
  resolveSleeve,
} from "@/lib/sleeves";
import type { Account, PeriodCashFlows, PortfolioData } from "@/lib/types";

const GROUPS: AccountGroupConfig[] = [
  {
    name: "Fidelity 401(k)",
    memberIds: ["k401"],
    notTryingToBeatIndex: true,
  },
  { name: "QT Margin", memberIds: ["margin"] },
];

function flows(
  deposits: number,
  withdrawals = 0,
  fees = 0,
): PeriodCashFlows {
  return {
    deposits,
    withdrawals,
    dividends: 0,
    interest: 0,
    fees,
  };
}

function account(
  id: string,
  type: Account["type"],
  name: string,
): Account {
  return {
    id,
    name,
    institution: "T",
    type,
    currency: "CAD",
    status: "active",
  };
}

/**
 * Household of four sleeves:
 *   pick (stock-pick, 10%/mo), tfsa (10%/mo + $100 deposit in month 3),
 *   k401 (flat, not trying to beat QQQ), margin (flat, named config group).
 */
function householdPortfolio(): PortfolioData {
  return {
    meta: { schemaVersion: 1, currency: "CAD", generatedAt: "test" },
    accounts: [
      account("pick", "non_registered", "Picks"),
      account("tfsa", "tfsa", "TFSA"),
      account("k401", "rrsp", "Fidelity Employer RRSP (tesla-inc-401k)"),
      account("margin", "margin", "QT Margin"),
    ],
    periods: [
      month("2024-01", {
        pick: 1000,
        tfsa: 500,
        k401: 2000,
        margin: 100,
      }, {
        pick: flows(1000),
        tfsa: flows(500),
        k401: flows(2000),
        margin: flows(100),
      }),
      month("2024-02", {
        pick: 1100,
        tfsa: 550,
        k401: 2000,
        margin: 100,
      }, {
        pick: flows(0),
        tfsa: flows(0),
        k401: flows(0),
        margin: flows(0),
      }),
      month("2024-03", {
        pick: 1210,
        tfsa: 705,
        k401: 2000,
        margin: 100,
      }, {
        pick: flows(0),
        tfsa: flows(100),
        k401: flows(0),
        margin: flows(0),
      }),
    ],
  };
}

function month(
  id: string,
  values: Record<string, number>,
  perAccount: Record<string, PeriodCashFlows>,
) {
  const [y, m] = id.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const household = Object.values(perAccount).reduce(
    (sum, f) => ({
      deposits: sum.deposits + f.deposits,
      withdrawals: sum.withdrawals + f.withdrawals,
      dividends: 0,
      interest: 0,
      fees: (sum.fees ?? 0) + (f.fees ?? 0),
    }),
    flows(0),
  );
  return {
    id,
    label: id,
    startDate: `${id}-01`,
    endDate: `${id}-${String(lastDay).padStart(2, "0")}`,
    balances: Object.entries(values).map(([accountId, marketValue]) => ({
      accountId,
      marketValue,
    })),
    totalNetWorth: Object.values(values).reduce((s, v) => s + v, 0),
    cashFlows: household,
    accountCashFlows: perAccount,
  };
}

const benches: BenchmarkFile = {
  meta: { source: "fixture" },
  prices: {
    QQQ: { "2024-01": 100, "2024-02": 110, "2024-03": 121 },
    USDCAD: { "2024-01": 1.3, "2024-02": 1.3, "2024-03": 1.3 },
  },
};

function analysisFor(sleeveId: string) {
  return buildWindowedAnalysis(householdPortfolio(), {
    startPeriodId: "2024-01",
    sleeveId,
    accountGroups: GROUPS,
    benchmarks: benches,
    opponentId: "QQQ",
  });
}

describe("listSleeves", () => {
  it("lists household, stock-pick, TFSA, 401(k), and config groups", () => {
    const sleeves = listSleeves(householdPortfolio(), GROUPS);
    expect(sleeves.map((s) => s.id)).toEqual([
      HOUSEHOLD_SLEEVE_ID,
      STOCK_PICK_SLEEVE_ID,
      TFSA_SLEEVE_ID,
      FOUR_OH_ONE_K_SLEEVE_ID,
      groupId("Fidelity 401(k)"),
      groupId("QT Margin"),
    ]);
    expect(
      resolveSleeve(householdPortfolio(), STOCK_PICK_SLEEVE_ID, GROUPS)
        .accountIds,
    ).toEqual(["pick", "tfsa", "margin"]);
    expect(
      resolveSleeve(householdPortfolio(), FOUR_OH_ONE_K_SLEEVE_ID, GROUPS)
        .accountIds,
    ).toEqual(["k401"]);
  });
});

describe("filterPortfolioToSleeve", () => {
  it("rewrites balances, totals, and external flows to the sleeve", () => {
    const tfsa = filterPortfolioToSleeve(
      householdPortfolio(),
      resolveSleeve(householdPortfolio(), TFSA_SLEEVE_ID, GROUPS),
    );
    expect(tfsa.accounts.map((a) => a.id)).toEqual(["tfsa"]);
    expect(tfsa.periods.map((p) => p.totalNetWorth)).toEqual([500, 550, 705]);
    expect(tfsa.periods.map((p) => p.cashFlows.deposits)).toEqual([
      500, 0, 100,
    ]);
    expect(tfsa.periods[0].cashFlows.deposits).not.toBe(
      householdPortfolio().periods[0].cashFlows.deposits,
    );
  });
});

describe("sleeve scores on a household fixture", () => {
  it("household includes every sleeve; stock-pick excludes the 401(k)", () => {
    const household = analysisFor(HOUSEHOLD_SLEEVE_ID);
    const skill = analysisFor(STOCK_PICK_SLEEVE_ID);
    const four = analysisFor(FOUR_OH_ONE_K_SLEEVE_ID);

    expect(household.comparison?.headline.youEnd).toBe(4015);
    expect(skill.comparison?.headline.youEnd).toBe(2015);
    expect(four.comparison?.headline.youEnd).toBe(2000);

    // Same-paycheck: QQQ +10%/mo on each sleeve's own opening + flows.
    expect(household.comparison?.headline.opponentEnd).toBeCloseTo(
      3600 * 1.1 * 1.1 + 100,
      6,
    );
    expect(skill.comparison?.headline.opponentEnd).toBeCloseTo(
      1600 * 1.1 * 1.1 + 100,
      6,
    );
    expect(four.comparison?.headline.opponentEnd).toBeCloseTo(
      2000 * 1.1 * 1.1,
      6,
    );

    expect(household.comparison?.headline.dollarDelta).not.toBeCloseTo(
      skill.comparison?.headline.dollarDelta as number,
      6,
    );
    expect(household.holdingsCagr).not.toBeCloseTo(
      skill.holdingsCagr as number,
      8,
    );
    // Flat 401(k) is slower than the blended household and than stock-picks.
    expect(four.holdingsCagr).toBeLessThan(skill.holdingsCagr as number);
    expect(four.holdingsCagr).toBeLessThan(household.holdingsCagr as number);
  });

  it("TFSA-only and a named config group recompute both scores on those accounts", () => {
    const tfsa = analysisFor(TFSA_SLEEVE_ID);
    const margin = analysisFor(groupId("QT Margin"));

    expect(tfsa.comparison?.headline.youEnd).toBe(705);
    expect(tfsa.comparison?.headline.opponentEnd).toBeCloseTo(
      500 * 1.1 * 1.1 + 100,
      6,
    );
    expect(tfsa.comparison?.headline.dollarDelta).toBeCloseTo(0, 6);
    expect(tfsa.data.periods.map((p) => p.cashFlows.deposits)).toEqual([
      500, 0, 100,
    ]);

    expect(margin.comparison?.headline.youEnd).toBe(100);
    expect(margin.comparison?.headline.opponentEnd).toBeCloseTo(
      100 * 1.1 * 1.1,
      6,
    );
    expect(margin.comparison?.headline.dollarDelta).toBeCloseTo(
      100 - 121,
      6,
    );

    const tfsaStats = computeReturnStats(tfsa.data);
    expect(tfsa.holdingsCagr).toBe(tfsaStats.cagr);
    expect(margin.holdingsCagr).toBe(computeReturnStats(margin.data).cagr);
    expect(tfsa.holdingsCagr).not.toBeCloseTo(margin.holdingsCagr as number, 8);
  });
});

/**
 * Matched TFSA → taxable transfer. Household merge parks that move in
 * transfersIn/Out so it is not a deposit or withdrawal. Same balances,
 * three encodings of the $400 move.
 */
function transferPortfolio(
  encoding: "transfer" | "flow" | "forgotten",
): PortfolioData {
  const tfsaMove =
    encoding === "transfer"
      ? { ...flows(0), transfersOut: 400 }
      : encoding === "flow"
        ? flows(0, 400)
        : flows(0);
  const taxableMove =
    encoding === "transfer"
      ? { ...flows(0), transfersIn: 400 }
      : encoding === "flow"
        ? flows(400)
        : flows(0);
  return {
    meta: { schemaVersion: 1, currency: "CAD", generatedAt: "test" },
    accounts: [
      account("tfsa", "tfsa", "TFSA"),
      account("taxable", "non_registered", "Taxable"),
    ],
    periods: [
      month(
        "2024-01",
        { tfsa: 1000, taxable: 1000 },
        { tfsa: flows(1000), taxable: flows(1000) },
      ),
      month(
        "2024-02",
        { tfsa: 600, taxable: 1400 },
        { tfsa: tfsaMove, taxable: taxableMove },
      ),
    ],
  };
}

describe("sleeve-external transfers", () => {
  it("treats a TFSA→taxable transfer as TFSA outflow, not a loss", () => {
    const asTransfer = transferPortfolio("transfer");
    const asFlow = transferPortfolio("flow");
    const forgotten = transferPortfolio("forgotten");
    const groups: AccountGroupConfig[] = [
      ...GROUPS,
      { name: "Taxable", memberIds: ["taxable"] },
    ];
    const opts = {
      startPeriodId: "2024-01",
      accountGroups: groups,
      benchmarks: benches,
      opponentId: "QQQ",
    };

    const tfsaFromTransfer = buildWindowedAnalysis(asTransfer, {
      ...opts,
      sleeveId: TFSA_SLEEVE_ID,
    });
    const tfsaFromFlow = buildWindowedAnalysis(asFlow, {
      ...opts,
      sleeveId: TFSA_SLEEVE_ID,
    });
    const tfsaForgotten = buildWindowedAnalysis(forgotten, {
      ...opts,
      sleeveId: TFSA_SLEEVE_ID,
    });

    expect(tfsaFromTransfer.data.periods[1].cashFlows.withdrawals).toBe(400);
    expect(tfsaFromTransfer.data.periods[1].cashFlows.deposits).toBe(0);
    expect(tfsaFromTransfer.comparison?.headline.dollarDelta).toBeCloseTo(
      tfsaFromFlow.comparison?.headline.dollarDelta as number,
      8,
    );
    expect(
      tfsaFromTransfer.comparison?.headline.dollarDelta,
    ).not.toBeCloseTo(
      tfsaForgotten.comparison?.headline.dollarDelta as number,
      8,
    );

    const taxableFromTransfer = buildWindowedAnalysis(asTransfer, {
      ...opts,
      sleeveId: groupId("Taxable"),
    });
    // Taxable is not a built-in sleeve; use stock-pick? No — filter via a group.
    expect(taxableFromTransfer.data.accounts.map((a) => a.id)).toEqual([
      "taxable",
    ]);
    expect(taxableFromTransfer.data.periods[1].cashFlows.deposits).toBe(400);
    expect(taxableFromTransfer.comparison?.headline.dollarDelta).toBeCloseTo(
      buildWindowedAnalysis(asFlow, {
        ...opts,
        sleeveId: groupId("Taxable"),
      }).comparison?.headline.dollarDelta as number,
      8,
    );

    const household = buildWindowedAnalysis(asTransfer, {
      ...opts,
      sleeveId: HOUSEHOLD_SLEEVE_ID,
    });
    expect(household.data.periods[1].cashFlows.withdrawals).toBe(0);
    expect(household.data.periods[1].cashFlows.deposits).toBe(0);
    expect(household.comparison?.headline.dollarDelta).toBeCloseTo(
      buildWindowedAnalysis(asFlow, {
        ...opts,
        sleeveId: HOUSEHOLD_SLEEVE_ID,
      }).comparison?.headline.dollarDelta as number,
      8,
    );

    // Both accounts in one sleeve: the move is intra-sleeve and nets out.
    const both = filterPortfolioToSleeve(asTransfer, {
      accountIds: ["tfsa", "taxable"],
    });
    expect(both.periods[1].cashFlows.withdrawals).toBe(0);
    expect(both.periods[1].cashFlows.deposits).toBe(0);

    // Same transfer inside a larger household, subset that still contains
    // both sides — fold is on, but intra-sleeve net is zero.
    const wider: PortfolioData = {
      ...asTransfer,
      accounts: [...asTransfer.accounts, account("k401", "rrsp", "401k")],
      periods: asTransfer.periods.map((p) => ({
        ...p,
        balances: [
          ...p.balances,
          { accountId: "k401", marketValue: 2000 },
        ],
        totalNetWorth: p.totalNetWorth + 2000,
        accountCashFlows: {
          ...p.accountCashFlows,
          k401: p.id === "2024-01" ? flows(2000) : flows(0),
        },
      })),
    };
    const pair = filterPortfolioToSleeve(wider, {
      accountIds: ["tfsa", "taxable"],
    });
    expect(pair.periods[1].cashFlows.withdrawals).toBe(0);
    expect(pair.periods[1].cashFlows.deposits).toBe(0);
  });
});
