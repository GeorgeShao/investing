"""Fidelity Personal INVESTMENT REPORT (brokerage / BrokerageLink) parser.

All Fidelity Personal accounts are USD-native (no CAD account sleeves).
CAD conversion is left to merge refine_usd_fx (statement sibling FX, else
month-end USDCAD from data/benchmarks.json).
"""

from __future__ import annotations

import re
from pathlib import Path

from .common import (
    Holding,
    StatementExtract,
    money,
    month_bounds,
    parse_pdf_text,
)

_MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


def _period(text: str, path: Path) -> tuple[str, str, str, str]:
    """
    Header date range, e.g. 'July 7, 2026 - July 31, 2026'.
    Period id uses the end month (statement month).
    """
    m = re.search(
        r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})",
        text,
    )
    if m:
        sm, sd, sy = m.group(1), int(m.group(2)), int(m.group(3))
        em, ed, ey = m.group(4), int(m.group(5)), int(m.group(6))
        smo = _MONTHS.get(sm.lower())
        emo = _MONTHS.get(em.lower())
        if smo and emo:
            period_id, label, _, _ = month_bounds(ey, emo)
            start = f"{sy:04d}-{smo:02d}-{sd:02d}"
            end = f"{ey:04d}-{emo:02d}-{ed:02d}"
            return period_id, label, start, end
    # Filename StatementMMDDYYYY.pdf
    m = re.search(r"Statement(\d{2})(\d{2})(\d{4})", path.name)
    if m:
        mo, _day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return month_bounds(year, mo)
    raise ValueError(f"Period not found in Fidelity Personal statement {path}")


def _account_number(text: str) -> str:
    m = re.search(r"Account\s*Number:\s*([A-Z0-9][A-Z0-9\-]+)", text, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r"Account\s*#\s*([A-Z0-9][A-Z0-9\-]+)", text, re.I)
    if m:
        return m.group(1).strip()
    raise ValueError("Fidelity Personal account number not found")


def _account_type_label(text: str) -> tuple[str, str]:
    """Return (mapped type, raw label)."""
    raw = "Fidelity Account"
    # Prefer BrokerageLink / plan labels before generic Individual TOD
    if re.search(r"BROKERAGELINK\s+ROTH", text, re.I):
        raw = "BrokerageLink Roth 401(k)"
        return "rrsp", raw
    if re.search(r"\bBROKERAGELINK\b", text, re.I):
        raw = "BrokerageLink 401(k)"
        return "rrsp", raw
    if re.search(r"401\s*\(\s*K\s*\)|401k", text, re.I):
        raw = "401(k)"
        return "rrsp", raw
    m = re.search(
        r"FIDELITY ACCOUNT\s+([^\n]+)",
        text,
        re.I,
    )
    if m:
        raw = re.sub(r"\s+", " ", m.group(1)).strip()
    elif re.search(r"INDIVIDUAL\s*-?\s*TOD", text, re.I):
        raw = "Individual TOD"
    # Map using local rules (keep in sync with common.map_account_type_label)
    t = raw.lower()
    if "401" in t or "retirement" in t or "roth" in t or "brokeragelink" in t:
        return "rrsp", raw
    if "individual" in t or "tod" in t or "joint" in t:
        return "non_registered", raw
    if "ira" in t:
        return "rrsp", raw
    return "other", raw


def _account_value(text: str) -> float:
    m = re.search(
        r"Your\s+Account\s+Value:\s*\$?([\d,]+\.\d{2})",
        text,
        re.I,
    )
    if m:
        v = money(m.group(1))
        if v is not None:
            return v
    m = re.search(
        r"Ending\s+Account\s+Value\s+\*+\s*\$?([\d,]+\.\d{2})",
        text,
        re.I,
    )
    if m:
        v = money(m.group(1))
        if v is not None:
            return v
    m = re.search(
        r"Ending\s+Account\s+Value\s+\$?([\d,]+\.\d{2})",
        text,
        re.I,
    )
    if m:
        v = money(m.group(1))
        if v is not None:
            return v
    raise ValueError("Your Account Value / Ending Account Value not found")


def _this_period_amount(text: str, label: str) -> float:
    """
    Grab the first numeric This-Period column after a label.

    Layout:
      Deposits 86,500.41 86,500.41
      Withdrawals -0.41 -0.41
      Transaction Costs, Fees & Charges -100.02 -100.02
      Dividends 43.04 43.04

    Prefer full signed amounts over a bare '-' placeholder (which means zero).
    """
    pat = (
        rf"{label}\s+"
        r"(-?\$?[\d,]+\.\d{2}|\(\$?[\d,]+\.\d{2}\)|-)"
    )
    m = re.search(pat, text, re.I)
    if not m:
        return 0.0
    raw = m.group(1)
    if raw.strip() == "-":
        return 0.0
    v = money(raw)
    return abs(v) if v is not None else 0.0


def _cash_flows(text: str) -> dict[str, float]:
    # Prefer Account Summary page (has Deposits/Withdrawals lines); fall back to page 1
    deposits = _this_period_amount(text, r"Deposits")
    withdrawals = _this_period_amount(text, r"Withdrawals")
    # Fees: Transaction Costs, Fees & Charges
    fees = _this_period_amount(text, r"Transaction\s+Costs,?\s*Fees\s*(?:&|and)\s*Charges")
    if fees == 0.0:
        fees = _this_period_amount(text, r"Transaction\s+Costs")
    dividends = _this_period_amount(text, r"Dividends")
    # BrokerageLink opening transfers show as Exchanges In / Additions without Deposits
    exchanges_in = _this_period_amount(text, r"Exchanges\s+In")
    exchanges_out = _this_period_amount(text, r"Exchanges\s+Out")
    additions = _this_period_amount(text, r"Additions")
    # If no explicit Deposits but Additions exist and equal Exchanges In, treat as transfer
    transfers_in = exchanges_in
    transfers_out = exchanges_out
    if deposits == 0.0 and additions > 0 and exchanges_in == 0.0:
        # Unspecified additions — keep as deposits (external or plan contribution)
        deposits = additions
    return {
        "deposits": deposits,
        "withdrawals": withdrawals,
        "fees": fees,
        "dividends": dividends,
        "transfers_in": transfers_in,
        "transfers_out": transfers_out,
    }


def _core_cash(text: str) -> float | None:
    """Core money-market ending value when present."""
    m = re.search(
        r"Total\s+Core\s+Account[^\n]*\n[^\n]*?\$?([\d,]+\.\d{2})",
        text,
        re.I,
    )
    if m:
        return money(m.group(1))
    m = re.search(
        r"\(SPAXX\)[^\n]*\nunavailable\s+[\d,.]+\s+\$?[\d,.]+\s+\$?([\d,]+\.\d{2})",
        text,
        re.I,
    )
    if m:
        return money(m.group(1))
    m = re.search(
        r"\(FDRXX\)[^\n]*\nunavailable\s+[\d,.]+\s+\$?[\d,.]+\s+\$?([\d,]+\.\d{2})",
        text,
        re.I,
    )
    if m:
        return money(m.group(1))
    return None


def _parse_holdings(text: str) -> list[Holding]:
    """
    Best-effort holdings: ticker in parentheses followed by quantity / price / MV.

    Examples:
      ALPHABET INC CAP STK CL C (GOOG)  unavailable 40.000 356.6500 14,266.00 ...
      FIDELITY GOVERNMENT MONEY\\nMARKET   (SPAXX)\\nunavailable 113.550 $1.0000 $113.55 ...
      ROUNDHILL ETF TRUST MEMORY ETF\\n(DRAM) \\nunavailable 93.000 $50.3700 $4,684.41 ...
    """
    holdings: list[Holding] = []
    seen: set[str] = set()
    # symbol then optional whitespace/newlines then unavailable qty price mv
    row = re.compile(
        r"\(([A-Z][A-Z0-9.\-]{0,9})\)\s*"
        r"(?:\n|\s)+"
        r"unavailable\s+"
        r"([\d,]+\.\d+)\s+"
        r"\$?([\d,]+\.\d+)\s+"
        r"\$?([\d,]+\.\d{2})",
        re.I,
    )
    for m in row.finditer(text):
        sym = m.group(1).upper()
        if sym in seen:
            continue
        # Skip noise tokens that appear in legal boilerplate parentheses
        if sym in {"FBS", "NFS", "NYSE", "SIPC", "EAI", "FIFO", "SIPA", "FDC", "FCB", "NTF", "DTC", "HSA"}:
            continue
        qty = money(m.group(2))
        price = money(m.group(3))
        mv = money(m.group(4))
        if mv is None:
            continue
        seen.add(sym)
        # Name: text before the (SYMBOL)
        name_start = max(0, m.start() - 120)
        prefix = text[name_start:m.start()]
        name_line = re.split(r"[\n]", prefix)[-1].strip()
        name_line = re.sub(r"\s+", " ", name_line).strip(" -")
        holdings.append(
            Holding(
                symbol=sym,
                name=name_line or None,
                quantity=qty,
                market_price=price,
                market_value=mv,
                currency="USD",
            )
        )
    return holdings


def extract_fidelity_personal_pdf(path: str | Path) -> StatementExtract:
    path = Path(path)
    text = parse_pdf_text(path)
    if not text.strip():
        raise ValueError("Empty PDF text")
    if not re.search(r"INVESTMENT\s+REPORT", text, re.I):
        raise ValueError(f"Not a Fidelity Personal INVESTMENT REPORT: {path.name}")

    account_number = _account_number(text)
    period_id, label, start, end = _period(text, path)
    acct_type, type_label = _account_type_label(text)
    mv = _account_value(text)
    flows = _cash_flows(text)
    cash = _core_cash(text)
    holdings = _parse_holdings(text)

    notes: list[str] = [
        "fidelity_personal_usd_native",
        "missing_fx_rate_usd_assumed_1",
    ]
    if re.search(r"\bBROKERAGELINK\b", text, re.I):
        notes.append("brokeragelink_sleeve_prefer_over_employer_total")

    # USD native; CAD conversion deferred to refine_usd_fx (siblings / USDCAD)
    return StatementExtract(
        source_path=str(path),
        institution="Fidelity",
        account_number=account_number,
        account_type=acct_type,
        statement_currency="USD",
        period_id=period_id,
        label=label,
        start_date=start,
        end_date=end,
        market_value=mv,
        market_value_cad=mv,  # FX=1.0 until refined
        cash=cash,
        book_cost=None,
        deposits=round(flows["deposits"], 2),
        withdrawals=round(flows["withdrawals"], 2),
        dividends=round(flows["dividends"], 2),
        interest=0.0,
        fees=round(flows["fees"], 2),
        transfers_in=round(flows["transfers_in"], 2),
        transfers_out=round(flows["transfers_out"], 2),
        fx_rate=None,
        holdings=holdings,
        raw_account_type_label=type_label,
        confidence="medium",
        notes=notes,
        extras={
            "form": "fidelity_personal_investment_report",
            "isBrokerageLink": bool(re.search(r"\bBROKERAGELINK\b", text, re.I)),
        },
    )
