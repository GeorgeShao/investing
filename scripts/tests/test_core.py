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
    refine_usd_fx,
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


class TestRefineUsdFx(unittest.TestCase):
    def _usd_extract(self, period: str, mv: float) -> StatementExtract:
        return StatementExtract(
            source_path="f.pdf",
            institution="Fidelity",
            account_number="Z52-1",
            account_type="non_registered",
            statement_currency="USD",
            period_id=period,
            label=period,
            start_date=f"{period}-01",
            end_date=f"{period}-28",
            market_value=mv,
            market_value_cad=mv,  # 1:1 until refined
            deposits=0.0,
            notes=["missing_fx_rate_usd_assumed_1"],
            fx_rate=None,
        )

    def test_prefers_same_period_sibling_over_benchmark(self) -> None:
        usd = self._usd_extract("2026-07", 1000.0)
        cad_sib = StatementExtract(
            source_path="qt.pdf",
            institution="Questrade",
            account_number="1",
            account_type="margin",
            statement_currency="CAD",
            period_id="2026-07",
            label="Jul 2026",
            start_date="2026-07-01",
            end_date="2026-07-31",
            market_value=1.0,
            market_value_cad=1.0,
            fx_rate=1.35,
        )
        refine_usd_fx([usd, cad_sib], usdcad_by_period={"2026-07": 1.40})
        self.assertAlmostEqual(usd.fx_rate or 0, 1.35, places=4)
        self.assertAlmostEqual(usd.market_value_cad, 1350.0, places=2)
        self.assertIn("fx_rate_filled_from_period_siblings", usd.notes)

    def test_falls_back_to_exact_month_usdcad_benchmark(self) -> None:
        usd = self._usd_extract("2026-07", 1000.0)
        refine_usd_fx([usd], usdcad_by_period={"2026-07": 1.40112})
        self.assertAlmostEqual(usd.fx_rate or 0, 1.40112, places=5)
        self.assertAlmostEqual(usd.market_value_cad, 1401.12, places=2)
        self.assertIn("fx_rate_filled_from_usdcad_benchmark", usd.notes)
        self.assertNotIn("missing_fx_rate_usd_assumed_1", usd.notes)

    def test_never_uses_neighboring_month_usdcad(self) -> None:
        usd = self._usd_extract("2026-07", 100.0)
        refine_usd_fx([usd], usdcad_by_period={"2026-06": 1.42, "2026-08": 1.41})
        self.assertIsNone(usd.fx_rate)
        self.assertAlmostEqual(usd.market_value_cad, 100.0, places=2)
        self.assertIn("missing_fx_rate_usd_assumed_1", usd.notes)

    def test_portfolio_meta_warns_when_exact_month_fx_missing(self) -> None:
        usd = self._usd_extract("2026-07", 500.0)
        portfolio, _ = build_portfolio(
            [usd],
            [],
            currency="CAD",
            usdcad_by_period={"2026-06": 1.42},  # wrong month only
            institution_slugs={"Fidelity": "fid"},
        )
        warnings = portfolio["meta"].get("warnings") or []
        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0]["code"], "usd_missing_exact_month_fx")
        self.assertEqual(warnings[0]["periodId"], "2026-07")

    def test_portfolio_meta_warns_when_positive_account_missing_from_latest_month(
        self,
    ) -> None:
        def cad(period: str, number: str, mv: float) -> StatementExtract:
            return StatementExtract(
                source_path=f"{number}-{period}.pdf",
                institution="Questrade",
                account_number=number,
                account_type="rrsp" if number == "RRSP" else "margin",
                statement_currency="CAD",
                period_id=period,
                label=period,
                start_date=f"{period}-01",
                end_date=f"{period}-28",
                market_value=mv,
                market_value_cad=mv,
            )

        portfolio, _ = build_portfolio(
            [
                cad("2026-06", "RRSP", 16793.76),
                cad("2026-06", "MARGIN", 1000.0),
                cad("2026-07", "MARGIN", 1100.0),
            ],
            [],
            currency="CAD",
            institution_slugs={"Questrade": "qt"},
        )
        warnings = [
            w
            for w in (portfolio["meta"].get("warnings") or [])
            if w.get("code") == "missing_latest_statement"
        ]
        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0]["accountId"], "qt-rrsp")
        self.assertEqual(warnings[0]["periodId"], "2026-06")
        self.assertEqual(warnings[0]["latestPeriodId"], "2026-07")
        self.assertAlmostEqual(warnings[0]["marketValue"], 16793.76, places=2)

        # $0 last appearance is not a missing statement
        closed, _ = build_portfolio(
            [
                cad("2026-06", "RRSP", 0.0),
                cad("2026-06", "MARGIN", 1000.0),
                cad("2026-07", "MARGIN", 1100.0),
            ],
            [],
            currency="CAD",
            institution_slugs={"Questrade": "qt"},
        )
        closed_warn = [
            w
            for w in (closed["meta"].get("warnings") or [])
            if w.get("code") == "missing_latest_statement"
        ]
        self.assertEqual(closed_warn, [])


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
        self.assertEqual(
            names,
            [
                "fidelity_employer",
                "fidelity_personal",
                "questrade",
                "wealthsimple",
            ],
        )
        self.assertTrue(callable(get_parser("questrade")))
        self.assertTrue(callable(get_parser("wealthsimple")))
        self.assertTrue(callable(get_parser("fidelity_personal")))
        self.assertTrue(callable(get_parser("fidelity_employer")))

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
