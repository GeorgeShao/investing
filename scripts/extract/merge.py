"""
Broker-agnostic merge: StatementExtract list → portfolio document.

Handles FX refinement, internal-transfer reclassification, and period assembly.
Does not know about specific brokerages — only StatementExtract records.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .common import (
    ACCOUNT_COLORS,
    StatementExtract,
    is_plausible_usd_to_cad,
    stable_account_id,
)

# --- Internal transfer reclassification ----------------------------------

_TRANSFER_ABS_TOL = 1.0
_TRANSFER_REL_TOL = 0.02
_TRANSFER_REL_TOL_CODED = 0.06


def _rescale_extract_fx(ex: StatementExtract, new_fx: float, old_fx: float) -> None:
    if old_fx <= 0 or abs(old_fx - new_fx) < 1e-9:
        return
    factor = new_fx / old_fx
    ex.market_value_cad = round(ex.market_value_cad * factor, 2)
    if ex.cash is not None:
        ex.cash = round(ex.cash * factor, 2)
    if ex.book_cost is not None:
        ex.book_cost = round(ex.book_cost * factor, 2)
    ex.deposits = round(ex.deposits * factor, 2)
    ex.withdrawals = round(ex.withdrawals * factor, 2)
    ex.dividends = round(ex.dividends * factor, 2)
    ex.interest = round(ex.interest * factor, 2)
    ex.fees = round(ex.fees * factor, 2)
    ex.transfers_in = round(ex.transfers_in * factor, 2)
    ex.transfers_out = round(ex.transfers_out * factor, 2)
    ex.fx_rate = new_fx


def refine_usd_fx(extracts: list[StatementExtract]) -> None:
    """Fill missing USD FX rates from plausible sibling rates in the same period."""
    by_period: dict[str, list[float]] = defaultdict(list)
    for ex in extracts:
        if is_plausible_usd_to_cad(ex.fx_rate):
            by_period[ex.period_id].append(float(ex.fx_rate))
    period_fx = {
        p: sorted(rates)[len(rates) // 2] for p, rates in by_period.items() if rates
    }
    for ex in extracts:
        if ex.statement_currency != "USD":
            continue
        if is_plausible_usd_to_cad(ex.fx_rate):
            continue
        fx = period_fx.get(ex.period_id)
        if not fx:
            continue
        old = ex.fx_rate if ex.fx_rate and ex.fx_rate > 0 else 1.0
        if abs(ex.market_value_cad - ex.market_value * old) < 0.05 or abs(old - 1.0) < 1e-9:
            _rescale_extract_fx(ex, fx, old)
            ex.notes = [n for n in ex.notes if n != "missing_fx_rate_usd_assumed_1"]
            ex.notes.append("fx_rate_filled_from_period_siblings")
            if ex.market_value != 0:
                ex.confidence = "medium"


def reclassify_internal_transfers(
    by_period: dict[str, dict[str, StatementExtract]],
) -> list[dict[str, Any]]:
    """
    Strip account-to-account movements out of deposits/withdrawals so period
    cash flows are external-only (bank <-> household).
    """
    adjustments: list[dict[str, Any]] = []
    for period_id in sorted(by_period.keys()):
        acct_map = by_period[period_id]
        ext_dep = {aid: float(ex.deposits) for aid, ex in acct_map.items()}
        ext_wd = {aid: float(ex.withdrawals) for aid, ex in acct_map.items()}
        reclass_in: dict[str, float] = defaultdict(float)
        reclass_out: dict[str, float] = defaultdict(float)

        while True:
            best: tuple[float, str, str] | None = None
            for src in acct_map:
                if ext_wd[src] <= 0:
                    continue
                for dst in acct_map:
                    if src == dst or ext_dep[dst] <= 0:
                        continue
                    base = min(ext_wd[src], ext_dep[dst])
                    if base <= 0:
                        continue
                    diff = abs(ext_wd[src] - ext_dep[dst])
                    coded = (
                        acct_map[src].transfers_out > 0
                        and acct_map[dst].transfers_in > 0
                    )
                    rel = _TRANSFER_REL_TOL_CODED if coded else _TRANSFER_REL_TOL
                    if diff <= max(_TRANSFER_ABS_TOL, rel * base) and (
                        best is None or diff < best[0]
                    ):
                        best = (diff, src, dst)
            if best is None:
                break
            _, src, dst = best
            out_amt = round(ext_wd[src], 2)
            in_amt = round(ext_dep[dst], 2)
            ext_wd[src] = 0.0
            ext_dep[dst] = 0.0
            reclass_out[src] += out_amt
            reclass_in[dst] += in_amt
            adjustments.append(
                {
                    "periodId": period_id,
                    "fromAccountId": src,
                    "toAccountId": dst,
                    "amount": round((out_amt + in_amt) / 2.0, 2),
                    "fromAmount": out_amt,
                    "toAmount": in_amt,
                    "reason": "matched_cross_account_flow",
                }
            )

        for aid, ex in acct_map.items():
            extra_in = round(
                min(max(0.0, ex.transfers_in - reclass_in[aid]), ext_dep[aid]), 2
            )
            if extra_in > 0:
                ext_dep[aid] = round(ext_dep[aid] - extra_in, 2)
                reclass_in[aid] += extra_in
                adjustments.append(
                    {
                        "periodId": period_id,
                        "fromAccountId": None,
                        "toAccountId": aid,
                        "amount": extra_in,
                        "reason": "statement_coded_transfer_in",
                    }
                )
            extra_out = round(
                min(max(0.0, ex.transfers_out - reclass_out[aid]), ext_wd[aid]), 2
            )
            if extra_out > 0:
                ext_wd[aid] = round(ext_wd[aid] - extra_out, 2)
                reclass_out[aid] += extra_out
                adjustments.append(
                    {
                        "periodId": period_id,
                        "fromAccountId": aid,
                        "toAccountId": None,
                        "amount": extra_out,
                        "reason": "statement_coded_transfer_out",
                    }
                )

        for aid, ex in acct_map.items():
            if not (reclass_in[aid] or reclass_out[aid]):
                continue
            ex.deposits = ext_dep[aid]
            ex.withdrawals = ext_wd[aid]
            ex.transfers_in = round(max(ex.transfers_in, reclass_in[aid]), 2)
            ex.transfers_out = round(max(ex.transfers_out, reclass_out[aid]), 2)
            note = "external_flows_exclude_internal_transfers"
            if note not in ex.notes:
                ex.notes.append(note)

    return adjustments


def account_id_for(
    ex: StatementExtract,
    institution_slugs: dict[str, str] | None = None,
) -> str:
    """Resolve stable id, optionally using config broker id as slug."""
    slug = None
    if institution_slugs:
        slug = institution_slugs.get(ex.institution) or institution_slugs.get(
            ex.institution.lower()
        )
    return stable_account_id(ex.institution, ex.account_number, slug=slug)


def build_portfolio(
    extracts: list[StatementExtract],
    errors: list[dict[str, Any]],
    *,
    currency: str = "CAD",
    pdf_root: str | None = None,
    institution_slugs: dict[str, str] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    refine_usd_fx(extracts)

    type_votes: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    accounts_meta: dict[str, dict[str, Any]] = {}
    for ex in extracts:
        aid = account_id_for(ex, institution_slugs)
        type_votes[aid][ex.account_type] += 1
        if aid not in accounts_meta:
            ccy = (
                ex.account_number[-3:]
                if len(ex.account_number) >= 3 and ex.account_number[-3:] in {"CAD", "USD"}
                else ex.statement_currency
            )
            accounts_meta[aid] = {
                "id": aid,
                "name": "",
                "institution": ex.institution,
                "type": ex.account_type,
                "currency": ccy if ccy in {"CAD", "USD"} else currency,
                "openedAt": ex.start_date,
                "status": "active",
                "externalIds": {
                    "accountNumber": ex.account_number,
                },
            }
        else:
            if ex.start_date < accounts_meta[aid].get("openedAt", ex.start_date):
                accounts_meta[aid]["openedAt"] = ex.start_date

    type_names = {
        "non_registered": "Non-Registered",
        "tfsa": "TFSA",
        "rrsp": "RRSP",
        "fhsa": "FHSA",
        "margin": "Margin",
        "other": "Other",
    }
    for aid, meta in accounts_meta.items():
        votes = type_votes[aid]
        ranked = sorted(
            votes.items(),
            key=lambda kv: (kv[0] == "other", -kv[1], kv[0]),
        )
        best_type = ranked[0][0]
        meta["type"] = best_type
        # Short display prefix: prefer known brokerage nicknames, else initials/slug
        inst = meta["institution"]
        inst_l = inst.lower()
        if "wealthsimple" in inst_l or inst_l == "ws":
            prefix = "WS"
        elif "questrade" in inst_l or inst_l == "qt":
            prefix = "QT"
        else:
            initials = "".join(c for c in inst if c.isupper())[:3]
            prefix = initials or inst[:3].upper()
        meta["name"] = (
            f"{prefix} {type_names.get(best_type, 'Account')} "
            f"({meta['externalIds']['accountNumber']})"
        )

    for i, aid in enumerate(sorted(accounts_meta.keys())):
        accounts_meta[aid]["color"] = ACCOUNT_COLORS[i % len(ACCOUNT_COLORS)]

    by_period: dict[str, dict[str, StatementExtract]] = defaultdict(dict)
    for ex in extracts:
        aid = account_id_for(ex, institution_slugs)
        by_period[ex.period_id][aid] = ex

    transfer_adjustments = reclassify_internal_transfers(by_period)

    periods_out: list[dict[str, Any]] = []
    validation_flags: list[dict[str, Any]] = []

    for period_id in sorted(by_period.keys()):
        acct_map = by_period[period_id]
        sample = next(iter(acct_map.values()))
        balances = []
        deposits = withdrawals = dividends = interest = fees = 0.0
        transfers_in = transfers_out = 0.0
        period_holdings: list[dict[str, Any]] = []
        period_txs: list[dict[str, Any]] = []
        fx_rates: dict[str, float] = {}

        for aid, ex in sorted(acct_map.items()):
            balances.append(
                {
                    "accountId": aid,
                    "marketValue": round(ex.market_value_cad, 2),
                    "cash": round(ex.cash, 2) if ex.cash is not None else None,
                    "bookCost": round(ex.book_cost, 2) if ex.book_cost is not None else None,
                    "nativeMarketValue": ex.market_value,
                    "nativeCurrency": ex.statement_currency,
                    "sourceFile": Path(ex.source_path).name,
                }
            )
            deposits += ex.deposits
            withdrawals += ex.withdrawals
            dividends += ex.dividends
            interest += ex.interest
            fees += ex.fees
            transfers_in += ex.transfers_in
            transfers_out += ex.transfers_out
            if ex.fx_rate:
                fx_rates[aid] = ex.fx_rate
            for h in ex.holdings:
                period_holdings.append(
                    {
                        "accountId": aid,
                        "symbol": h.symbol,
                        "name": h.name,
                        "quantity": h.quantity,
                        "marketPrice": h.market_price,
                        "marketValue": h.market_value,
                        "bookCost": h.book_cost,
                        "currency": h.currency,
                    }
                )
            for t in ex.transactions:
                period_txs.append(
                    {
                        "accountId": aid,
                        "date": t.date,
                        "code": t.code,
                        "description": t.description,
                        "debit": t.debit,
                        "credit": t.credit,
                        "balance": t.balance,
                        "symbol": t.symbol,
                        "net": t.net,
                    }
                )

        clean_balances = []
        for b in balances:
            cb: dict[str, Any] = {
                "accountId": b["accountId"],
                "marketValue": b["marketValue"],
            }
            if b.get("cash") is not None:
                cb["cash"] = b["cash"]
            if b.get("bookCost") is not None:
                cb["bookCost"] = b["bookCost"]
            cb["nativeMarketValue"] = b["nativeMarketValue"]
            cb["nativeCurrency"] = b["nativeCurrency"]
            clean_balances.append(cb)

        total = round(sum(b["marketValue"] for b in clean_balances), 2)
        periods_out.append(
            {
                "id": period_id,
                "label": sample.label,
                "startDate": sample.start_date,
                "endDate": sample.end_date,
                "balances": clean_balances,
                "totalNetWorth": total,
                "cashFlows": {
                    "deposits": round(deposits, 2),
                    "withdrawals": round(withdrawals, 2),
                    "dividends": round(dividends, 2),
                    "interest": round(interest, 2),
                    "fees": round(fees, 2),
                    "transfersIn": round(transfers_in, 2),
                    "transfersOut": round(transfers_out, 2),
                },
                "holdings": period_holdings,
                "transactions": period_txs,
                "fxRates": fx_rates,
            }
        )

    accounts_list = [accounts_meta[k] for k in sorted(accounts_meta.keys())]

    coverage: dict[str, Any] = {}
    for aid, meta in accounts_meta.items():
        periods = sorted(
            ex.period_id
            for ex in extracts
            if account_id_for(ex, institution_slugs) == aid
        )
        mvs = [
            ex.market_value_cad
            for ex in extracts
            if account_id_for(ex, institution_slugs) == aid
        ]
        coverage[aid] = {
            "accountNumber": meta["externalIds"]["accountNumber"],
            "institution": meta["institution"],
            "type": meta["type"],
            "statementCount": len(periods),
            "firstPeriod": periods[0] if periods else None,
            "lastPeriod": periods[-1] if periods else None,
            "maxMarketValueCad": round(max(mvs), 2) if mvs else 0,
            "nonzeroMonths": sum(1 for v in mvs if abs(v) > 0.005),
        }

    if periods_out:
        all_ids = [p["id"] for p in periods_out]
        y0, m0 = map(int, all_ids[0].split("-"))
        y1, m1 = map(int, all_ids[-1].split("-"))
        expected: list[str] = []
        y, m = y0, m0
        while (y, m) <= (y1, m1):
            expected.append(f"{y:04d}-{m:02d}")
            m += 1
            if m > 12:
                m = 1
                y += 1
        gaps = [p for p in expected if p not in set(all_ids)]
    else:
        gaps = []

    portfolio = {
        "meta": {
            "schemaVersion": 2,
            "currency": currency,
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "description": (
                "Portfolio data extracted from brokerage monthly statement PDFs."
            ),
            "notes": [
                "Balances are month-end market values converted to base currency when needed.",
                "Investment/brokerage accounts only — bank and credit-card statements are out of scope.",
                "Cash flows: deposits/withdrawals are EXTERNAL only; account-to-account movements are reclassified as transfers.",
                "Empty $0 statements are retained when a PDF exists for that month.",
                "PDFs are not stored in this repository; re-run scripts/run_extract.py to regenerate.",
            ],
            "source": {
                "pdfRoot": pdf_root,
                "extractCount": len(extracts),
                "errorCount": len(errors),
            },
        },
        "accounts": accounts_list,
        "periods": periods_out,
    }

    report = {
        "generatedAt": portfolio["meta"]["generatedAt"],
        "pdfRoot": pdf_root,
        "totals": {
            "pdfsParsed": len(extracts),
            "pdfsFailed": len(errors),
            "accounts": len(accounts_list),
            "periods": len(periods_out),
            "earliestPeriod": periods_out[0]["id"] if periods_out else None,
            "latestPeriod": periods_out[-1]["id"] if periods_out else None,
            "latestNetWorthCad": periods_out[-1]["totalNetWorth"] if periods_out else None,
        },
        "coverageByAccount": coverage,
        "periodGaps": gaps,
        "validationFlags": validation_flags,
        "transferAdjustments": transfer_adjustments,
        "errors": errors,
        "assumptions": [
            f"Base currency: {currency}",
            "Zero-balance months included when a statement PDF exists",
            "Deposits/withdrawals exclude internal account-to-account transfers",
            "Idempotent: same PDFs produce the same balances/cash flows (generatedAt differs)",
        ],
    }
    report["totals"]["transferAdjustmentCount"] = len(transfer_adjustments)
    report["totals"]["transferAdjustmentCad"] = round(
        sum(a["amount"] for a in transfer_adjustments), 2
    )
    return portfolio, report


def validate_portfolio(
    portfolio: dict[str, Any],
    extracts: list[StatementExtract] | None = None,
    institution_slugs: dict[str, str] | None = None,
) -> tuple[list[str], list[dict[str, Any]]]:
    issues: list[str] = []
    flags: list[dict[str, Any]] = []
    if not portfolio.get("accounts"):
        issues.append("no_accounts")
    if not portfolio.get("periods"):
        issues.append("no_periods")
    for p in portfolio.get("periods", []):
        s = sum(b.get("marketValue", 0) for b in p.get("balances", []))
        if abs(s - p.get("totalNetWorth", 0)) > 0.05:
            issues.append(f"mismatch:{p.get('id')}:{s}!={p.get('totalNetWorth')}")
            flags.append(
                {
                    "periodId": p.get("id"),
                    "issue": "total_net_worth_mismatch",
                    "sumBalances": s,
                    "totalNetWorth": p.get("totalNetWorth"),
                }
            )
        cf = p.get("cashFlows") or {}
        for k in ("deposits", "withdrawals", "dividends", "interest"):
            if k not in cf:
                issues.append(f"missing_cf:{p.get('id')}:{k}")

    if extracts:
        for ex in extracts:
            aid = account_id_for(ex, institution_slugs)
            if ex.statement_currency == "USD" and abs(ex.market_value) > 0.005:
                if not is_plausible_usd_to_cad(ex.fx_rate):
                    flags.append(
                        {
                            "periodId": ex.period_id,
                            "accountId": aid,
                            "issue": "usd_missing_or_implausible_fx",
                            "fxRate": ex.fx_rate,
                            "nativeMarketValue": ex.market_value,
                            "marketValueCad": ex.market_value_cad,
                            "confidence": ex.confidence,
                            "notes": list(ex.notes),
                        }
                    )
                elif abs(ex.market_value_cad - ex.market_value * float(ex.fx_rate)) > 0.1:
                    flags.append(
                        {
                            "periodId": ex.period_id,
                            "accountId": aid,
                            "issue": "usd_cad_inconsistent_with_fx",
                            "fxRate": ex.fx_rate,
                            "nativeMarketValue": ex.market_value,
                            "marketValueCad": ex.market_value_cad,
                        }
                    )
            if (
                ex.statement_currency == "USD"
                and ex.market_value > 100
                and ex.market_value_cad < ex.market_value * 0.95
            ):
                flags.append(
                    {
                        "periodId": ex.period_id,
                        "accountId": aid,
                        "issue": "usd_cad_looks_inverted_or_unconverted",
                        "fxRate": ex.fx_rate,
                        "nativeMarketValue": ex.market_value,
                        "marketValueCad": ex.market_value_cad,
                    }
                )
    return issues, flags
