import { describe, expect, it } from "vitest";
import {
  defaultChartStartId,
  getExampleConfig,
  resolveConfig,
} from "@/lib/config";

describe("resolveConfig", () => {
  it("returns example defaults with chart windows and brokers", () => {
    const cfg = getExampleConfig();
    expect(cfg.schemaVersion).toBe(1);
    expect(cfg.brokers.length).toBeGreaterThanOrEqual(2);
    expect(cfg.brokers.map((b) => b.parser).sort()).toEqual(
      [
        "fidelity_employer",
        "fidelity_personal",
        "questrade",
        "wealthsimple",
      ].sort(),
    );
    expect(cfg.chartStartWindows.length).toBeGreaterThanOrEqual(1);
    expect(cfg.benchmarks.some((b) => b.id === "XEQT")).toBe(true);
  });

  it("merges local overrides without dropping arrays when provided", () => {
    const cfg = resolveConfig({
      defaultChartStart: "2023-11",
      currency: "USD",
      accountGroups: [
        { name: "Grouped", memberIds: ["a", "b"] },
      ],
    });
    expect(cfg.defaultChartStart).toBe("2023-11");
    expect(cfg.currency).toBe("USD");
    expect(cfg.accountGroups).toEqual([
      { name: "Grouped", memberIds: ["a", "b"] },
    ]);
    // brokers still from example
    expect(cfg.brokers.length).toBeGreaterThanOrEqual(2);
  });

  it("defaultChartStartId falls back when missing", () => {
    const cfg = getExampleConfig();
    expect(defaultChartStartId(cfg)).toBe(cfg.defaultChartStart);
    expect(
      defaultChartStartId({
        ...cfg,
        defaultChartStart: "not-a-real-window",
      }),
    ).toBe(cfg.chartStartWindows[0].id);
  });
});
