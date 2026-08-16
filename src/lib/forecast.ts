/**
 * Pure return-forecasting helpers.
 *
 * Projects portfolio value under constant annual rates with regular contributions.
 * UI passes per-event contribution amount + frequency and start/end dates;
 * all compound-growth math lives here (no React-side reimplementation).
 */

export type ContributionFrequency =
  | "none"
  | "monthly"
  | "biweekly"
  | "weekly"
  | "quarterly"
  | "annually";

export type CompoundingFrequency =
  | "monthly"
  | "quarterly"
  | "annually"
  | "continuous";

export interface ForecastScenarioRates {
  /** Decimal annual return, e.g. 0.07 for 7%. */
  min: number;
  expected: number;
  max: number;
  /** Optional historical realized annualized return for reference. */
  historical?: number | null;
}

/**
 * Core projection inputs (years + annual contribution total).
 * Prefer {@link ForecastPlanInputs} from the UI for per-event amounts and dates.
 */
export interface ForecastInputs {
  principal: number;
  years: number;
  /** Annual contribution total (sum of per-event amounts over a year). */
  annualContribution: number;
  contributionFrequency: ContributionFrequency;
  compounding: CompoundingFrequency;
  rates: ForecastScenarioRates;
  contributionAtEnd?: boolean;
}

/**
 * UI-oriented plan: contribution amount per event + calendar horizon.
 */
export interface ForecastPlanInputs {
  principal: number;
  /** Dollars deposited each contribution event (ignored when frequency is none). */
  contributionAmount: number;
  contributionFrequency: ContributionFrequency;
  /**
   * Forecast start as `YYYY-MM` or `YYYY-MM-DD`.
   * Used for chart labels and year-span calculation.
   */
  startDate: string;
  /**
   * Optional end as `YYYY-MM` or `YYYY-MM-DD`.
   * When omitted, {@link horizonYears} is applied from start.
   */
  endDate?: string | null;
  /** Open-ended horizon in years when endDate is empty. Default 20. */
  horizonYears?: number;
  compounding?: CompoundingFrequency;
  rates: ForecastScenarioRates;
  contributionAtEnd?: boolean;
}

export interface ForecastPoint {
  /** Years from start (0 at start). */
  year: number;
  /**
   * Chart label. Dated plans use `YYYY-MM` (December year-ends plus the
   * real start/end). The years-only API uses Y0 / Y1 / ….
   */
  label: string;
  /** Calendar month at this point (`YYYY-MM`) when start is known. */
  asOf?: string;
  min: number;
  expected: number;
  max: number;
  historical: number | null;
}

export interface ForecastSeries {
  points: ForecastPoint[];
  steps: number;
  periodsPerYear: number;
  /** Horizon used (years). */
  years: number;
  /** Annual contribution total implied by amount × frequency. */
  annualContribution: number;
  /** Sum of all contribution events over the full horizon (no growth). */
  totalContributions: number;
  /** Terminal balances for each scenario. */
  terminal: {
    min: number;
    expected: number;
    max: number;
    historical: number | null;
  };
}

export const CONTRIBUTION_FREQUENCY_OPTIONS: Array<{
  value: ContributionFrequency;
  label: string;
}> = [
  { value: "none", label: "None" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
];

export const COMPOUNDING_OPTIONS: Array<{
  value: CompoundingFrequency;
  label: string;
}> = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
  { value: "continuous", label: "Continuous" },
];

const FREQ_PER_YEAR: Record<ContributionFrequency, number> = {
  none: 0,
  monthly: 12,
  biweekly: 26,
  weekly: 52,
  quarterly: 4,
  annually: 1,
};

const COMPOUND_PER_YEAR: Record<
  Exclude<CompoundingFrequency, "continuous">,
  number
> = {
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

export function contributionsPerYear(frequency: ContributionFrequency): number {
  return FREQ_PER_YEAR[frequency];
}

export function periodsPerYear(compounding: CompoundingFrequency): number {
  if (compounding === "continuous") return 12;
  return COMPOUND_PER_YEAR[compounding];
}

export function periodicRate(annualRate: number, n: number): number {
  if (n <= 0) return 0;
  return annualRate / n;
}

/**
 * Annual contribution total from amount deposited each event.
 * e.g. $500 monthly → $6000 / year.
 */
export function annualContributionFromAmount(
  contributionAmount: number,
  frequency: ContributionFrequency,
): number {
  if (frequency === "none" || !(contributionAmount > 0)) return 0;
  return contributionAmount * FREQ_PER_YEAR[frequency];
}

/**
 * @deprecated Prefer annualContributionFromAmount; kept for call sites that
 * still think in annual totals and need per-event size.
 */
export function contributionPerEvent(
  annualContribution: number,
  frequency: ContributionFrequency,
): number {
  const n = FREQ_PER_YEAR[frequency];
  if (n <= 0 || annualContribution === 0) return 0;
  return annualContribution / n;
}

/**
 * Nominal total contributions over `years` (no growth): events × amount.
 * Event count is round(years × eventsPerYear) so calendar spans like
 * 2026-01 → 2028-01 (~2y) map to a full 24 monthly deposits.
 */
export function totalContributionsOverYears(
  contributionAmount: number,
  frequency: ContributionFrequency,
  years: number,
): number {
  if (frequency === "none" || !(contributionAmount > 0) || !(years > 0)) {
    return 0;
  }
  const n = FREQ_PER_YEAR[frequency];
  const events = Math.max(0, Math.round(years * n));
  return events * contributionAmount;
}

/** Parse `YYYY-MM` or `YYYY-MM-DD` to UTC date at month start (or day if given). */
export function parsePlanDate(raw: string): Date | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = m[3] ? Number(m[3]) : 1;
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

export function formatPlanMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Years between start and end (end exclusive of fractional month precision:
 * uses day difference / 365.25). Returns null if either date is invalid or
 * end is before start.
 */
export function yearsBetweenDates(startRaw: string, endRaw: string): number | null {
  const a = parsePlanDate(startRaw);
  const b = parsePlanDate(endRaw);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  if (ms < 0) return null;
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Resolve horizon years from plan inputs.
 * Prefers endDate when valid and after start; otherwise horizonYears (default 20).
 */
export function resolveHorizonYears(plan: {
  startDate: string;
  endDate?: string | null;
  horizonYears?: number;
}): number {
  const end = plan.endDate?.trim();
  if (end) {
    const y = yearsBetweenDates(plan.startDate, end);
    if (y != null && y > 0) return y;
  }
  const h = plan.horizonYears;
  if (typeof h === "number" && Number.isFinite(h) && h > 0) return h;
  return 20;
}

/** End month used for December ticks: explicit end date, else start + horizon. */
function resolveEndMonth(
  plan: Pick<ForecastPlanInputs, "startDate" | "endDate">,
  years: number,
): string | undefined {
  const end = plan.endDate?.trim();
  if (end) {
    const span = yearsBetweenDates(plan.startDate, end);
    if (span != null && span > 0) {
      const parsed = parsePlanDate(end);
      if (parsed) return formatPlanMonth(parsed);
    }
  }
  return addYearsToStart(plan.startDate, years);
}

/**
 * Project a single path under constant annual rate with regular contributions.
 *
 * Contributions are converted to an annual total (amount × frequency) and then
 * applied evenly across each compound sub-period:
 *   contrib_per_step = annualContribution / compound_periods_per_year
 * so weekly/biweekly deposits are fully counted even when compounding is monthly
 * (and monthly deposits when compounding is annual). This keeps 0%-rate terminals
 * equal to principal + totalContributions for whole-year horizons.
 */
export function projectBalance(
  principal: number,
  annualRate: number,
  years: number,
  annualContribution: number,
  contributionFrequency: ContributionFrequency,
  compounding: CompoundingFrequency,
  contributionAtEnd = true,
): number {
  if (!(years >= 0) || !Number.isFinite(years)) return principal;
  if (years === 0) return principal;
  if (!Number.isFinite(principal)) return 0;
  if (!Number.isFinite(annualRate)) annualRate = 0;
  if (
    contributionFrequency === "none" ||
    !Number.isFinite(annualContribution) ||
    annualContribution < 0
  ) {
    annualContribution = 0;
  }

  if (compounding === "continuous") {
    return projectContinuous(
      principal,
      annualRate,
      years,
      annualContribution,
      contributionFrequency,
    );
  }

  const n = COMPOUND_PER_YEAR[compounding];
  const totalSteps = Math.round(years * n);
  if (totalSteps <= 0) return principal;
  const r = periodicRate(annualRate, n);
  // Lump the full annual contribution stream into each compound step so
  // high-frequency deposits are not under-counted vs coarser compounding.
  const contribPerStep =
    annualContribution > 0 ? annualContribution / n : 0;

  let balance = principal;
  for (let step = 1; step <= totalSteps; step++) {
    if (!contributionAtEnd && contribPerStep > 0) {
      balance += contribPerStep;
    }
    balance *= 1 + r;
    if (contributionAtEnd && contribPerStep > 0) {
      balance += contribPerStep;
    }
  }
  return balance;
}

function projectContinuous(
  principal: number,
  annualRate: number,
  years: number,
  annualContribution: number,
  contributionFrequency: ContributionFrequency,
): number {
  const c = contributionFrequency === "none" ? 0 : annualContribution;
  if (Math.abs(annualRate) < 1e-12) {
    return principal + c * years;
  }
  const growth = Math.exp(annualRate * years);
  return principal * growth + (c / annualRate) * (growth - 1);
}

/**
 * Advance a plan start date by a year offset using calendar arithmetic
 * (not 365.25-day ms), so leap years don't collapse adjacent labels
 * (e.g. 2028 + 2028).
 */
export function addYearsToStart(
  startRaw: string,
  years: number,
): string | undefined {
  const d = parsePlanDate(startRaw);
  if (!d || !Number.isFinite(years)) return undefined;
  const whole = Math.trunc(years);
  const frac = years - whole;
  // Fractional years → extra months (round to nearest month for chart ticks)
  const extraMonths = Math.round(frac * 12);
  const totalMonths =
    d.getUTCFullYear() * 12 + d.getUTCMonth() + whole * 12 + extraMonths;
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  const day = d.getUTCDate();
  // Clamp day for short months (e.g. Jan 31 + 1 month)
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return formatPlanMonth(new Date(Date.UTC(y, m, safeDay)));
}

/**
 * Axis label for a year-offset point. Integer offsets use calendar year
 * (unique when marks are 0..N). Fractional offsets use YYYY-MM.
 */
export function labelForYearOffset(
  startRaw: string,
  yearOffset: number,
): string {
  const asOf = addYearsToStart(startRaw, yearOffset);
  if (!asOf) {
    if (yearOffset === 0) return "Y0";
    return Number.isInteger(yearOffset)
      ? `Y${yearOffset}`
      : `Y${yearOffset.toFixed(1)}`;
  }
  if (Number.isInteger(yearOffset) || yearOffset === 0) {
    return asOf.slice(0, 4);
  }
  return asOf;
}

/**
 * Chart months for a dated forecast: start, each December on the path,
 * then the end month if it is not already December.
 *
 * A December after the end is omitted (start 2026-07, end 2033-11 → last
 * year-end is 2032-12, then 2033-11 — not 2033-12).
 */
export function listForecastTickMonths(
  startRaw: string,
  endRaw: string,
): string[] {
  const start = parsePlanDate(startRaw);
  const end = parsePlanDate(endRaw);
  if (!start || !end) return [];
  const startMonth = formatPlanMonth(start);
  const endMonth = formatPlanMonth(end);
  const startYm = start.getUTCFullYear() * 12 + start.getUTCMonth();
  const endYm = end.getUTCFullYear() * 12 + end.getUTCMonth();
  if (endYm < startYm) return [startMonth];

  const ticks: string[] = [startMonth];
  const firstDecYear =
    start.getUTCMonth() === 11
      ? start.getUTCFullYear() + 1
      : start.getUTCFullYear();
  for (let year = firstDecYear; year <= end.getUTCFullYear(); year++) {
    const decYm = year * 12 + 11;
    if (decYm > endYm) break;
    if (decYm > startYm) ticks.push(`${year}-12`);
  }
  if (ticks[ticks.length - 1] !== endMonth) ticks.push(endMonth);
  return ticks;
}

function pointAtYear(
  year: number,
  label: string,
  asOf: string | undefined,
  principal: number,
  rates: ForecastScenarioRates,
  annualContribution: number,
  contributionFrequency: ContributionFrequency,
  compounding: CompoundingFrequency,
  contributionAtEnd: boolean,
): ForecastPoint {
  const histOk =
    rates.historical != null && Number.isFinite(rates.historical);
  return {
    year,
    label,
    asOf,
    min: projectBalance(
      principal,
      rates.min,
      year,
      annualContribution,
      contributionFrequency,
      compounding,
      contributionAtEnd,
    ),
    expected: projectBalance(
      principal,
      rates.expected,
      year,
      annualContribution,
      contributionFrequency,
      compounding,
      contributionAtEnd,
    ),
    max: projectBalance(
      principal,
      rates.max,
      year,
      annualContribution,
      contributionFrequency,
      compounding,
      contributionAtEnd,
    ),
    historical: histOk
      ? projectBalance(
          principal,
          rates.historical as number,
          year,
          annualContribution,
          contributionFrequency,
          compounding,
          contributionAtEnd,
        )
      : null,
  };
}

/**
 * Build multi-scenario forecast series (legacy years + annual contribution API).
 */
export function buildForecastSeries(inputs: ForecastInputs): ForecastSeries {
  const {
    principal: rawPrincipal,
    years: rawYears,
    annualContribution: rawAnnual,
    contributionFrequency,
    compounding,
    rates,
    contributionAtEnd = true,
  } = inputs;

  const principal = Number.isFinite(rawPrincipal) ? Math.max(0, rawPrincipal) : 0;
  const years =
    Number.isFinite(rawYears) && rawYears > 0 ? rawYears : 0;
  const annualContribution =
    Number.isFinite(rawAnnual) && rawAnnual > 0 ? rawAnnual : 0;

  const n = periodsPerYear(compounding);
  const totalSteps = years > 0 ? Math.max(1, Math.round(years * n)) : 0;
  const points: ForecastPoint[] = [
    pointAtYear(
      0,
      "Y0",
      undefined,
      principal,
      rates,
      annualContribution,
      contributionFrequency,
      compounding,
      contributionAtEnd,
    ),
  ];

  if (years > 0) {
    const yearMarks = new Set<number>();
    for (let y = 1; y <= Math.floor(years); y++) yearMarks.add(y);
    yearMarks.add(years);

    for (const y of [...yearMarks].sort((a, b) => a - b)) {
      if (y === 0) continue;
      points.push(
        pointAtYear(
          y,
          Number.isInteger(y) ? `Y${y}` : `Y${y.toFixed(1)}`,
          undefined,
          principal,
          rates,
          annualContribution,
          contributionFrequency,
          compounding,
          contributionAtEnd,
        ),
      );
    }
  }

  const last = points[points.length - 1];
  const perEvent =
    contributionFrequency === "none"
      ? 0
      : contributionPerEvent(annualContribution, contributionFrequency);

  return {
    points,
    steps: totalSteps,
    periodsPerYear: n,
    years,
    annualContribution,
    totalContributions: totalContributionsOverYears(
      perEvent,
      contributionFrequency,
      years,
    ),
    terminal: {
      min: last.min,
      expected: last.expected,
      max: last.max,
      historical: last.historical,
    },
  };
}

/**
 * Primary entry for the Forecast UI: per-event amount + start/end dates.
 */
export function buildForecastProjection(plan: ForecastPlanInputs): ForecastSeries {
  const contributionFrequency = plan.contributionFrequency;
  const compounding = plan.compounding ?? "monthly";
  const contributionAtEnd = plan.contributionAtEnd ?? true;
  const amount =
    Number.isFinite(plan.contributionAmount) && plan.contributionAmount > 0
      ? plan.contributionAmount
      : 0;

  const years = resolveHorizonYears(plan);
  const annualContribution = annualContributionFromAmount(
    amount,
    contributionFrequency,
  );

  const series = buildForecastSeries({
    principal: plan.principal,
    years,
    annualContribution,
    contributionFrequency,
    compounding,
    rates: plan.rates,
    contributionAtEnd,
  });

  const start = plan.startDate?.trim() || "";
  const endMonth = resolveEndMonth(plan, years);
  if (parsePlanDate(start) && endMonth) {
    series.points = listForecastTickMonths(start, endMonth).map((asOf) => {
      const y = yearsBetweenDates(start, asOf) ?? 0;
      return pointAtYear(
        y,
        asOf,
        asOf,
        Number.isFinite(plan.principal) ? Math.max(0, plan.principal) : 0,
        plan.rates,
        annualContribution,
        contributionFrequency,
        compounding,
        contributionAtEnd,
      );
    });
    const last = series.points[series.points.length - 1];
    series.terminal = {
      min: last.min,
      expected: last.expected,
      max: last.max,
      historical: last.historical,
    };
  }

  // Prefer exact event count from per-event amount (avoids float annual split).
  series.totalContributions = totalContributionsOverYears(
    amount,
    contributionFrequency,
    years,
  );
  series.annualContribution = annualContribution;

  return series;
}

/** Percent → decimal; accepts already-decimal values in (-1, 1) cautiously only if |x|<=1 and user meant percent? No — always treat UI as percent. */
export function percentToDecimal(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return percent / 100;
}

export function decimalToPercent(decimal: number): number {
  if (!Number.isFinite(decimal)) return 0;
  return decimal * 100;
}

/** Default long-run planning rate shown as the expected path. */
export const PLANNING_ANNUAL_RETURN_PCT = 7;

export const HORIZON_YEAR_OPTIONS = [5, 10, 20, 30] as const;

/**
 * One-decimal percent for rate chips / inputs from a decimal return.
 * Returns null when the rate is missing.
 */
export function ratePercentFromDecimal(decimal: number | null): number | null {
  if (decimal == null || !Number.isFinite(decimal)) return null;
  return Math.round(decimalToPercent(decimal) * 10) / 10;
}

/**
 * Typical monthly contribution from a lookback of monthly deposit totals.
 *
 * Includes $0 months so a sporadic depositor is not treated as depositing
 * every month. Drops the single largest month when it is more than half the
 * lookback total (one-off transfers should not set the going-forward paycheck).
 * Rounds to `step` dollars (default $50).
 */
export function typicalMonthlyDeposits(
  monthlyDeposits: number[],
  options?: { step?: number; outlierShare?: number },
): { amount: number; droppedOutlier: boolean; monthsUsed: number } {
  const step = options?.step ?? 50;
  const outlierShare = options?.outlierShare ?? 0.5;
  const xs = monthlyDeposits.map((n) =>
    Number.isFinite(n) && n > 0 ? n : 0,
  );
  if (xs.length === 0) {
    return { amount: 0, droppedOutlier: false, monthsUsed: 0 };
  }
  const total = xs.reduce((sum, n) => sum + n, 0);
  const max = Math.max(...xs);
  let used = xs;
  let droppedOutlier = false;
  if (xs.length >= 3 && total > 0 && max > total * outlierShare) {
    const idx = xs.indexOf(max);
    used = xs.filter((_, i) => i !== idx);
    droppedOutlier = true;
  }
  const avg = used.reduce((sum, n) => sum + n, 0) / used.length;
  const amount = Math.round(avg / step) * step;
  return { amount, droppedOutlier, monthsUsed: used.length };
}
