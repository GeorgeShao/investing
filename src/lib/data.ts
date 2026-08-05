import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import samplePortfolio from "../../data/sample-portfolio.json";
import type { PortfolioData } from "@/lib/types";

/**
 * Load portfolio data for the dashboard.
 *
 * Priority:
 * 1. data/data.json — real extract output (optional, gitignored)
 * 2. data/sample-portfolio.json — committed synthetic fixture
 *
 * Uses fs for the optional real file so Next builds without it present.
 */
export function getPortfolioData(): PortfolioData {
  try {
    const realPath = join(process.cwd(), "data", "data.json");
    if (existsSync(realPath)) {
      const real = JSON.parse(readFileSync(realPath, "utf8")) as PortfolioData;
      if (real?.periods?.length) {
        return real;
      }
    }
  } catch {
    // fall through to sample
  }
  return samplePortfolio as unknown as PortfolioData;
}
