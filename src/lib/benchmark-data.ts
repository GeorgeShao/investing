import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkFile } from "@/lib/benchmarks";

const EMPTY: BenchmarkFile = {
  meta: {
    source: "none",
    notes: [
      "No data/benchmarks.json found. Run: python scripts/fetch_benchmarks.py",
    ],
  },
  prices: {},
};

export function hasBenchmarkData(): boolean {
  try {
    const path = join(process.cwd(), "data", "benchmarks.json");
    if (!existsSync(path)) return false;
    const raw = JSON.parse(readFileSync(path, "utf8")) as BenchmarkFile;
    const prices = raw?.prices ?? {};
    return Object.keys(prices).some(
      (k) =>
        k !== "USDCAD" &&
        prices[k] &&
        Object.keys(prices[k] as object).length > 0,
    );
  } catch {
    return false;
  }
}

/**
 * Offline benchmark month-end prices.
 * Missing file → empty prices (charts render with portfolio-only / null index lines).
 * Generate with: python scripts/fetch_benchmarks.py
 */
export function getBenchmarkData(): BenchmarkFile {
  try {
    const path = join(process.cwd(), "data", "benchmarks.json");
    if (!existsSync(path)) return EMPTY;
    const raw = JSON.parse(readFileSync(path, "utf8")) as BenchmarkFile;
    if (!raw?.prices) return EMPTY;
    return raw;
  } catch {
    return EMPTY;
  }
}
