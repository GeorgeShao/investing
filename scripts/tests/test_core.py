"""
Unit tests for extractor core (money/FX helpers, transfer reclass, registry).

PDF-backed parser tests skip cleanly when local statement PDFs are absent.
Run:  python -m pytest scripts/tests -q
   or: python scripts/tests/test_core.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from extract.common import (  # noqa: E402
    StatementExtract,
    institution_slug,
    money,
    normalize_to_usd_to_cad,
    stable_account_id,
)
from extract.merge import (  # noqa: E402
    build_portfolio,
    reclassify_internal_transfers,
)
from extract.registry import get_parser, list_parsers, register_parser  # noqa: E402


class TestMoneyAndFx(unittest.TestCase):
    def test_money_parens_and_commas(self) -> None:
        self.assertEqual(money("$1,234.56"), 1234.56)
        self.assertEqual(money("(100.00)"), -100.0)
        self.assertIsNone(money("-"))
        self.assertIsNone(money(None))

    def test_normalize_usd_to_cad(self) -> None:
        self.assertAlmostEqual(normalize_to_usd_to_cad(1.35) or 0, 1.35, places=4)
        inv = normalize_to_usd_to_cad(0.74)
        self.assertIsNotNone(inv)
        assert inv is not None
        self.assertGreater(inv, 1.1)
        self.assertLess(inv, 1.7)


class TestStableAccountId(unittest.TestCase):
    def test_generic_slug_not_only_qt_ws(self) -> None:
        self.assertEqual(
            stable_account_id("Wealthsimple", "HQ123CAD"),
            "ws-hq123cad",
        )
        self.assertEqual(
            stable_account_id("Questrade", "ACC12345"),
            "qt-acc12345",
        )
        # Explicit slug from config wins
        self.assertEqual(
            stable_account_id("Some Broker", "ABC", slug="fidelity"),
            "fidelity-abc",
        )
        self.assertEqual(institution_slug("Interactive Brokers"), "ibkr")


class TestRegistry(unittest.TestCase):
    def test_builtin_parsers_registered(self) -> None:
        names = list_parsers()
        self.assertIn("questrade", names)
        self.assertIn("wealthsimple", names)
        self.assertTrue(callable(get_parser("questrade")))
        self.assertTrue(callable(get_parser("ws")))

    def test_register_fictional_broker_without_touching_merge(self) -> None:
        def fake_parser(path: str | Path) -> StatementExtract:
            return StatementExtract(
                source_path=str(path),
                institution="Fictional",
                account_number="F1",
                account_type="tfsa",
                statement_currency="CAD",
                period_id="2024-01",
                label="Jan 2024",
                start_date="2024-01-01",
                end_date="2024-01-31",
                market_value=1000.0,
                market_value_cad=1000.0,
                deposits=1000.0,
            )

        register_parser("fictional", fake_parser)
        self.assertIn("fictional", list_parsers())
        ex = get_parser("fictional")("/tmp/fake.pdf")
        self.assertEqual(ex.institution, "Fictional")
        portfolio, _ = build_portfolio([ex], [], currency="CAD")
        self.assertEqual(len(portfolio["accounts"]), 1)
        self.assertEqual(portfolio["periods"][0]["totalNetWorth"], 1000.0)


class TestTransferReclass(unittest.TestCase):
    def test_matched_cross_account_flow_clears_external(self) -> None:
        a = StatementExtract(
            source_path="a.pdf",
            institution="Questrade",
            account_number="A1",
            account_type="tfsa",
            statement_currency="CAD",
            period_id="2024-06",
            label="Jun 2024",
            start_date="2024-06-01",
            end_date="2024-06-30",
            market_value=5000,
            market_value_cad=5000,
            withdrawals=1000.0,
        )
        b = StatementExtract(
            source_path="b.pdf",
            institution="Wealthsimple",
            account_number="B1",
            account_type="non_registered",
            statement_currency="CAD",
            period_id="2024-06",
            label="Jun 2024",
            start_date="2024-06-01",
            end_date="2024-06-30",
            market_value=2000,
            market_value_cad=2000,
            deposits=1000.0,
        )
        by_period = {
            "2024-06": {
                "qt-a1": a,
                "ws-b1": b,
            }
        }
        adjustments = reclassify_internal_transfers(by_period)
        self.assertGreaterEqual(len(adjustments), 1)
        self.assertEqual(a.withdrawals, 0.0)
        self.assertEqual(b.deposits, 0.0)
        self.assertIn("external_flows_exclude_internal_transfers", a.notes)


class TestBuildPortfolioInvariants(unittest.TestCase):
    def test_totals_match_balances_and_external_flows(self) -> None:
        extracts = [
            StatementExtract(
                source_path="t.pdf",
                institution="Sample Broker",
                account_number="T1",
                account_type="tfsa",
                statement_currency="CAD",
                period_id="2024-01",
                label="Jan 2024",
                start_date="2024-01-01",
                end_date="2024-01-31",
                market_value=10000,
                market_value_cad=10000,
                deposits=500,
                withdrawals=0,
            ),
            StatementExtract(
                source_path="t2.pdf",
                institution="Sample Broker",
                account_number="T1",
                account_type="tfsa",
                statement_currency="CAD",
                period_id="2024-02",
                label="Feb 2024",
                start_date="2024-02-01",
                end_date="2024-02-29",
                market_value=10800,
                market_value_cad=10800,
                deposits=200,
            ),
        ]
        portfolio, report = build_portfolio(extracts, [], currency="CAD")
        self.assertEqual(report["totals"]["periods"], 2)
        for p in portfolio["periods"]:
            s = sum(b["marketValue"] for b in p["balances"])
            self.assertAlmostEqual(s, p["totalNetWorth"], places=2)
        self.assertEqual(portfolio["periods"][0]["cashFlows"]["deposits"], 500)


# Optional PDF smoke tests — skip when personal PDFs are not on this machine
PDF_ROOT = Path.home() / "Downloads" / "Monthly PDF Statements"
WS_SAMPLE = (
    PDF_ROOT
    / "Wealthsimple Monthly PDF Statements"
)
QT_SAMPLE = PDF_ROOT / "Questrade Monthly PDF Statements"


@unittest.skipUnless(WS_SAMPLE.is_dir(), "Wealthsimple PDF folder not found")
class TestWealthsimplePdfOptional(unittest.TestCase):
    def test_parse_one_if_present(self) -> None:
        pdfs = list(WS_SAMPLE.rglob("*.pdf"))
        if not pdfs:
            self.skipTest("no WS PDFs")
        ex = get_parser("wealthsimple")(pdfs[0])
        self.assertEqual(ex.institution, "Wealthsimple")
        self.assertTrue(ex.period_id)
        self.assertGreaterEqual(ex.market_value_cad, 0)


@unittest.skipUnless(QT_SAMPLE.is_dir(), "Questrade PDF folder not found")
class TestQuestradePdfOptional(unittest.TestCase):
    def test_parse_one_if_present(self) -> None:
        pdfs = list(QT_SAMPLE.rglob("*.pdf"))
        if not pdfs:
            self.skipTest("no QT PDFs")
        ex = get_parser("questrade")(pdfs[0])
        self.assertEqual(ex.institution, "Questrade")
        self.assertTrue(ex.period_id)


if __name__ == "__main__":
    unittest.main()
