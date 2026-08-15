/**
 * Strip redundant leading zeros from a numeric text field while typing.
 * Keeps mid-edit states so "-", ".", "0.", and "-0.5" stay typeable.
 */
export function normalizeNumericInput(raw: string): string {
  if (raw === "" || raw === "-" || raw === "." || raw === "-.") return raw;
  if (/[eE]/.test(raw)) return raw;

  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const dot = body.indexOf(".");
  const hasDot = dot !== -1;
  const intPart = hasDot ? body.slice(0, dot) : body;
  const fracPart = hasDot ? body.slice(dot + 1) : null;
  const strippedInt = intPart.replace(/^0+(?=\d)/, "");
  const intOut = strippedInt === "" ? "0" : strippedInt;

  if (fracPart != null) {
    return `${negative ? "-" : ""}${intOut}.${fracPart}`;
  }
  return `${negative ? "-" : ""}${intOut}`;
}

/** Lone zero (including 0.0 / -0) — safe to select-all so the next digit replaces it. */
export function isLoneNumericZero(value: string): boolean {
  return /^-?0(?:\.0*)?$/.test(value);
}
