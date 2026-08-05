import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PortfolioData } from "@/lib/types";

function dataJsonPath(): string {
  return join(process.cwd(), "data", "data.json");
}

function localConfigPath(): string {
  return join(process.cwd(), "config", "config.local.json");
}

/** True when a non-empty portfolio extract exists at data/data.json. */
export function hasPortfolioData(): boolean {
  try {
    const path = dataJsonPath();
    if (!existsSync(path)) return false;
    const raw = JSON.parse(readFileSync(path, "utf8")) as PortfolioData;
    return Array.isArray(raw?.periods) && raw.periods.length > 0;
  } catch {
    return false;
  }
}

/** True when the user has a local config override (gitignored). */
export function hasLocalConfig(): boolean {
  return existsSync(localConfigPath());
}

/**
 * Load portfolio data for the dashboard.
 * Requires data/data.json from scripts/run_extract.py — no sample fallback.
 */
export function getPortfolioData(): PortfolioData | null {
  try {
    const path = dataJsonPath();
    if (!existsSync(path)) return null;
    const real = JSON.parse(readFileSync(path, "utf8")) as PortfolioData;
    if (real?.periods?.length) return real;
  } catch {
    // ignore
  }
  return null;
}
