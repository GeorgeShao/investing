#!/usr/bin/env python3
"""
Fetch month-end benchmark prices via yfinance for the investing dashboard.

Tickers default from config/config.example.json (or config.local.json) benchmarks[]
plus USDCAD (CAD=X) for converting USD indexes.

Writes data/benchmarks.json (gitignored — each user fetches their own prices).

Usage:
  source .venv/bin/activate
  pip install -r scripts/requirements.txt
  python scripts/fetch_benchmarks.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "benchmarks.json"
DEFAULT_CONFIG = ROOT / "config" / "config.example.json"
LOCAL_CONFIG = ROOT / "config" / "config.local.json"

DEFAULT_TICKERS = {
    "XEQT": "XEQT.TO",
    "VOO": "VOO",
    "QQQ": "QQQ",
    "USDCAD": "CAD=X",
}


def load_tickers() -> dict[str, str]:
    tickers = dict(DEFAULT_TICKERS)
    for path in (LOCAL_CONFIG, DEFAULT_CONFIG):
        if not path.is_file():
            continue
        try:
            cfg = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        for b in cfg.get("benchmarks") or []:
            bid = b.get("id")
            yahoo = b.get("yahoo")
            if bid and yahoo:
                tickers[str(bid)] = str(yahoo)
        # first existing config wins for overrides
        break
    # Always keep FX helper
    tickers.setdefault("USDCAD", "CAD=X")
    return tickers


def main() -> int:
    try:
        import yfinance as yf
    except ImportError:
        print("yfinance not installed. Run: pip install yfinance", file=sys.stderr)
        return 2

    tickers = load_tickers()
    start = "2021-01-01"
    end = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    series: dict[str, dict[str, float]] = {k: {} for k in tickers}

    for key, yahoo in tickers.items():
        print(f"Downloading {yahoo} ...")
        hist = yf.download(
            yahoo,
            start=start,
            end=end,
            auto_adjust=True,
            progress=False,
            threads=False,
        )
        if hist is None or hist.empty:
            print(f"  WARN: empty history for {yahoo}", file=sys.stderr)
            continue
        close = hist["Close"]
        if hasattr(close, "columns"):
            close = close.iloc[:, 0]
        monthly = close.resample("ME").last().dropna()
        for ts, price in monthly.items():
            period_id = f"{ts.year:04d}-{ts.month:02d}"
            try:
                series[key][period_id] = float(price)
            except (TypeError, ValueError):
                continue
        print(f"  {len(series[key])} month-end points")

    payload = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": "yfinance",
            "notes": [
                "Month-end prices use last trading day close (auto_adjust=True).",
                "USD indexes are converted to CAD in the app using USDCAD (Yahoo CAD=X).",
                "Ticker list comes from config benchmarks[] plus USDCAD.",
            ],
            "tickers": tickers,
        },
        "prices": series,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
