import raw from "../../data/benchmarks.json";
import type { BenchmarkFile } from "@/lib/benchmarks";

/**
 * Offline benchmark month-end prices. Empty-safe: missing tickers yield nulls
 * in comparison series rather than throwing.
 */
export function getBenchmarkData(): BenchmarkFile {
  return raw as unknown as BenchmarkFile;
}
