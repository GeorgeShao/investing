# investing

Local **investment analytics** from brokerage statement PDFs.

Drop monthly statements into a folder, extract them on your machine, and explore:

- Portfolio value over time (by account — not bank cash or debt)
- Deposits and withdrawals (transfers between your own accounts are ignored)
- Monthly profit and loss, and time-weighted monthly returns
- **TWRR**, **CAGR**, and **MWRR** (see [Metrics](#metrics) for what these mean)
- Position weights over time
- Your portfolio vs market benchmarks
- A **forecast** of what continued contributions and returns could look like

Everything runs on your computer. No sign-in, no cloud, and no bank or credit-card statements — brokerage / investment accounts only.

Charts, forecasts, and other dollar amounts are **CAD**. USD statements are converted when you extract (from the PDF’s rate, or month-end USDCAD if you fetch benchmarks). Returns and weights are percentages, so they are the same in any currency.

---

## Supported statements

Monthly **investment / brokerage** PDFs only — not bank or credit-card statements. Scanned or photo-only PDFs will not work.

| Broker | What to drop in | Notes |
|--------|-----------------|-------|
| **Questrade** | Monthly account statement | CAD and USD accounts |
| **Wealthsimple** | Monthly brokerage statement | TFSA, RRSP, FHSA, RESP, margin, and cash accounts |
| **Fidelity** (personal) | *Investment Report* (brokerage / BrokerageLink) | USD; converted to CAD |
| **Fidelity** (employer) | NetBenefits workplace / employer-plan statement | USD; converted to CAD |

If your broker is not listed, you can add support — see [Adding a brokerage](#adding-a-brokerage).

---

## Setup

You will need [Node.js](https://nodejs.org/) (with [pnpm](https://pnpm.io/)), and Python 3 for reading statements.

### 1. Install and start the app

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Charts appear only after you extract statements — there is no sample portfolio.

### 2. Point the app at your statements

```bash
cp config/config.example.json config/config.local.json
```

This file stays on your machine (it is not committed). Edit it and set:

- **Where the PDFs live** (`pdfRoot`) — a folder with one subfolder per brokerage
- **Which brokerages you use** (`brokers`) — keep the rows that match you; delete the rest
- **Chart start dates** (`chartStartWindows`) — the “From …” buttons on the dashboard (change these to months that matter for you)
- **Account groups** (optional) — combine related accounts on the net-worth chart (for example a CAD and USD sleeve of the same TFSA)

Suggested folder layout (names must match the `folder` value in your config):

```
~/Downloads/Monthly PDF Statements/
  Questrade Monthly PDF Statements/
    …any subfolders…/*.pdf
  Wealthsimple Monthly PDF Statements/
    …
  Fidelity Personal/
    …
  Fidelity Employer/
    …
```

Year or account subfolders are fine; every `*.pdf` under each brokerage folder is picked up.

### 3. Extract statements

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt
python scripts/run_extract.py
```

Re-run that last command whenever you add new monthly PDFs, then reload the dashboard.

### 4. (Optional) Benchmark prices

Needed for the “vs benchmark” charts, and for converting USD statements when the PDF has no exchange rate.

```bash
python scripts/fetch_benchmarks.py
```

Portfolio value, cash flow, and return charts work without this step.

---

## Forecasting

The dashboard can project your portfolio forward. You pick:

- a starting amount (defaults to your latest portfolio value)
- optional ongoing contributions and how often they happen
- a time horizon (or a specific end date)
- a planning band of annual returns (min / expected / max)

There is also an **If this continues** path that uses recent performance
instead of the planning band. Nothing here is a recommendation — it is
compounding math on the assumptions you type in.

---

## Metrics

| Metric | Meaning | Formula |
|--------|---------|---------|
| Monthly P&amp;L | Value change that is not from money you added or withdrew | \(V_t - V_{t-1} - F_t\) |
| Monthly TWRR | That month’s return (deposits/withdrawals treated as month-end) | \((V_t - F_t) / V_{t-1} - 1\) |
| TWRR (total) | Compounded monthly returns — how the *portfolio* did, ignoring contribution timing | Product of \((1+r_t) - 1\) |
| CAGR | The same TWRR path, expressed as an annual rate | Annualized over the month count |
| MWRR | Dollar-weighted return — how *you* did, given when money went in and out | IRR on \(-V_0\), \(-F_t\), terminal \(+V_T\) |

\(V\) is month-end portfolio value. \(F\) is net external cash flow (deposits − withdrawals). Internal transfers between your own accounts are not treated as deposits or withdrawals.

---

## Privacy

This app is meant to run on **your computer**. Statement PDFs, the extracted
portfolio, and your local config stay local — they are not uploaded anywhere,
and they are gitignored so they are not committed by accident.

Do not publish your PDF folder or `config/config.local.json` if it has personal
paths or account groupings.

**Not in scope:** bank accounts, credit cards, live broker logins, or sharing
a portfolio with other people over the internet.

---

## Adding a brokerage

Parsers live in `scripts/extract/`. Copy the file closest to your statements
(Questrade, Wealthsimple, or one of the Fidelity parsers) and teach it to read:

- the statement month
- the account number and type (TFSA, RRSP, 401(k), …)
- month-end value (and cash, if the PDF shows it)
- deposits and withdrawals
- holdings, if you want the weight chart

Then:

1. Register the new parser in `scripts/extract/registry.py` (follow the existing lines).
2. Add a row under `brokers` in `config/config.local.json`:

```json
{
  "id": "mybroker",
  "name": "My Broker",
  "folder": "My Broker Monthly PDF Statements",
  "parser": "mybroker"
}
```

`folder` is the subfolder name under your PDF root. `parser` must match the name you registered.

3. Put monthly PDFs in that folder and re-run `python scripts/run_extract.py`.

---

## License

MIT — see [LICENSE](./LICENSE).
