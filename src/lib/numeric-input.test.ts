import { describe, expect, it } from "vitest";
import {
  isLoneNumericZero,
  normalizeNumericInput,
} from "@/lib/numeric-input";

describe("normalizeNumericInput", () => {
  it("keeps mid-edit prefixes", () => {
    expect(normalizeNumericInput("")).toBe("");
    expect(normalizeNumericInput("-")).toBe("-");
    expect(normalizeNumericInput(".")).toBe(".");
    expect(normalizeNumericInput("-.")).toBe("-.");
  });

  it("strips integer leading zeros and leaves a single zero", () => {
    expect(normalizeNumericInput("0")).toBe("0");
    expect(normalizeNumericInput("00")).toBe("0");
    expect(normalizeNumericInput("07")).toBe("7");
    expect(normalizeNumericInput("007")).toBe("7");
    expect(normalizeNumericInput("50")).toBe("50");
    expect(normalizeNumericInput("-07")).toBe("-7");
    expect(normalizeNumericInput("-0")).toBe("-0");
  });

  it("strips zeros before a decimal without touching the fraction", () => {
    expect(normalizeNumericInput("0.")).toBe("0.");
    expect(normalizeNumericInput("0.5")).toBe("0.5");
    expect(normalizeNumericInput("00.5")).toBe("0.5");
    expect(normalizeNumericInput("007.50")).toBe("7.50");
    expect(normalizeNumericInput(".5")).toBe("0.5");
    expect(normalizeNumericInput("-00.5")).toBe("-0.5");
    expect(normalizeNumericInput("0.0")).toBe("0.0");
  });

  it("leaves scientific notation alone", () => {
    expect(normalizeNumericInput("1e2")).toBe("1e2");
  });
});

describe("isLoneNumericZero", () => {
  it("matches only a typed zero", () => {
    expect(isLoneNumericZero("0")).toBe(true);
    expect(isLoneNumericZero("-0")).toBe(true);
    expect(isLoneNumericZero("0.0")).toBe(true);
    expect(isLoneNumericZero("0.5")).toBe(false);
    expect(isLoneNumericZero("10")).toBe(false);
    expect(isLoneNumericZero("")).toBe(false);
  });
});
