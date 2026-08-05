# Data directory

| File | Committed? | Purpose |
|------|------------|---------|
| `sample-portfolio.json` | Yes | Synthetic investment portfolio aligned with `config.example.json` (account groups + chart windows) so clone → install → dev works offline |
| `benchmarks.json` | Yes (sample prices) | Month-end index levels for vs-benchmark charts; replace via `fetch_benchmarks.py` |
| `data.json` | **No** (gitignored) | Your real extract from `scripts/run_extract.py` |
| `extraction-report.json` | **No** | Coverage, transfer reclass audit, parse errors |
| `raw-extracts.json` | **No** | Per-PDF parser output before merge mutations |

## Privacy

- Never commit statement **PDFs** or personal `data.json`.
- The dashboard prefers `data.json` when present; otherwise it loads `sample-portfolio.json`.
