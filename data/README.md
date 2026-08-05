# Data directory

| File | Committed? | Purpose |
|------|------------|---------|
| `data.json` | **No** (gitignored) | Your extract from `scripts/run_extract.py` — required for the dashboard |
| `benchmarks.json` | **No** (gitignored) | Month-end index levels from `scripts/fetch_benchmarks.py` |
| `extraction-report.json` | **No** | Coverage, transfer reclass audit, parse errors |
| `raw-extracts.json` | **No** | Per-PDF parser output before merge mutations |

Without `data.json`, the app shows a setup alert with instructions (no sample portfolio is shipped).

## Privacy

- Never commit statement **PDFs**, `data.json`, or personal config.
- Generate benchmarks yourself; market prices still should not mix with portfolio extracts in git history if you prefer a clean public tree.
