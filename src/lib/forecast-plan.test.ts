import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORECAST_PLAN,
  sanitizeForecastPlan,
} from "@/lib/forecast-plan";

describe("sanitizeForecastPlan", () => {
  it("returns defaults for garbage", () => {
    expect(sanitizeForecastPlan(null)).toEqual(DEFAULT_FORECAST_PLAN);
    expect(sanitizeForecastPlan("nope")).toEqual(DEFAULT_FORECAST_PLAN);
    expect(sanitizeForecastPlan({})).toEqual(DEFAULT_FORECAST_PLAN);
  });

  it("keeps valid contribution, frequency, end date, inflation, and goal", () => {
    expect(
      sanitizeForecastPlan({
        version: 1,
        contributionAmount: "500",
        frequency: "biweekly",
        useEndDate: true,
        endDate: "2033-11",
        inflationPct: "2.5",
        goalTarget: "1000000",
        minPct: "2",
        expectedPct: "8",
        maxPct: "15",
        todayDollars: false,
      }),
    ).toEqual({
      contributionAmount: "500",
      frequency: "biweekly",
      useEndDate: true,
      endDate: "2033-11",
      inflationPct: "2.5",
      goalTarget: "1000000",
      minPct: "2",
      expectedPct: "8",
      maxPct: "15",
      todayDollars: false,
    });
  });

  it("drops invalid amount, frequency, and end date", () => {
    expect(
      sanitizeForecastPlan({
        contributionAmount: "abc",
        frequency: "hourly",
        useEndDate: "yes",
        endDate: "11/2033",
      }),
    ).toEqual(DEFAULT_FORECAST_PLAN);
  });

  it("keeps in-progress end dates so the field can be typed", () => {
    for (const draft of ["2", "20", "2026", "2026-", "2026-0", "2026-1"]) {
      expect(sanitizeForecastPlan({ endDate: draft }).endDate).toBe(draft);
    }
    expect(sanitizeForecastPlan({ endDate: "2026-11-01" }).endDate).toBe(
      "2026-11",
    );
  });

  it("rejects a negative contribution", () => {
    expect(sanitizeForecastPlan({ contributionAmount: "-10" }).contributionAmount).toBe(
      "",
    );
  });

  it("treats a missing amount as follow-typical, not zero", () => {
    expect(sanitizeForecastPlan({}).contributionAmount).toBe("");
    expect(DEFAULT_FORECAST_PLAN.contributionAmount).toBe("");
  });

  it("defaults missing inflation to 2% and missing goal to empty", () => {
    const plan = sanitizeForecastPlan({ contributionAmount: "100" });
    expect(plan.inflationPct).toBe("2");
    expect(plan.goalTarget).toBe("");
    expect(DEFAULT_FORECAST_PLAN.inflationPct).toBe("2");
    expect(DEFAULT_FORECAST_PLAN.goalTarget).toBe("");
  });

  it("rejects a negative inflation or goal", () => {
    expect(sanitizeForecastPlan({ inflationPct: "-1" }).inflationPct).toBe("2");
    expect(sanitizeForecastPlan({ goalTarget: "-50" }).goalTarget).toBe("");
  });

  it("keeps in-progress inflation and goal drafts", () => {
    expect(sanitizeForecastPlan({ inflationPct: "2." }).inflationPct).toBe("2.");
    expect(sanitizeForecastPlan({ goalTarget: "0." }).goalTarget).toBe("0.");
  });

  it("defaults missing planning rates to 3 / 7 / 12", () => {
    const plan = sanitizeForecastPlan({});
    expect(plan.minPct).toBe("3");
    expect(plan.expectedPct).toBe("7");
    expect(plan.maxPct).toBe("12");
  });

  it("defaults today's dollars on, and keeps an explicit off", () => {
    expect(sanitizeForecastPlan({}).todayDollars).toBe(true);
    expect(sanitizeForecastPlan({ todayDollars: false }).todayDollars).toBe(
      false,
    );
    expect(DEFAULT_FORECAST_PLAN.todayDollars).toBe(true);
  });

  it("keeps negative and in-progress planning rates", () => {
    expect(sanitizeForecastPlan({ minPct: "-2" }).minPct).toBe("-2");
    expect(sanitizeForecastPlan({ expectedPct: "-" }).expectedPct).toBe("-");
    expect(sanitizeForecastPlan({ maxPct: "12." }).maxPct).toBe("12.");
    expect(sanitizeForecastPlan({ minPct: "nope" }).minPct).toBe("3");
  });
});
