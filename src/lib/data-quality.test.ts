import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findMissingLatestStatements,
  mergePortfolioWarnings,
  MISSING_LATEST_STATEMENT,
} from "@/lib/data-quality";
import type { Account, Period, PortfolioData } from "@/lib/types";

function account(id: string, status: Account["status"] = "active"): Account {
  return {
    id,
    name: id === "qt-rrsp" ? "QT RRSP (1)" : id,
    institution: "Questrade",
    type: "rrsp",
    currency: "CAD",
    status,
    externalIds: { accountNumber: "1" },
  };
}

function period(
  id: string,
  balances: Array<{ accountId: string; marketValue: number }>,
): Period {
  return {
    id,
    label: id,
    startDate: `${id}-01`,
    endDate: `${id}-28`,
    balances,
    totalNetWorth: balances.reduce((s, b) => s + b.marketValue, 0),
    cashFlows: { deposits: 0, withdrawals: 0, dividends: 0, interest: 0 },
  };
}

function portfolio(accounts: Account[], periods: Period[]): PortfolioData {
  return {
    meta: { schemaVersion: 2, currency: "CAD", generatedAt: "t" },
    accounts,
    periods,
  };
}

describe("findMissingLatestStatements", () => {
  it("flags a positive last balance that is absent from the latest month", () => {
    const data = portfolio(
      [account("qt-rrsp"), account("qt-margin")],
      [
        period("2026-06", [
          { accountId: "qt-rrsp", marketValue: 16793.76 },
          { accountId: "qt-margin", marketValue: 1000 },
        ]),
        period("2026-07", [{ accountId: "qt-margin", marketValue: 1100 }]),
      ],
    );
    const warnings = findMissingLatestStatements(data);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe(MISSING_LATEST_STATEMENT);
    expect(warnings[0].accountId).toBe("qt-rrsp");
    expect(warnings[0].periodId).toBe("2026-06");
    expect(warnings[0].latestPeriodId).toBe("2026-07");
    expect(warnings[0].marketValue).toBeCloseTo(16793.76, 2);
  });

  it("does not flag an account that appears in the latest month", () => {
    const data = portfolio(
      [account("qt-rrsp")],
      [
        period("2026-06", [{ accountId: "qt-rrsp", marketValue: 100 }]),
        period("2026-07", [{ accountId: "qt-rrsp", marketValue: 110 }]),
      ],
    );
    expect(findMissingLatestStatements(data)).toEqual([]);
  });

  it("does not flag a last appearance that is already $0", () => {
    const data = portfolio(
      [account("qt-rrsp"), account("qt-margin")],
      [
        period("2026-06", [
          { accountId: "qt-rrsp", marketValue: 0 },
          { accountId: "qt-margin", marketValue: 1 },
        ]),
        period("2026-07", [{ accountId: "qt-margin", marketValue: 1 }]),
      ],
    );
    expect(findMissingLatestStatements(data)).toEqual([]);
  });

  it("does not flag closed accounts", () => {
    const data = portfolio(
      [account("qt-rrsp", "closed"), account("qt-margin")],
      [
        period("2026-06", [
          { accountId: "qt-rrsp", marketValue: 500 },
          { accountId: "qt-margin", marketValue: 1 },
        ]),
        period("2026-07", [{ accountId: "qt-margin", marketValue: 1 }]),
      ],
    );
    expect(findMissingLatestStatements(data)).toEqual([]);
  });

  const extractPath = resolve(__dirname, "../../data/data.json");
  it.runIf(existsSync(extractPath))(
    "flags on real extract when QT RRSP is present in June and absent in July",
    () => {
      const data = JSON.parse(readFileSync(extractPath, "utf8")) as PortfolioData;
      const warnings = findMissingLatestStatements(data);
      const qt = warnings.find((w) => w.accountId === "qt-53511380");
      expect(qt).toBeDefined();
      expect(qt!.periodId).toBe("2026-06");
      expect(qt!.latestPeriodId).toBe("2026-07");
      expect(qt!.marketValue).toBeGreaterThan(1000);
    },
  );
});

describe("mergePortfolioWarnings", () => {
  it("dedupes the same code+account+period from extract and live check", () => {
    const live = [
      {
        code: MISSING_LATEST_STATEMENT,
        accountId: "qt-rrsp",
        periodId: "2026-06",
        message: "live",
      },
    ];
    const merged = mergePortfolioWarnings(
      [
        {
          code: MISSING_LATEST_STATEMENT,
          accountId: "qt-rrsp",
          periodId: "2026-06",
          message: "extract",
        },
      ],
      live,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].message).toBe("live");
  });
});
