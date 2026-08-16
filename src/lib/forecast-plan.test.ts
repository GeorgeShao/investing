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

  it("keeps valid contribution, frequency, end date, and checkbox", () => {
    expect(
      sanitizeForecastPlan({
        version: 1,
        contributionAmount: "500",
        frequency: "biweekly",
        useEndDate: true,
        endDate: "2033-11",
      }),
    ).toEqual({
      contributionAmount: "500",
      frequency: "biweekly",
      useEndDate: true,
      endDate: "2033-11",
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
});
