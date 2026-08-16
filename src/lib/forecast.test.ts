import { describe, expect, it } from "vitest";
import {
  addYearsToStart,
  annualContributionFromAmount,
  buildForecastProjection,
  buildForecastSeries,
  contributionPerEvent,
  labelForYearOffset,
  listForecastTickMonths,
  percentToDecimal,
  periodsPerYear,
  projectBalance,
  ratePercentFromDecimal,
  resolveHorizonYears,
  totalContributionsOverYears,
  typicalMonthlyDeposits,
  yearsBetweenDates,
} from "@/lib/forecast";

describe("contribution helpers", () => {
  it("maps per-event amount × frequency to annual total", () => {
    expect(annualContributionFromAmount(500, "monthly")).toBe(6000);
    expect(annualContributionFromAmount(1000, "biweekly")).toBe(26000);
    expect(annualContributionFromAmount(100, "none")).toBe(0);
    expect(contributionPerEvent(1200, "monthly")).toBe(100);
    expect(periodsPerYear("monthly")).toBe(12);
  });

  it("totals contributions over a horizon from amount × frequency (shipped)", () => {
    // $500/mo for 2 years → 24 events × 500 = 12000
    expect(totalContributionsOverYears(500, "monthly", 2)).toBe(12000);
    // $100/week for 1 year → 52 × 100
    expect(totalContributionsOverYears(100, "weekly", 1)).toBe(5200);
    expect(totalContributionsOverYears(500, "none", 10)).toBe(0);
    expect(totalContributionsOverYears(500, "monthly", 0)).toBe(0);
  });
});

describe("calendar axis labels (leap years)", () => {
  it("addYearsToStart uses calendar years not 365.25-day drift", () => {
    // 2027–2028 span includes leap day 2028-02-29; ms-based math used to land
    // offset 2 still in 2028 and duplicate the label.
    expect(addYearsToStart("2027-01", 0)).toBe("2027-01");
    expect(addYearsToStart("2027-01", 1)).toBe("2028-01");
    expect(addYearsToStart("2027-01", 2)).toBe("2029-01");
    expect(addYearsToStart("2027-01", 6)).toBe("2033-01");
  });

  it("integer offsets produce unique sequential year labels across a leap span", () => {
    const start = "2027-01";
    const labels = [0, 1, 2, 3, 4, 5, 6].map((y) =>
      labelForYearOffset(start, y),
    );
    expect(labels).toEqual([
      "2027",
      "2028",
      "2029",
      "2030",
      "2031",
      "2032",
      "2033",
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("buildForecastProjection chart labels stay unique for 6y from Jan 2027", () => {
    const series = buildForecastProjection({
      principal: 1000,
      contributionAmount: 0,
      contributionFrequency: "none",
      startDate: "2027-01",
      horizonYears: 6,
      compounding: "annually",
      rates: { min: 0.03, expected: 0.1, max: 0.2, historical: 0.31 },
    });
    const labels = series.points.map((p) => p.label);
    expect(labels[0]).toBe("2027-01");
    expect(labels[labels.length - 1]).toBe("2033-01");
    expect(labels).toContain("2027-12");
    expect(labels).toContain("2032-12");
    expect(labels).not.toContain("2033-12");
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("listForecastTickMonths", () => {
  it("uses December year-ends and keeps a non-December end", () => {
    expect(listForecastTickMonths("2026-07", "2033-11")).toEqual([
      "2026-07",
      "2026-12",
      "2027-12",
      "2028-12",
      "2029-12",
      "2030-12",
      "2031-12",
      "2032-12",
      "2033-11",
    ]);
  });

  it("does not add a December that would fall after the end", () => {
    const ticks = listForecastTickMonths("2026-07", "2033-11");
    expect(ticks).not.toContain("2033-12");
    expect(ticks[ticks.length - 2]).toBe("2032-12");
  });

  it("includes the end when it is already December", () => {
    expect(listForecastTickMonths("2026-07", "2033-12")).toEqual([
      "2026-07",
      "2026-12",
      "2027-12",
      "2028-12",
      "2029-12",
      "2030-12",
      "2031-12",
      "2032-12",
      "2033-12",
    ]);
  });

  it("skips the start year December when start is already December", () => {
    expect(listForecastTickMonths("2026-12", "2033-11")).toEqual([
      "2026-12",
      "2027-12",
      "2028-12",
      "2029-12",
      "2030-12",
      "2031-12",
      "2032-12",
      "2033-11",
    ]);
  });

  it("has no year-end tick when the span never reaches December", () => {
    expect(listForecastTickMonths("2026-07", "2026-10")).toEqual([
      "2026-07",
      "2026-10",
    ]);
  });
});

describe("yearsBetweenDates / resolveHorizonYears", () => {
  it("derives fractional years from start/end dates", () => {
    const y = yearsBetweenDates("2026-01-01", "2036-01-01");
    expect(y).not.toBeNull();
    expect(y!).toBeCloseTo(10, 2);
    expect(yearsBetweenDates("2030-01", "2020-01")).toBeNull();
  });

  it("uses end date when set, else horizonYears default", () => {
    expect(
      resolveHorizonYears({
        startDate: "2026-01",
        endDate: "2031-01",
      }),
    ).toBeCloseTo(5, 2);
    expect(
      resolveHorizonYears({
        startDate: "2026-01",
        endDate: "",
        horizonYears: 15,
      }),
    ).toBe(15);
    expect(
      resolveHorizonYears({
        startDate: "2026-01",
      }),
    ).toBe(20);
  });
});

describe("projectBalance", () => {
  it("grows principal with monthly compounding and no contributions", () => {
    const end = projectBalance(10000, 0.12, 1, 0, "none", "monthly");
    expect(end).toBeCloseTo(10000 * Math.pow(1.01, 12), 6);
  });

  it("adds end-of-period monthly contributions", () => {
    const end = projectBalance(0, 0, 1, 1200, "monthly", "monthly", true);
    expect(end).toBeCloseTo(1200, 6);
  });

  it("higher annual rate yields higher terminal with same contributions", () => {
    const low = projectBalance(10000, 0.0, 10, 6000, "monthly", "monthly");
    const high = projectBalance(10000, 0.1, 10, 6000, "monthly", "monthly");
    expect(high).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(10000 + 6000 * 10);
  });

  it("at 0% rate, biweekly amount fully funds terminal under monthly compound", () => {
    // $500 biweekly → $13,000/year; monthly compound must still deposit all of it
    const annual = annualContributionFromAmount(500, "biweekly");
    expect(annual).toBe(13000);
    const end = projectBalance(0, 0, 1, annual, "biweekly", "monthly");
    expect(end).toBeCloseTo(13000, 6);
    const projected = buildForecastProjection({
      principal: 1000,
      contributionAmount: 500,
      contributionFrequency: "biweekly",
      startDate: "2026-01",
      endDate: "2027-01",
      compounding: "monthly",
      rates: { min: 0, expected: 0, max: 0, historical: 0 },
    });
    expect(projected.totalContributions).toBe(13000);
    expect(projected.terminal.expected).toBeCloseTo(
      1000 + projected.totalContributions,
      4,
    );
  });

  it("at 0% rate, weekly contributions fully apply under monthly compound", () => {
    const annual = annualContributionFromAmount(100, "weekly");
    expect(annual).toBe(5200);
    const end = projectBalance(500, 0, 1, annual, "weekly", "monthly");
    expect(end).toBeCloseTo(500 + 5200, 6);
  });

  it("at 0% rate, monthly contributions fully apply under annual compound", () => {
    // $500/mo = $6000/yr; annual compounding must still add full annual stream
    const annual = annualContributionFromAmount(500, "monthly");
    expect(annual).toBe(6000);
    const end = projectBalance(0, 0, 2, annual, "monthly", "annually");
    expect(end).toBeCloseTo(12000, 6);
  });

  it("projection terminal matches totalContributions at 0% for biweekly plan", () => {
    const series = buildForecastProjection({
      principal: 0,
      contributionAmount: 250,
      contributionFrequency: "biweekly",
      startDate: "2026-01",
      horizonYears: 3,
      compounding: "monthly",
      rates: { min: 0, expected: 0, max: 0, historical: null },
    });
    // 26 × 250 × 3
    expect(series.totalContributions).toBe(19500);
    expect(series.terminal.expected).toBeCloseTo(series.totalContributions, 4);
    expect(series.terminal.min).toBeCloseTo(series.totalContributions, 4);
    expect(series.terminal.max).toBeCloseTo(series.totalContributions, 4);
  });
});

describe("buildForecastSeries / buildForecastProjection", () => {
  it("returns min ≤ expected ≤ max and non-null historical path", () => {
    const series = buildForecastSeries({
      principal: 10000,
      years: 5,
      annualContribution: 6000,
      contributionFrequency: "monthly",
      compounding: "monthly",
      rates: { min: 0.03, expected: 0.07, max: 0.12, historical: 0.08 },
    });
    expect(series.points.length).toBeGreaterThan(1);
    expect(series.points[0].expected).toBe(10000);
    const last = series.points[series.points.length - 1];
    expect(last.year).toBe(5);
    expect(last.min).toBeLessThan(last.expected);
    expect(last.expected).toBeLessThan(last.max);
    expect(last.historical).not.toBeNull();
    expect(last.historical!).toBeGreaterThan(last.min);
    expect(series.terminal.expected).toBe(last.expected);
  });

  it("buildForecastProjection uses per-event amount and date horizon", () => {
    const series = buildForecastProjection({
      principal: 20000,
      contributionAmount: 500,
      contributionFrequency: "monthly",
      startDate: "2026-01",
      endDate: "2028-01",
      compounding: "monthly",
      rates: {
        min: percentToDecimal(2),
        expected: percentToDecimal(7),
        max: percentToDecimal(12),
        historical: percentToDecimal(9),
      },
    });
    // ~2 years monthly → 24 × 500
    expect(series.years).toBeCloseTo(2, 1);
    expect(series.totalContributions).toBe(12000);
    expect(series.annualContribution).toBe(6000);
    expect(series.points.length).toBeGreaterThan(2);
    expect(series.terminal.min).toBeLessThan(series.terminal.expected);
    expect(series.terminal.expected).toBeLessThan(series.terminal.max);
    expect(series.terminal.historical).not.toBeNull();
    // 0% growth would end near principal + contributions; positive rates exceed that
    expect(series.terminal.expected).toBeGreaterThan(20000 + 10000);
  });

  it("longer end date produces longer path than shorter horizon", () => {
    const short = buildForecastProjection({
      principal: 10000,
      contributionAmount: 0,
      contributionFrequency: "none",
      startDate: "2026-01",
      endDate: "2031-01",
      rates: { min: 0.05, expected: 0.05, max: 0.05, historical: 0.05 },
    });
    const long = buildForecastProjection({
      principal: 10000,
      contributionAmount: 0,
      contributionFrequency: "none",
      startDate: "2026-01",
      endDate: "2046-01",
      rates: { min: 0.05, expected: 0.05, max: 0.05, historical: 0.05 },
    });
    expect(long.years).toBeGreaterThan(short.years);
    expect(long.points.length).toBeGreaterThan(short.points.length);
    expect(long.terminal.expected).toBeGreaterThan(short.terminal.expected);
  });

  it("open-ended horizonYears when end date omitted", () => {
    const series = buildForecastProjection({
      principal: 5000,
      contributionAmount: 100,
      contributionFrequency: "monthly",
      startDate: "2026-06",
      endDate: null,
      horizonYears: 10,
      rates: { min: 0.04, expected: 0.06, max: 0.08, historical: null },
    });
    expect(series.years).toBe(10);
    expect(series.totalContributions).toBe(12000);
    expect(series.terminal.historical).toBeNull();
    expect(series.points[0].historical).toBeNull();
  });

  it("plots December year-ends and a non-anniversary end date", () => {
    const series = buildForecastProjection({
      principal: 10000,
      contributionAmount: 0,
      contributionFrequency: "none",
      startDate: "2026-07",
      endDate: "2033-11",
      rates: { min: 0, expected: 0, max: 0, historical: null },
    });
    expect(series.points.map((p) => p.asOf)).toEqual([
      "2026-07",
      "2026-12",
      "2027-12",
      "2028-12",
      "2029-12",
      "2030-12",
      "2031-12",
      "2032-12",
      "2033-11",
    ]);
    expect(series.points.map((p) => p.label)).toEqual(
      series.points.map((p) => p.asOf),
    );
    expect(series.points[0].year).toBe(0);
    expect(series.points[1].year).toBeGreaterThan(0);
    expect(series.points[1].year).toBeLessThan(1);
    expect(series.points[series.points.length - 1].year).toBeCloseTo(
      series.years,
      8,
    );
  });
});

describe("typicalMonthlyDeposits", () => {
  it("averages the lookback including $0 months and rounds to $50", () => {
    const { amount, droppedOutlier, monthsUsed } = typicalMonthlyDeposits([
      500, 500, 500, 0, 500, 500, 500, 0, 500, 500, 500, 500,
    ]);
    expect(droppedOutlier).toBe(false);
    expect(monthsUsed).toBe(12);
    // 5000 / 12 = 416.67 → 400
    expect(amount).toBe(400);
  });

  it("drops a one-off transfer that is more than half the lookback total", () => {
    const deposits = [
      7500, 0, 12055, 8384, 5462, 1558, 0, 0, 0, 0, 13, 127745,
    ];
    const { amount, droppedOutlier, monthsUsed } = typicalMonthlyDeposits(
      deposits,
    );
    expect(droppedOutlier).toBe(true);
    expect(monthsUsed).toBe(11);
    const withoutJuly = deposits.slice(0, 11).reduce((s, n) => s + n, 0);
    expect(amount).toBe(Math.round(withoutJuly / 11 / 50) * 50);
  });

  it("returns 0 when every month is empty", () => {
    expect(typicalMonthlyDeposits([0, 0, 0]).amount).toBe(0);
    expect(typicalMonthlyDeposits([]).amount).toBe(0);
  });
});

describe("ratePercentFromDecimal", () => {
  it("rounds to one decimal percent", () => {
    expect(ratePercentFromDecimal(0.14123)).toBe(14.1);
    expect(ratePercentFromDecimal(-0.012)).toBe(-1.2);
    expect(ratePercentFromDecimal(null)).toBeNull();
  });
});
