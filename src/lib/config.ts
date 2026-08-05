/**
 * User-local configuration for PDF discovery, chart windows, account groups,
 * currency, and benchmarks. Committed defaults live in config/config.example.json;
 * optional config/config.local.json overrides (gitignored).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import exampleConfig from "../../config/config.example.json";

export interface ChartStartWindow {
  id: string;
  label: string;
}

export interface AccountGroupConfig {
  name: string;
  memberIds: string[];
}

export interface BrokerConfig {
  /** Institution slug used in stable account ids (e.g. "questrade", "wealthsimple"). */
  id: string;
  /** Display name on the dashboard. */
  name: string;
  /**
   * Subfolder under pdfRoot (relative) where this broker's PDFs live.
   * May include nested year/account folders; discovery is recursive for *.pdf.
   */
  folder: string;
  /** Parser registry key (must match a registered extractor). */
  parser: string;
}

export interface BenchmarkConfig {
  /** Stable id used in prices JSON and charts (e.g. "XEQT"). */
  id: string;
  /** Yahoo Finance symbol for fetch_benchmarks.py. */
  yahoo: string;
  /** Native quote currency of the index. */
  currency: "CAD" | "USD" | string;
  /** Optional legend note. */
  label?: string;
}

export interface AppConfig {
  schemaVersion: number;
  /** Absolute or ~ -expanded path to the folder that contains broker subfolders. */
  pdfRoot: string;
  brokers: BrokerConfig[];
  chartStartWindows: ChartStartWindow[];
  defaultChartStart: string;
  accountGroups: AccountGroupConfig[];
  currency: string;
  benchmarks: BenchmarkConfig[];
}

const DEFAULTS: AppConfig = exampleConfig as AppConfig;

/**
 * Resolve app config. Merges a partial local override onto example defaults.
 */
export function resolveConfig(local?: Partial<AppConfig> | null): AppConfig {
  if (!local) return structuredClone(DEFAULTS);
  return {
    ...structuredClone(DEFAULTS),
    ...local,
    brokers: local.brokers ?? DEFAULTS.brokers,
    chartStartWindows: local.chartStartWindows ?? DEFAULTS.chartStartWindows,
    accountGroups: local.accountGroups ?? DEFAULTS.accountGroups,
    benchmarks: local.benchmarks ?? DEFAULTS.benchmarks,
  };
}

/** Example/default config shipped in the repo (safe to commit). */
export function getExampleConfig(): AppConfig {
  return structuredClone(DEFAULTS);
}

/**
 * Server-only: load config/config.local.json when present, else example.
 * Uses fs so Next never fails the bundle when the local file is absent.
 */
export function getAppConfig(): AppConfig {
  try {
    const localPath = join(process.cwd(), "config", "config.local.json");
    if (existsSync(localPath)) {
      const local = JSON.parse(readFileSync(localPath, "utf8")) as Partial<AppConfig>;
      return resolveConfig(local);
    }
  } catch {
    // fall through
  }
  return getExampleConfig();
}

export function defaultChartStartId(config: AppConfig): string {
  const ids = new Set(config.chartStartWindows.map((w) => w.id));
  if (ids.has(config.defaultChartStart)) return config.defaultChartStart;
  return config.chartStartWindows[0]?.id ?? "";
}
