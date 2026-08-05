/**
 * Pure return-forecasting helpers (extension point).
 *
 * Not wired into the dashboard UI yet — reserved for future projection views.
 * Inputs cover annual % return scenarios (min / expected / max / historical),
 * contribution frequency, and compounding frequency.
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

export interface ForecastInputs {
  /** Starting portfolio value in base currency. */
  principal: number;
  /** Years to project (fractional allowed). */
  years: number;
  /** Annual contribution amount (before frequency split). 0 if none. */
  annualContribution: number;
  contributionFrequency: ContributionFrequency;
  compounding: CompoundingFrequency;
  rates: ForecastScenarioRates;
  /**
   * When true, contributions are assumed at the end of each contribution
   * period (ordinary annuity). When false, beginning (annuity due).
   */
  contributionAtEnd?: boolean;
}

export interface ForecastPoint {
  /** Year fraction from start (0, 1/12, … or continuous steps). */
  year: number;
  /** Label suitable for charts, e.g. "Y0", "Y1", "Y5". */
  label: string;
  min: number;
  expected: number;
  max: number;
  historical: number | null;
}

export interface ForecastSeries {
  points: ForecastPoint[];
  /** Number of discrete steps used for non-continuous compounding. */
  steps: number;
  periodsPerYear: number;
}

const FREQ_PER_YEAR: Record<ContributionFrequency, number> = {
  none: 0,
  monthly: 12,
  biweekly: 26,
  weekly: 52,
  quarterly: 4,
  annually: 1,
};

const COMPOUND_PER_YEAR: Record<Exclude<CompoundingFrequency, "continuous">, number> = {
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

export function periodsPerYear(compounding: CompoundingFrequency): number {
  if (compounding === "continuous") return 12; // chart resolution only
  return COMPOUND_PER_YEAR[compounding];
}

/**
 * Periodic rate from annual nominal rate for discrete compounding:
 * r_period = (1 + r_annual)^(1/n) − 1  (effective) when using effective annual.
 * We use simple r_annual / n for ordinary projection (common spreadsheet model).
 */
export function periodicRate(annualRate: number, n: number): number {
  if (n <= 0) return 0;
  return annualRate / n;
}

/**
 * Contribution amount per contribution event from annual total.
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
 * Project a single path under constant annual rate with regular contributions.
 *
 * Discrete path (monthly/quarterly/annual compounding):
 *   for each compound period: balance *= (1+r_p); then add contribution if due.
 *
 * Continuous:
 *   V(t) = V0·e^{rt} + C_annual/r · (e^{rt} − 1) when contributions are continuous
 *   (and r ≠ 0). Falls back to discrete monthly when r ≈ 0.
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
  const r = periodicRate(annualRate, n);
  const contribN = FREQ_PER_YEAR[contributionFrequency];
  const perEvent = contributionPerEvent(
    annualContribution,
    contributionFrequency,
  );
  // How many compound periods between contributions
  const stepsPerContrib =
    contribN > 0 ? Math.max(1, Math.round(n / contribN)) : Infinity;

  let balance = principal;
  for (let step = 1; step <= totalSteps; step++) {
    if (!contributionAtEnd && contribN > 0 && (step - 1) % stepsPerContrib === 0) {
      balance += perEvent;
    }
    balance *= 1 + r;
    if (contributionAtEnd && contribN > 0 && step % stepsPerContrib === 0) {
      balance += perEvent;
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
  // Approximate continuous contributions as annualContribution stream.
  const c =
    contributionFrequency === "none" ? 0 : annualContribution;
  if (Math.abs(annualRate) < 1e-12) {
    return principal + c * years;
  }
  const growth = Math.exp(annualRate * years);
  // Continuous deposit stream: C/r * (e^{rt} - 1)
  return principal * growth + (c / annualRate) * (growth - 1);
}

/**
 * Build a multi-scenario forecast series at yearly (or sub-year) resolution
 * for charting. Pure function — no I/O.
 */
export function buildForecastSeries(inputs: ForecastInputs): ForecastSeries {
  const {
    principal,
    years,
    annualContribution,
    contributionFrequency,
    compounding,
    rates,
    contributionAtEnd = true,
  } = inputs;

  const n = periodsPerYear(compounding);
  const totalSteps = Math.max(1, Math.round(years * n));
  const points: ForecastPoint[] = [];

  // Include t=0
  points.push({
    year: 0,
    label: "Y0",
    min: principal,
    expected: principal,
    max: principal,
    historical:
      rates.historical != null && Number.isFinite(rates.historical)
        ? principal
        : null,
  });

  // Emit one point per year for readability (plus final if fractional).
  const yearMarks = new Set<number>();
  for (let y = 1; y <= Math.floor(years); y++) yearMarks.add(y);
  yearMarks.add(years);

  for (const y of [...yearMarks].sort((a, b) => a - b)) {
    if (y === 0) continue;
    const min = projectBalance(
      principal,
      rates.min,
      y,
      annualContribution,
      contributionFrequency,
      compounding,
      contributionAtEnd,
    );
    const expected = projectBalance(
      principal,
      rates.expected,
      y,
      annualContribution,
      contributionFrequency,
      compounding,
      contributionAtEnd,
    );
    const max = projectBalance(
      principal,
      rates.max,
      y,
      annualContribution,
      contributionFrequency,
      compounding,
      contributionAtEnd,
    );
    const historical =
      rates.historical != null && Number.isFinite(rates.historical)
        ? projectBalance(
            principal,
            rates.historical,
            y,
            annualContribution,
            contributionFrequency,
            compounding,
            contributionAtEnd,
          )
        : null;
    points.push({
      year: y,
      label: Number.isInteger(y) ? `Y${y}` : `Y${y.toFixed(1)}`,
      min,
      expected,
      max,
      historical,
    });
  }

  return { points, steps: totalSteps, periodsPerYear: n };
}
