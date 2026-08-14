"""
Cache tests for scripts/run_extract.py.

These call the shipped load/hit/write path (extract_all, load_raw_cache,
extract_from_dict). A registered stub parser counts invocations so a cache
hit is proven by "parser not called", not by a re-implementation.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from extract.common import Holding, StatementExtract, Transaction  # noqa: E402
from extract.merge import build_portfolio  # noqa: E402
from extract.registry import register_parser  # noqa: E402
from run_extract import (  # noqa: E402
    build_raw_cache,
    cached_extract_dict,
    extract_all,
    extract_from_dict,
    file_fingerprint,
    load_raw_cache,
)

PARSER_NAME = "cache_test_stub"
_PARSE_CALLS: list[str] = []
_PARSE_BY_PATH: dict[str, StatementExtract] = {}


def _stub_extract(source_path: str, account_number: str = "C1") -> StatementExtract:
    return StatementExtract(
        source_path=source_path,
        institution="Cache Test Broker",
        account_number=account_number,
        account_type="tfsa",
        statement_currency="CAD",
        period_id="2024-06",
        label="Jun 2024",
        start_date="2024-06-01",
        end_date="2024-06-30",
        market_value=100.0,
        market_value_cad=100.0,
        deposits=10.0,
        holdings=[Holding(symbol="XEQT", name="XEQT", quantity=1.0, market_value=100.0)],
        transactions=[
            Transaction(date="2024-06-02", code="DEP", description="deposit", credit=10.0)
        ],
        notes=["stub"],
        extras={"via": "stub"},
    )


def _stub_parser(path: str | Path) -> StatementExtract:
    key = str(Path(path))
    _PARSE_CALLS.append(key)
    if key in _PARSE_BY_PATH:
        return _PARSE_BY_PATH[key]
    return _stub_extract(key)


register_parser(PARSER_NAME, _stub_parser)


def _broker(folder: str = ".") -> dict:
    return {
        "id": "ct",
        "name": "Cache Test Broker",
        "folder": folder,
        "parser": PARSER_NAME,
    }


class TestExtractCache(unittest.TestCase):
    def setUp(self) -> None:
        _PARSE_CALLS.clear()
        _PARSE_BY_PATH.clear()
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        self.pdf = self.root / "stmt.pdf"
        self.pdf.write_bytes(b"%PDF-1.4 cache-test\n")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_extract_from_dict_round_trip(self) -> None:
        original = _stub_extract(str(self.pdf), account_number="RT1")
        rebuilt = extract_from_dict(original.to_dict())
        self.assertEqual(rebuilt.source_path, original.source_path)
        self.assertEqual(rebuilt.account_number, original.account_number)
        self.assertEqual(rebuilt.period_id, original.period_id)
        self.assertEqual(rebuilt.market_value, original.market_value)
        self.assertEqual(rebuilt.market_value_cad, original.market_value_cad)
        self.assertEqual(rebuilt.deposits, original.deposits)
        self.assertEqual(rebuilt.notes, original.notes)
        self.assertEqual(rebuilt.extras, original.extras)
        self.assertEqual(len(rebuilt.holdings), 1)
        self.assertEqual(rebuilt.holdings[0].symbol, original.holdings[0].symbol)
        self.assertEqual(rebuilt.holdings[0].market_value, original.holdings[0].market_value)
        self.assertEqual(len(rebuilt.transactions), 1)
        self.assertEqual(rebuilt.transactions[0].code, original.transactions[0].code)
        self.assertEqual(rebuilt.transactions[0].credit, original.transactions[0].credit)

    def test_fingerprint_hit_skips_parse(self) -> None:
        first, errors, stats = extract_all(self.root, [_broker()], cache={})
        self.assertEqual(errors, [])
        self.assertEqual(stats["parsed"], 1)
        self.assertEqual(stats["cache_hits"], 0)
        self.assertEqual(len(_PARSE_CALLS), 1)
        self.assertEqual(len(first), 1)

        cache = build_raw_cache(first)["files"]
        _PARSE_CALLS.clear()
        second, errors2, stats2 = extract_all(self.root, [_broker()], cache=cache)
        self.assertEqual(errors2, [])
        self.assertEqual(stats2["cache_hits"], 1)
        self.assertEqual(stats2["parsed"], 0)
        self.assertEqual(_PARSE_CALLS, [])
        self.assertEqual(second[0].account_number, first[0].account_number)
        self.assertEqual(second[0].market_value_cad, first[0].market_value_cad)
        self.assertEqual(second[0].source_path, str(self.pdf))

        # Merge still sees the reused extract (full combined list).
        _portfolio, report = build_portfolio(second, errors2, currency="CAD")
        self.assertEqual(report["totals"]["pdfsParsed"], 1)
        self.assertEqual(report["totals"]["accounts"], 1)

    def test_size_mismatch_reparses(self) -> None:
        first, _, _ = extract_all(self.root, [_broker()], cache={})
        cache = build_raw_cache(first)["files"]
        self.pdf.write_bytes(self.pdf.read_bytes() + b"x")
        _PARSE_CALLS.clear()
        _, _, stats = extract_all(self.root, [_broker()], cache=cache)
        self.assertEqual(stats["cache_hits"], 0)
        self.assertEqual(stats["parsed"], 1)
        self.assertEqual(len(_PARSE_CALLS), 1)

    def test_mtime_mismatch_reparses(self) -> None:
        first, _, _ = extract_all(self.root, [_broker()], cache={})
        cache = build_raw_cache(first)["files"]
        fp = file_fingerprint(self.pdf)
        os.utime(self.pdf, ns=(fp["mtime_ns"] + 10_000_000_000, fp["mtime_ns"] + 10_000_000_000))
        self.assertNotEqual(file_fingerprint(self.pdf)["mtime_ns"], fp["mtime_ns"])
        self.assertEqual(file_fingerprint(self.pdf)["size"], fp["size"])
        _PARSE_CALLS.clear()
        _, _, stats = extract_all(self.root, [_broker()], cache=cache)
        self.assertEqual(stats["cache_hits"], 0)
        self.assertEqual(stats["parsed"], 1)
        self.assertEqual(len(_PARSE_CALLS), 1)

    def test_legacy_list_raw_file_is_empty_cache(self) -> None:
        raw_path = self.root / "raw-extracts.json"
        raw_path.write_text(json.dumps([_stub_extract(str(self.pdf)).to_dict()]) + "\n")
        loaded = load_raw_cache(raw_path)
        self.assertEqual(loaded, {})
        _PARSE_CALLS.clear()
        _, _, stats = extract_all(self.root, [_broker()], cache=loaded)
        self.assertEqual(stats["cache_hits"], 0)
        self.assertEqual(stats["parsed"], 1)
        self.assertEqual(len(_PARSE_CALLS), 1)

    def test_missing_and_unreadable_raw_are_empty_cache(self) -> None:
        missing = self.root / "no-such-raw.json"
        self.assertEqual(load_raw_cache(missing), {})
        bad = self.root / "bad-raw.json"
        bad.write_text("{not json")
        self.assertEqual(load_raw_cache(bad), {})

    def test_force_bypasses_matching_cache(self) -> None:
        first, _, _ = extract_all(self.root, [_broker()], cache={})
        cache = build_raw_cache(first)["files"]
        self.assertIsNotNone(cached_extract_dict(cache, self.pdf))
        _PARSE_CALLS.clear()
        forced, errors, stats = extract_all(
            self.root, [_broker()], cache=cache, force=True
        )
        self.assertEqual(errors, [])
        self.assertEqual(stats["cache_hits"], 0)
        self.assertEqual(stats["parsed"], 1)
        self.assertEqual(len(_PARSE_CALLS), 1)
        self.assertEqual(len(forced), 1)

    def test_cached_plus_new_file_both_reach_merge(self) -> None:
        first, _, _ = extract_all(self.root, [_broker()], cache={})
        cache = build_raw_cache(first)["files"]
        extra = self.root / "newer.pdf"
        extra.write_bytes(b"%PDF-1.4 second\n")
        _PARSE_BY_PATH[str(extra)] = _stub_extract(str(extra), account_number="C2")
        _PARSE_CALLS.clear()
        combined, errors, stats = extract_all(self.root, [_broker()], cache=cache)
        self.assertEqual(errors, [])
        self.assertEqual(stats["cache_hits"], 1)
        self.assertEqual(stats["parsed"], 1)
        self.assertEqual(len(_PARSE_CALLS), 1)
        self.assertEqual(_PARSE_CALLS[0], str(extra))
        self.assertEqual({ex.account_number for ex in combined}, {"C1", "C2"})
        _portfolio, report = build_portfolio(combined, errors, currency="CAD")
        self.assertEqual(report["totals"]["pdfsParsed"], 2)
        self.assertEqual(report["totals"]["accounts"], 2)

    def test_build_raw_cache_fingerprint_shape(self) -> None:
        first, _, _ = extract_all(self.root, [_broker()], cache={})
        dumped = build_raw_cache(first)
        self.assertIn("files", dumped)
        self.assertIsInstance(dumped["files"], dict)
        entry = dumped["files"][str(self.pdf)]
        fp = file_fingerprint(self.pdf)
        self.assertEqual(entry["mtime_ns"], fp["mtime_ns"])
        self.assertEqual(entry["size"], fp["size"])
        self.assertIsInstance(entry["extract"], dict)
        raw_path = self.root / "raw-extracts.json"
        raw_path.write_text(json.dumps(dumped) + "\n")
        reloaded = load_raw_cache(raw_path)
        self.assertEqual(set(reloaded), {str(self.pdf)})


if __name__ == "__main__":
    unittest.main()
