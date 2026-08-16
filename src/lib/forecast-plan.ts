/**
 * Browser prefs for the forecast contribution / end-date controls.
 * Principal and rates stay computed; data.json is untouched.
 */

import {
  parsePlanDate,
  type ContributionFrequency,
} from "@/lib/forecast";

export const FORECAST_PLAN_STORAGE_KEY = "investing.forecast-plan";

const FREQUENCIES = new Set<ContributionFrequency>([
  "none",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annually",
]);

export interface ForecastPlanPrefs {
  contributionAmount: string;
  frequency: ContributionFrequency;
  useEndDate: boolean;
  endDate: string;
}

export const DEFAULT_FORECAST_PLAN: ForecastPlanPrefs = {
  /** Empty means follow typical deposits from the analysis window. */
  contributionAmount: "",
  frequency: "monthly",
  useEndDate: false,
  endDate: "",
};

function isFrequency(v: unknown): v is ContributionFrequency {
  return typeof v === "string" && FREQUENCIES.has(v as ContributionFrequency);
}

function sanitizeAmount(raw: unknown): string {
  if (raw === undefined || raw === null) {
    return DEFAULT_FORECAST_PLAN.contributionAmount;
  }
  if (typeof raw !== "string" && typeof raw !== "number") {
    return DEFAULT_FORECAST_PLAN.contributionAmount;
  }
  const s = String(raw).trim();
  if (s === "" || s === "." || s === "0.") return s;
  if (!Number.isFinite(Number(s)) || Number(s) < 0) {
    return DEFAULT_FORECAST_PLAN.contributionAmount;
  }
  return s;
}

/**
 * Allow incomplete `YYYY-MM` while typing. The old "valid month or empty"
 * rule wiped each keystroke (`2` → `""`), so the field looked uneditable.
 * Projection already ignores dates that fail {@link parsePlanDate}.
 */
const END_DATE_DRAFT = /^\d{1,4}(-\d{0,2}(-\d{0,2})?)?$/;

function sanitizeEndDate(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (s === "") return "";
  if (parsePlanDate(s) || parsePlanDate(s.slice(0, 7))) {
    return s.slice(0, 7);
  }
  if (END_DATE_DRAFT.test(s) && s.length <= 10) return s;
  return "";
}

/** Accept a raw payload or `{ version, ...prefs }` and fill safe defaults. */
export function sanitizeForecastPlan(raw: unknown): ForecastPlanPrefs {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    contributionAmount: sanitizeAmount(obj.contributionAmount),
    frequency: isFrequency(obj.frequency)
      ? obj.frequency
      : DEFAULT_FORECAST_PLAN.frequency,
    useEndDate: obj.useEndDate === true,
    endDate: sanitizeEndDate(obj.endDate),
  };
}

export function loadForecastPlan(): ForecastPlanPrefs {
  if (typeof window === "undefined") return DEFAULT_FORECAST_PLAN;
  try {
    const raw = window.localStorage.getItem(FORECAST_PLAN_STORAGE_KEY);
    if (!raw) return DEFAULT_FORECAST_PLAN;
    return sanitizeForecastPlan(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_FORECAST_PLAN;
  }
}

export function saveForecastPlan(prefs: ForecastPlanPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FORECAST_PLAN_STORAGE_KEY,
      JSON.stringify({ version: 1, ...sanitizeForecastPlan(prefs) }),
    );
  } catch {
    // private mode / quota
  }
}
