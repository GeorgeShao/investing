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


def _median(rates: list[float]) -> float:
    s = sorted(rates)
    return s[len(s) // 2]


def refine_usd_fx(
    extracts: list[StatementExtract],
    *,
    usdcad_by_period: dict[str, float] | None = None,
) -> None:
    """
    Fill missing USD→CAD rates for USD statements using the **exact** month only.

    Priority:
      1. Plausible rate already on the extract
      2. Median of other extracts in the same period (statement footnotes)
      3. Month-end USDCAD for that same period_id from data/benchmarks.json (CAD=X)

    Never borrows a rate from another month. If neither source has an exact-month
    rate, leave the extract flagged with ``missing_fx_rate_usd_assumed_1`` so the
    dashboard / report can alert — do not invent a conversion.
    """
    by_period: dict[str, list[float]] = defaultdict(list)
    for ex in extracts:
        if is_plausible_usd_to_cad(ex.fx_rate):
            by_period[ex.period_id].append(float(ex.fx_rate))
    sibling_fx = {
        p: _median(rates) for p, rates in by_period.items() if rates
    }

    bench_fx: dict[str, float] = {}
    if usdcad_by_period:
        for pid, rate in usdcad_by_period.items():
            try:
                r = float(rate)
            except (TypeError, ValueError):
                continue
            if is_plausible_usd_to_cad(r):
                bench_fx[str(pid)] = r

    for ex in extracts:
        if ex.statement_currency != "USD":
            continue
        if is_plausible_usd_to_cad(ex.fx_rate):
            continue

        fx: float | None = None
        note: str | None = None
        if ex.period_id in sibling_fx:
            fx = sibling_fx[ex.period_id]
            note = "fx_rate_filled_from_period_siblings"
        elif ex.period_id in bench_fx:
            fx = bench_fx[ex.period_id]
            note = "fx_rate_filled_from_usdcad_benchmark"

        if not fx:
            # Exact-month rate unavailable — keep 1:1 placeholder + flag for alert.
            if "missing_fx_rate_usd_assumed_1" not in ex.notes:
                ex.notes.append("missing_fx_rate_usd_assumed_1")
            if abs(ex.market_value) > 0.005:
                ex.confidence = "medium"
            continue

        old = ex.fx_rate if ex.fx_rate and ex.fx_rate > 0 else 1.0
        if abs(ex.market_value_cad - ex.market_value * old) < 0.05 or abs(old - 1.0) < 1e-9:
            _rescale_extract_fx(ex, fx, old)
            ex.notes = [n for n in ex.notes if n != "missing_fx_rate_usd_assumed_1"]
            if note:
                ex.notes.append(note)
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
    usdcad_by_period: dict[str, float] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    refine_usd_fx(extracts, usdcad_by_period=usdcad_by_period)

    type_votes: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    accounts_meta: dict[str, dict[str, Any]] = {}
    for ex in extracts:
        aid = account_id_for(ex, institution_slugs)
        type_votes[aid][ex.account_type] += 1
        if aid not in accounts_meta:
            # Prefer CAD/USD suffix on account numbers (Wealthsimple sleeves),
            # else statement currency (Fidelity Personal/Employer are always USD).
            if len(ex.account_number) >= 3 and ex.account_number[-3:] in {"CAD", "USD"}:
                ccy = ex.account_number[-3:]
            elif ex.statement_currency in {"CAD", "USD"}:
                ccy = ex.statement_currency
            else:
                ccy = currency
            accounts_meta[aid] = {
                "id": aid,
                "name": "",
                "institution": ex.institution,
                "type": ex.account_type,
                "currency": ccy,
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
        elif "fidelity" in inst_l and ("employer" in inst_l or "netbenefits" in inst_l):
            prefix = "Fidelity Employer"
        elif "fidelity" in inst_l:
            prefix = "Fidelity"
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
                "Fidelity Personal and Fidelity Employer statements are USD-native; CAD totals use same-period statement FX when available, else exact-month USDCAD from data/benchmarks.json (never a neighboring month).",
                "Fidelity Employer NetBenefits totals exclude the Brokeragelink sleeve (covered by Personal BrokerageLink reports) to avoid double-counting.",
                "Cash flows: deposits/withdrawals are EXTERNAL only; account-to-account movements are reclassified as transfers.",
                "Empty $0 statements are retained when a PDF exists for that month.",
                "PDFs are not stored in this repository; re-run scripts/run_extract.py to regenerate.",
            ],
            "source": {
                "pdfRoot": pdf_root,
                "extractCount": len(extracts),
                "errorCount": len(errors),
            },
            "warnings": _usd_fx_warnings(extracts, institution_slugs)
            + _missing_latest_statement_warnings(periods_out, accounts_list),
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
            "Fidelity accounts default to native USD; CAD uses same-period statement FX or exact-month USDCAD only",
            "Missing exact-month FX is never replaced with a neighboring month; meta.warnings lists those accounts",
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


def _usd_fx_warnings(
    extracts: list[StatementExtract],
    institution_slugs: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """USD extracts still missing an exact-month conversion rate after refine."""
    warnings: list[dict[str, Any]] = []
    for ex in extracts:
        if ex.statement_currency != "USD":
            continue
        if abs(ex.market_value) <= 0.005:
            continue
        if is_plausible_usd_to_cad(ex.fx_rate):
            continue
        warnings.append(
            {
                "code": "usd_missing_exact_month_fx",
                "periodId": ex.period_id,
                "accountId": account_id_for(ex, institution_slugs),
                "accountNumber": ex.account_number,
                "institution": ex.institution,
                "nativeMarketValue": ex.market_value,
                "message": (
                    f"No USD→CAD rate for {ex.period_id} on {ex.institution} "
                    f"({ex.account_number}). Need a same-period statement FX or "
                    f"data/benchmarks.json prices.USDCAD for that exact month "
                    f"(re-run: python scripts/fetch_benchmarks.py). "
                    f"CAD totals currently treat this balance as unconverted."
                ),
            }
        )
    return warnings


_POSITIVE_EPS = 0.005


def _missing_latest_statement_warnings(
    periods: list[dict[str, Any]],
    accounts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Account had a positive month-end the last time it appeared, but that
    month is not the portfolio's latest month — usually a missing statement.
    """
    if len(periods) < 2:
        return []
    latest = periods[-1]
    latest_id = latest.get("id")
    latest_ids = {b.get("accountId") for b in latest.get("balances") or []}
    by_id = {a.get("id"): a for a in accounts}
    warnings: list[dict[str, Any]] = []

    account_ids: list[str] = []
    seen: set[str] = set()
    for a in accounts:
        aid = a.get("id")
        if aid and aid not in seen:
            seen.add(aid)
            account_ids.append(aid)
    for p in periods:
        for b in p.get("balances") or []:
            aid = b.get("accountId")
            if aid and aid not in seen:
                seen.add(aid)
                account_ids.append(aid)

    for aid in account_ids:
        meta = by_id.get(aid) or {}
        if meta.get("status") == "closed":
            continue
        if aid in latest_ids:
            continue
        last_period: str | None = None
        last_mv: float | None = None
        for p in periods:
            for b in p.get("balances") or []:
                if b.get("accountId") == aid:
                    last_period = p.get("id")
                    try:
                        last_mv = float(b.get("marketValue") or 0)
                    except (TypeError, ValueError):
                        last_mv = 0.0
        if (
            last_period is None
            or last_mv is None
            or last_period == latest_id
            or last_mv <= _POSITIVE_EPS
        ):
            continue
        name = meta.get("name") or aid
        warnings.append(
            {
                "code": "missing_latest_statement",
                "periodId": last_period,
                "latestPeriodId": latest_id,
                "accountId": aid,
                "accountNumber": (meta.get("externalIds") or {}).get(
                    "accountNumber"
                ),
                "institution": meta.get("institution"),
                "marketValue": round(last_mv, 2),
                "message": (
                    f"{name} had a positive month-end balance in {last_period} "
                    f"({last_mv:,.2f}) but does not appear in {latest_id}, "
                    f"the latest month in this extract. Portfolio totals and "
                    f"returns omit that account until a statement is added."
                ),
            }
        )
    return warnings


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
