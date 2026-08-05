import { describe, expect, it } from "vitest";
import {
  buildForecastSeries,
  contributionPerEvent,
  periodsPerYear,
  projectBalance,
} from "@/lib/forecast";

describe("contributionPerEvent / periodsPerYear", () => {
  it("splits annual contribution by frequency", () => {
    expect(contributionPerEvent(1200, "monthly")).toBe(100);
    expect(contributionPerEvent(1200, "annually")).toBe(1200);
    expect(contributionPerEvent(1200, "none")).toBe(0);
    expect(periodsPerYear("monthly")).toBe(12);
    expect(periodsPerYear("annually")).toBe(1);
  });
});

describe("projectBalance", () => {
  it("grows principal with monthly compounding and no contributions", () => {
    // 10k at 12% annual, monthly compound, 1 year, no contrib
    // (1 + 0.12/12)^12 * 10000
    const end = projectBalance(10000, 0.12, 1, 0, "none", "monthly");
    expect(end).toBeCloseTo(10000 * Math.pow(1.01, 12), 6);
  });

  it("adds end-of-period monthly contributions", () => {
    // Ordinary annuity: 0 principal, $100/mo, 0% return, 1 year → 1200
    const end = projectBalance(0, 0, 1, 1200, "monthly", "monthly", true);
    expect(end).toBeCloseTo(1200, 6);
  });

  it("continuous compounding matches e^{rt} for zero contributions", () => {
    const end = projectBalance(1000, 0.05, 2, 0, "none", "continuous");
    expect(end).toBeCloseTo(1000 * Math.exp(0.05 * 2), 6);
  });
});

describe("buildForecastSeries", () => {
  it("returns min ≤ expected ≤ max paths from real projector", () => {
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
    expect(last.expected).toBeGreaterThan(10000);
  });
});
