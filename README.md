# investing

Local-first **investment analytics** from brokerage statement PDFs.

Drop monthly statements in a configured folder layout, extract them into a broker-agnostic portfolio document, and explore:

- Portfolio value over time (stacked by brokerage account; bank cash and debt not included)
- External cash flows (deposits / withdrawals; internal transfers excluded)
- Monthly P&amp;L and time-weighted monthly returns
- **TWRR**, **CAGR**, **MWRR** (total and annualized), yearly breakdowns
- Position weights over time
- Portfolio vs benchmarks (time-weighted growth **or** same external cash flows)
- **Forecast** multi-scenario projections (contributions, start/end, min/expected/max/historical returns)

Runs entirely on your machine. **No auth, no cloud, no bank/credit-card statements** — investment/brokerage accounts only.

Stack: **Next.js** (App Router) · **pnpm** · **Tailwind** · **shadcn/ui** · **Apache ECharts** · **Python** extractors (`pypdf`, optional `yfinance`).

---

## Quick start

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Until you extract your statements, the home page shows a **setup alert** with the steps below (no sample portfolio is shipped).

```bash
pnpm test    # Vitest — performance, series, benchmarks, forecast math
pnpm build   # production build
```

### First-time data setup

```bash
# 1. Local config (gitignored)
cp config/config.example.json config/config.local.json
# edit pdfRoot, chartStartWindows, accountGroups as needed

# 2. Extract brokerage PDFs → data/data.json
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt
python scripts/run_extract.py

# 3. Benchmark prices → data/benchmarks.json (for vs-benchmark charts)
python scripts/fetch_benchmarks.py
```

Then reload `pnpm dev`. The dashboard reads `data/data.json` only — regenerate after adding statements.

---

## Statement layout &amp; config

### Config files

| File | Role |
|------|------|
| `config/config.example.json` | Committed defaults (safe paths, sample chart windows, QT + WS brokers) |
| `config/config.local.json` | **Your** overrides (gitignored) — PDF root, personal start dates, account groups |

```bash
cp config/config.example.json config/config.local.json
# edit pdfRoot, chartStartWindows, accountGroups, benchmarks as needed
```

### Config keys

| Key | Purpose |
|-----|---------|
| `pdfRoot` | Root folder containing per-brokerage subfolders (`~` expanded) |
| `brokers[]` | `{ id, name, folder, parser }` — discovery + which parser to use |
| `chartStartWindows[]` | `{ id: "YYYY-MM", label }` — dashboard “From …” toggles (e.g. Feb 2022 vs May 2023) |
| `defaultChartStart` | Which window is selected by default |
| `accountGroups[]` | Optional display merge for net-worth chart (`name` + `memberIds`) |
| `currency` | Portfolio base currency (default `CAD`) |
| `benchmarks[]` | `{ id, yahoo, currency, label? }` for fetch + comparison charts |

### Recommended PDF folder layout

```
~/Downloads/Monthly PDF Statements/          # pdfRoot
  Questrade Monthly PDF Statements/          # brokers[0].folder
    …/**/*.pdf
  Wealthsimple Monthly PDF Statements/       # brokers[1].folder
    …/**/*.pdf
```

Subfolders (by year/account) are fine — discovery is recursive for `*.pdf`.

---

## Extract your portfolio

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt

# optional: point at your PDFs
# edit config/config.local.json → pdfRoot

python scripts/run_extract.py
# or: python scripts/run_extract.py --pdf-root "~/path/to/statements"
# or: python scripts/run_extract.py --list-parsers
```

Writes (gitignored):

- `data/data.json` — portfolio document (dashboard input when present)
- `data/extraction-report.json` — coverage, transfer adjustments, errors
- `data/raw-extracts.json` — extract cache (per-PDF output before merge; reused unless `--force`)

### Refresh benchmarks

```bash
python scripts/fetch_benchmarks.py
```

Writes `data/benchmarks.json` (gitignored) from Yahoo via `yfinance` using tickers in config. Without this file, portfolio charts still work; the vs-benchmark section has no index series until you fetch.

---

## Portfolio document (schema v2)

Single broker-agnostic JSON contract:

- `meta` — `schemaVersion`, `currency`, `generatedAt`, notes, source counts
- `accounts[]` — investment accounts (`tfsa`, `rrsp`, `fhsa`, `margin`, `non_registered`, …)
- `periods[]` — month-end rows (`id: YYYY-MM`) with:
  - `balances[]` — market value in base currency (+ optional cash / native / FX)
  - `cashFlows` — **external** deposits/withdrawals (+ dividends, interest, transfers\*)
  - optional `holdings[]`, `transactions[]`, `fxRates`

\* Internal account-to-account movements are reclassified out of deposits/withdrawals during merge so performance math stays external-flow clean.

---

## Adding a brokerage

1. **Parser** — implement `extract_<broker>_pdf(path) -> StatementExtract` (see `scripts/extract/questrade.py` / `wealthsimple.py`).
2. **Register** — `register_parser("mybroker", extract_mybroker_pdf)` in `scripts/extract/registry.py` (or call `register_parser` from your module import).
3. **Config** — add to `brokers[]`:

```json
{
  "id": "mybroker",
  "name": "My Broker",
  "folder": "My Broker Monthly PDF Statements",
  "parser": "mybroker"
}
```

4. Put PDFs under `{pdfRoot}/{folder}/` and re-run `run_extract.py`.

Merge, FX refinement, transfer reclass, and the dashboard never hard-code only Questrade/Wealthsimple.

Account ids use `stable_account_id(institution, accountNumber, slug=broker.id)` → `{slug}-{account}`.

---

## Architecture (extensibility)

```
config/                 # example + local user config
data/                   # gitignored extracts + benchmarks (generate locally)
scripts/extract/
  common.py             # StatementExtract, money/FX helpers
  registry.py           # parser discovery by name
  merge.py              # extracts → portfolio document
  questrade.py / wealthsimple.py
scripts/run_extract.py
scripts/fetch_benchmarks.py
src/lib/
  types.ts              # portfolio schema
  performance.ts        # TWRR / MWRR / P&amp;L (pure)
  series.ts             # chart series builders (pure)
  benchmarks.ts         # vs-index comparison (pure)
  forecast.ts           # return projection math (pure)
  config.ts             # load example / local config
src/components/charts/  # Apache ECharts wrappers (incl. forecast)
src/components/dashboard/  # includes Forecast section
```

### Future metrics &amp; charts

Add pure helpers under `src/lib/`, unit-test them, then drop a new chart into `windowed-sections.tsx` via `ChartSection`. Domain math stays importable without Next.

### Forecasting

Dashboard **Forecast** section (`ForecastSection`) lets you customize:

- starting principal (defaults to latest portfolio value; stays in sync until you edit it)
- contribution **amount per event** and **frequency** (defaults from typical monthly deposits over the last 12 months, ignoring a one-off transfer)
- **start date**, optional **end date**, or horizon chips (5 / 10 / 20 / 30 years)
- planning band: **min / expected / max** (defaults 3 / 7 / 12)
- **If this continues** path with chips: your holdings %/year (same window as You vs QQQ), opponent holdings %/year, or 7% planning

All paths are computed by pure `buildForecastProjection` in `src/lib/forecast.ts` and plotted with ECharts (min / expected / max / what-if).

---

## Metrics definitions (short)

| Metric | Idea |
|--------|------|
| Monthly P&amp;L | \(V_t - V_{t-1} - F_t\) with \(F_t =\) deposits − withdrawals |
| Monthly TWRR | \((V_t - F_t) / V_{t-1} - 1\) (end-of-period flow approximation) |
| TWRR total | Product of \((1+r_t) - 1\) |
| CAGR | Annualized from linked TWRR over month count |
| MWRR | IRR on \(-V_0\), \(-F_t\), terminal \(+V_T\) |

---

## Privacy &amp; scope

- Intended to run **locally** only (for now).
- **Do not commit** PDFs, `data/data.json`, or `config.local.json` with personal paths/account groups you care about keeping private.
- **In scope:** brokerage/investment statements (TFSA, RRSP, FHSA, margin, non-registered, …).
- **Out of scope:** bank accounts, credit cards, live broker APIs, multi-user auth.

---

## License

MIT — see [LICENSE](./LICENSE).
