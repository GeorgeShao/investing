import { describe, expect, it } from "vitest";
import {
  getPortfolioData,
  hasLocalConfig,
  hasPortfolioData,
} from "@/lib/data";

describe("portfolio data loaders", () => {
  it("hasPortfolioData matches getPortfolioData non-null", () => {
    const data = getPortfolioData();
    expect(hasPortfolioData()).toBe(data !== null);
    if (data) {
      expect(data.periods.length).toBeGreaterThan(0);
      expect(data.meta.currency).toBeTruthy();
    }
  });

  it("hasLocalConfig is a boolean (file optional)", () => {
    expect(typeof hasLocalConfig()).toBe("boolean");
  });
});
