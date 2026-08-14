#!/usr/bin/env python3
"""
Batch-extract brokerage monthly PDFs into data/data.json.

Discovery is config-driven: each brokers[] entry has a folder under pdfRoot
and a parser registry key. Adding a brokerage is a new parser module + config
entry — not an edit to this merge pipeline.

Usage (from repo root):
  python scripts/run_extract.py
  python scripts/run_extract.py --config config/config.local.json
  python scripts/run_extract.py --pdf-root "/path/to/statements"
  python scripts/run_extract.py --force
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import fields as dataclass_fields
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract.common import Holding, StatementExtract, Transaction  # noqa: E402
from extract.merge import build_portfolio, validate_portfolio  # noqa: E402
from extract.registry import get_parser, list_parsers  # noqa: E402

DEFAULT_CONFIG = ROOT / "config" / "config.example.json"
LOCAL_CONFIG = ROOT / "config" / "config.local.json"
DEFAULT_OUT = ROOT / "data" / "data.json"
DEFAULT_REPORT = ROOT / "data" / "extraction-report.json"
DEFAULT_RAW = ROOT / "data" / "raw-extracts.json"
DEFAULT_BENCHMARKS = ROOT / "data" / "benchmarks.json"


def load_usdcad_benchmark(path: Path | None = None) -> dict[str, float]:
    """
    Month-end USD→CAD (CAD per 1 USD) from data/benchmarks.json prices.USDCAD.

    Returns {} if the file is missing — extract still works; USD sleeves stay
    unconverted until benchmarks are fetched (`python scripts/fetch_benchmarks.py`).
    """
    bench_path = path or DEFAULT_BENCHMARKS
    if not bench_path.is_file():
        return {}
    try:
        data = json.loads(bench_path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    prices = (data.get("prices") or {}).get("USDCAD") or {}
    out: dict[str, float] = {}
    for period_id, rate in prices.items():
        try:
            r = float(rate)
        except (TypeError, ValueError):
            continue
        if r > 0:
            out[str(period_id)] = r
    return out


def expand_path(raw: str) -> Path:
    return Path(raw).expanduser().resolve()


def load_config(path: Path | None) -> dict[str, Any]:
    candidates = []
    if path:
        candidates.append(path)
    candidates.extend([LOCAL_CONFIG, DEFAULT_CONFIG])
    for c in candidates:
        if c.is_file():
            return json.loads(c.read_text())
    raise FileNotFoundError(
        f"No config found. Copy config/config.example.json to config/config.local.json"
    )


def discover_pdfs_for_broker(pdf_root: Path, folder: str) -> list[Path]:
    broker_dir = pdf_root / folder
    if not broker_dir.is_dir():
        return []
    return sorted(broker_dir.rglob("*.pdf"))


def file_fingerprint(path: Path) -> dict[str, int]:
    st = path.stat()
    return {"mtime_ns": st.st_mtime_ns, "size": st.st_size}


def _dataclass_kwargs(cls: type, data: dict[str, Any]) -> dict[str, Any]:
    names = {f.name for f in dataclass_fields(cls)}
    return {k: v for k, v in data.items() if k in names}


def extract_from_dict(d: dict[str, Any]) -> StatementExtract:
    """Rebuild a StatementExtract from StatementExtract.to_dict() output."""
    holdings = [
        Holding(**_dataclass_kwargs(Holding, h))
        for h in (d.get("holdings") or [])
        if isinstance(h, dict)
    ]
    txs = [
        Transaction(**_dataclass_kwargs(Transaction, t))
        for t in (d.get("transactions") or [])
        if isinstance(t, dict)
    ]
    skip = {"holdings", "transactions"}
    payload = _dataclass_kwargs(
        StatementExtract, {k: v for k, v in d.items() if k not in skip}
    )
    return StatementExtract(**payload, holdings=holdings, transactions=txs)


def load_raw_cache(path: Path) -> dict[str, dict[str, Any]]:
    """
    Load path → {mtime_ns, size, extract} from raw-extracts.json.

    Missing, unreadable, or legacy list-shaped files are an empty cache.
    """
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    files = raw.get("files") if isinstance(raw, dict) else None
    if not isinstance(files, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for key, entry in files.items():
        if isinstance(key, str) and isinstance(entry, dict):
            out[key] = entry
    return out


def cached_extract_dict(
    cache: dict[str, dict[str, Any]],
    path: Path,
) -> dict[str, Any] | None:
    """Return the stored extract dict when path + mtime_ns + size match."""
    hit = cache.get(str(path))
    if not isinstance(hit, dict):
        return None
    extract = hit.get("extract")
    if not isinstance(extract, dict):
        return None
    try:
        fp = file_fingerprint(path)
    except OSError:
        return None
    if hit.get("mtime_ns") == fp["mtime_ns"] and hit.get("size") == fp["size"]:
        return extract
    return None


def build_raw_cache(extracts: list[StatementExtract]) -> dict[str, Any]:
    """Fingerprint-bearing raw dump. Dropped/missing source files are omitted."""
    files: dict[str, dict[str, Any]] = {}
    for ex in extracts:
        src = Path(ex.source_path)
        if not src.is_file():
            continue
        try:
            fp = file_fingerprint(src)
        except OSError:
            continue
        files[str(src)] = {**fp, "extract": ex.to_dict()}
    return {"files": files}


def extract_all(
    pdf_root: Path,
    brokers: list[dict[str, Any]],
    *,
    cache: dict[str, dict[str, Any]] | None = None,
    force: bool = False,
) -> tuple[list[StatementExtract], list[dict[str, Any]], dict[str, int]]:
    extracts: list[StatementExtract] = []
    errors: list[dict[str, Any]] = []
    effective = {} if force else (cache or {})
    hits = 0
    parsed = 0

    for broker in brokers:
        parser_name = broker.get("parser") or broker.get("id")
        folder = broker.get("folder") or ""
        name = broker.get("name") or broker.get("id") or parser_name
        try:
            parse_fn = get_parser(str(parser_name))
        except KeyError as e:
            errors.append(
                {
                    "path": str(pdf_root / folder),
                    "institution": name,
                    "error": str(e),
                }
            )
            continue

        pdfs = discover_pdfs_for_broker(pdf_root, folder)
        for path in pdfs:
            stored = cached_extract_dict(effective, path)
            if stored is not None:
                try:
                    extracts.append(extract_from_dict(stored))
                    hits += 1
                    continue
                except (TypeError, KeyError, ValueError):
                    pass
            try:
                extracts.append(parse_fn(path))
            except Exception as e:  # noqa: BLE001 — collect all failures
                errors.append(
                    {
                        "path": str(path),
                        "institution": name,
                        "error": f"{type(e).__name__}: {e}",
                    }
                )
            parsed += 1

    stats = {
        "discovered": hits + parsed,
        "cache_hits": hits,
        "parsed": parsed,
    }
    return extracts, errors, stats


def institution_slug_map(brokers: list[dict[str, Any]]) -> dict[str, str]:
    """Map display institution names (and common aliases) → config broker id."""
    m: dict[str, str] = {}
    for b in brokers:
        bid = str(b.get("id") or "")
        name = str(b.get("name") or bid)
        if bid:
            m[name] = bid
            m[name.lower()] = bid
            m[bid] = bid
            m[bid.lower()] = bid
    return m


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract portfolio data from brokerage monthly PDFs"
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Path to config JSON (default: config.local.json then config.example.json)",
    )
    parser.add_argument(
        "--pdf-root",
        type=Path,
        default=None,
        help="Override pdfRoot from config",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--skip-raw", action="store_true")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore raw-extracts.json cache and re-parse every PDF",
    )
    parser.add_argument(
        "--list-parsers",
        action="store_true",
        help="Print registered parser keys and exit",
    )
    args = parser.parse_args()

    if args.list_parsers:
        print("Registered parsers:", ", ".join(list_parsers()))
        return 0

    cfg = load_config(args.config)
    brokers = cfg.get("brokers") or []
    if not brokers:
        print("Config has no brokers[] entries.", file=sys.stderr)
        return 2

    pdf_root = expand_path(str(args.pdf_root or cfg.get("pdfRoot") or ""))
    currency = str(cfg.get("currency") or "CAD")

    if not pdf_root.is_dir():
        print(f"PDF root not found: {pdf_root}", file=sys.stderr)
        print(
            "Set pdfRoot in config/config.local.json or pass --pdf-root.",
            file=sys.stderr,
        )
        return 2

    cache: dict[str, dict[str, Any]] = {}
    if not args.force:
        cache = load_raw_cache(args.raw)

    print(f"Scanning {pdf_root} with {len(brokers)} broker(s) ...")
    print(f"Parsers available: {', '.join(list_parsers())}")
    extracts, errors, stats = extract_all(
        pdf_root, brokers, cache=cache, force=args.force
    )
    print(
        f"Parsed OK: {len(extracts)}  Failed: {len(errors)}  "
        f"cache hits: {stats['cache_hits']}  "
        f"re-parsed: {stats['parsed']}"
    )

    slugs = institution_slug_map(brokers)
    usdcad = load_usdcad_benchmark()
    if usdcad:
        print(f"USDCAD benchmark months: {len(usdcad)} (for USD→CAD when statements lack FX)")
    else:
        print(
            "No data/benchmarks.json USDCAD series — USD statements without "
            "sibling FX stay at 1:1 until you run: python scripts/fetch_benchmarks.py"
        )

    portfolio, report = build_portfolio(
        extracts,
        errors,
        currency=currency,
        pdf_root=str(pdf_root),
        institution_slugs=slugs,
        usdcad_by_period=usdcad or None,
    )
    report["pdfRoot"] = str(pdf_root)
    if portfolio.get("meta", {}).get("source"):
        portfolio["meta"]["source"]["pdfRoot"] = str(pdf_root)

    issues, val_flags = validate_portfolio(portfolio, extracts, slugs)
    report["schemaIssues"] = issues
    existing = report.get("validationFlags") or []
    report["validationFlags"] = existing + val_flags
    report["totals"]["validationFlagCount"] = len(report["validationFlags"])
    report["totals"]["usdMissingFxCount"] = sum(
        1 for f in report["validationFlags"] if f.get("issue") == "usd_missing_or_implausible_fx"
    )
    report["totals"]["usdInvertedOrUnconvertedCount"] = sum(
        1
        for f in report["validationFlags"]
        if f.get("issue") == "usd_cad_looks_inverted_or_unconverted"
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(portfolio, indent=2) + "\n")
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    if not args.skip_raw:
        args.raw.parent.mkdir(parents=True, exist_ok=True)
        args.raw.write_text(json.dumps(build_raw_cache(extracts), indent=2) + "\n")

    print(f"Wrote {args.out}")
    print(f"Wrote {args.report}")
    print(
        f"Periods {report['totals']['earliestPeriod']} → {report['totals']['latestPeriod']} "
        f"| accounts={report['totals']['accounts']} "
        f"| latest NW=${report['totals']['latestNetWorthCad']}"
    )
    if errors:
        print(f"Parse failures: {len(errors)} (see report)")
        for e in errors[:10]:
            print(f"  - {Path(e['path']).name}: {e['error']}")
    if issues:
        print(f"Schema issues: {issues[:20]}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
