"""Wealthsimple monthly brokerage statement parser."""

from __future__ import annotations

import re
from pathlib import Path

from .common import (
    Holding,
    StatementExtract,
    Transaction,
    is_plausible_usd_to_cad,
    map_account_type_label,
    money,
    month_bounds,
    parse_pdf_text,
    parse_usd_to_cad_fx,
)


def _parse_period(text: str, filename: str) -> tuple[str, str, str, str]:
    m = re.search(
        r"(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})",
        text,
    )
    if m:
        start, end = m.group(1), m.group(2)
        y, mo = int(start[:4]), int(start[5:7])
        period_id, label, _, _ = month_bounds(y, mo)
        return period_id, label, start, end
    m = re.search(r"_(\d{4})-(\d{2})_", filename)
    if m:
        y, mo = int(m.group(1)), int(m.group(2))
        return month_bounds(y, mo)
    raise ValueError(f"Could not parse period from {filename}")


def _parse_account_number(text: str, filename: str) -> str:
    m = re.search(r"\b(HQ[A-Z0-9]+(?:CAD|USD))\b", text)
    if m:
        return m.group(1)
    m = re.search(r"(HQ[A-Z0-9]+(?:CAD|USD))", filename)
    if m:
        return m.group(1)
    raise ValueError(f"Could not parse account number from {filename}")


def _parse_account_type(text: str) -> tuple[str, str]:
    patterns = [
        r"(Order\s+Execution\s+Only\s+Non-Registered\s+Margin\s+Account)",
        r"(Non-Registered\s+SDI\s+Cash\s+Account)",
        r"(Non-Registered\s+Margin\s+Account)",
        r"(Self-directed\s+TFSA\s+Account)",
        r"(Tax-Free\s+Savings\s+SDI\s+Cash\s+Account)",
        r"(Self-directed\s+FHSA\s+Account)",
        r"(First\s+Home\s+Savings\s+SDI\s+Cash\s+Account)",
        r"(Self-directed\s+RRSP\s+Account)",
        r"(RRSP\s+SDI\s+Cash\s+Account)",
        r"(RESP\s+SDI\s+Cash\s+Account)",
        r"(Cash\s+Account)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            label = re.sub(r"\s+", " ", m.group(1)).strip()
            return map_account_type_label(label), label
    return "other", "Unknown"


def _statement_currency(text: str, account_number: str) -> str:
    if re.search(r"All figures in \$USD", text, re.I):
        return "USD"
    if re.search(r"All figures in \$CAD", text, re.I):
        return "CAD"
    if account_number.endswith("USD"):
        return "USD"
    return "CAD"


def _fx_rate(text: str) -> float | None:
    """Return CAD per 1 USD when a conversion footnote/activity rate is present."""
    return parse_usd_to_cad_fx(text)


def _total_portfolio(text: str) -> tuple[float | None, float | None]:
    """Return (market_value, book_cost) for Total Portfolio line."""
    m = re.search(
        r"Total\s+Portfolio\s+\$?([\d,]+\.\d{2})\s+[\d.]+\s+\$?([\d,]+\.\d{2})",
        text,
        re.I,
    )
    if m:
        return money(m.group(1)), money(m.group(2))
    m = re.search(r"Total\s+Portfolio\s+\$?([\d,]+\.\d{2})", text, re.I)
    if m:
        return money(m.group(1)), None
    return None, None


def _closing_cash(text: str) -> float | None:
    # Prefer first Combined CAD figure when dual columns present.
    m = re.search(
        r"Closing\s+Cash\s+Balance\s+\$?([\d,]+\.\d{2})(?:\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2}))?",
        text,
        re.I,
    )
    if not m:
        return None
    if m.group(2) is not None:
        # Combined, CAD, USD — use Combined for CAD statements
        return money(m.group(1))
    return money(m.group(1))


def _pair_amounts(line: str) -> tuple[float, float]:
    """Extract one or two money amounts from a cash-flow line."""
    amounts = re.findall(r"\$?([\d,]+\.\d{2})", line)
    if not amounts:
        return 0.0, 0.0
    if len(amounts) == 1:
        return money(amounts[0]) or 0.0, 0.0
    return money(amounts[0]) or 0.0, money(amounts[1]) or 0.0


def _cash_flow_field(text: str, label: str) -> tuple[float, float]:
    """
    Find a cash-flow row by label. Handles:
      Deposits $1.00
      Cash Paid In Deposits $0.00 $1.00
      Interest Earned $0.00 $0.00
    Returns (cad_or_primary, usd_optional).
    """
    # Prefer lines that include the label after optional "Cash Paid In/Out"
    patterns = [
        rf"(?:Cash\s+Paid\s+(?:In|Out)\s+)?{label}\s+((?:\$?[\d,]+\.\d{{2}}\s*){{1,2}})",
        rf"{label}\s+((?:\$?[\d,]+\.\d{{2}}\s*){{1,2}})",
    ]
    for pat in patterns:
        for m in re.finditer(pat, text, re.I):
            chunk = m.group(0)
            # Avoid matching "Total Cash Paid In"
            if re.search(r"Total\s+Cash\s+Paid", chunk, re.I):
                continue
            a, b = _pair_amounts(chunk)
            return a, b
    return 0.0, 0.0


def _to_cad(primary: float, usd: float, currency: str, fx: float | None) -> float:
    rate = fx if fx and fx > 0 else 1.0
    if currency == "CAD":
        # Dual-column CAD statements: primary is CAD column, second is USD
        # For single-column, only primary is set.
        return primary + usd * rate
    # USD statement: primary is USD
    return primary * rate + usd * rate


def _holdings_section(text: str) -> str:
    """Prefer Portfolio Equities block when present (avoids activity noise)."""
    m = re.search(
        r"Portfolio Equities(.*?)(?:\*Book Cost|Activity\s*-\s*Current|"
        r"LEVERAGE DISCLOSURE|STATEMENT NOTES|Information about Statement|$)",
        text,
        re.S | re.I,
    )
    return m.group(1) if m else text


def _parse_holdings(text: str) -> list[Holding]:
    """
    Parse Portfolio Equities / Options rows.

    Supports:
    - Classic 2-qty rows: Name SYM qty.seg $price USD $mv $book
    - Stock-lending 3-qty rows: ... qty seg loan $price (USD often on next line)
    - Names with parentheses: AST SpaceMobile Inc (Class A)
    - Options: AMD 251219C00110000 AMD 1.0000 0.0000 $38.30 ...
    """
    holdings: list[Holding] = []
    section = _holdings_section(text)

    # Allow newlines between price / currency / values (common in pypdf extracts).
    # Optional third quantity = "Quantity on Loan" when stock lending is active.
    # Quantities are often glued to the next field: 15.0000$141.90 or 78.0000$5.42
    row = re.compile(
        r"(?P<name>[A-Za-z0-9][A-Za-z0-9 .,&'\-/()]+?)\s+"
        r"(?P<symbol>[A-Z]{1,6}(?:\s+\d{6}[CP]\d{8})?)\s+"
        r"(?P<qty>\d+\.\d{4})\s*"
        r"(?P<seg>\d+\.\d{4})\s*"
        r"(?:(?P<loan>\d+\.\d{4})\s*)?"
        r"\$?(?P<price>[\d,]+\.\d{2})\s*"
        r"(?:USD|CAD)?\s*"
        r"\$?(?P<mv>[\d,]+\.\d{2})\s*"
        r"(?P<ccy>USD|CAD)?\s*"
        r"\$?(?P<book>[\d,]+\.\d{2})\s*"
        r"(?:USD|CAD)?",
        re.M | re.S,
    )

    skip_name = re.compile(
        r"symbol|equities|alternatives|conversion rate|quantity|market|book cost|"
        r"segregated|portfolio|options\b",
        re.I,
    )

    for m in row.finditer(section):
        name = re.sub(r"\s+", " ", m.group("name")).strip(" -:")
        if not name or skip_name.search(name):
            continue
        # Reject names that are clearly table chrome / section headers
        if len(name) > 80:
            continue

        sym = m.group("symbol").strip()
        # OCC option often duplicated like "AMD 251219C00110000 AMD"
        if re.match(r"^[A-Z]{1,6}$", sym) is None and " " in sym:
            parts = sym.split()
            # Prefer bare ticker if present; else first token
            sym = parts[-1] if re.match(r"^[A-Z]{1,6}$", parts[-1]) else parts[0]
            # Keep OCC root on name when symbol was collapsed
            if re.search(r"\d{6}[CP]\d{8}", m.group("symbol")) and not re.search(
                r"\d{6}[CP]\d{8}", name
            ):
                name = m.group("symbol").strip()

        # If name is OCC-style "AMD 251219C..." keep it; symbol is underlying
        qty = float(m.group("qty"))
        price = money(m.group("price"))
        mv = money(m.group("mv"))
        book = money(m.group("book"))
        if price is None or mv is None:
            continue

        ccy = m.group("ccy")
        if not ccy:
            # Currency may sit only after price (before mv) — already optional above.
            # Infer from nearby "USD"/"CAD" in the matched span when missing.
            span = m.group(0)
            if re.search(r"\bUSD\b", span):
                ccy = "USD"
            elif re.search(r"\bCAD\b", span):
                ccy = "CAD"

        holdings.append(
            Holding(
                symbol=sym,
                name=name,
                quantity=qty,
                market_price=price,
                market_value=mv,
                book_cost=book,
                currency=ccy,
            )
        )
    return holdings


def _parse_activity(text: str) -> list[Transaction]:
    txs: list[Transaction] = []
    # Flatten newlines in descriptions roughly by scanning date-code lines
    # 2025-06-12DIV MSFT ... $0.00 $12.60 $2,938.48
    # 2025-06-24BUY GOOG ... $2,831.01 $0.00 $114.97
    pattern = re.compile(
        r"(?P<date>\d{4}-\d{2}-\d{2})\s*"
        r"(?P<code>[A-Z]{2,12})\s+"
        r"(?P<body>.*?)(?=(?:\d{4}-\d{2}-\d{2}\s*[A-Z]{2,12}\s+)|(?:\d/\d)|LEVERAGE|STATEMENT NOTES|Information about Statement|$)",
        re.S,
    )
    for m in pattern.finditer(text):
        body = re.sub(r"\s+", " ", m.group("body")).strip()
        amounts = re.findall(r"\$?([\d,]+\.\d{2})", body)
        debit = credit = balance = None
        if len(amounts) >= 3:
            debit, credit, balance = (
                money(amounts[-3]),
                money(amounts[-2]),
                money(amounts[-1]),
            )
        elif len(amounts) == 2:
            debit, credit = money(amounts[0]), money(amounts[1])
        elif len(amounts) == 1:
            debit = money(amounts[0])
        # strip trailing amounts from description
        desc = re.sub(r"(\$?[\d,]+\.\d{2}\s*)+$", "", body).strip(" -:")
        sym_m = re.match(r"([A-Z]{1,6})\b", desc)
        txs.append(
            Transaction(
                date=m.group("date"),
                code=m.group("code"),
                description=desc[:500],
                debit=debit,
                credit=credit,
                balance=balance,
                symbol=sym_m.group(1) if sym_m else None,
            )
        )
    return txs


def _transfers_from_activity(
    txs: list[Transaction], fx: float | None, currency: str
) -> tuple[float, float]:
    rate = fx if fx and fx > 0 else 1.0
    tin = tout = 0.0
    for tx in txs:
        code = (tx.code or "").upper()
        amt = 0.0
        if tx.credit and tx.credit > 0:
            amt = tx.credit
        elif tx.debit and tx.debit > 0:
            amt = tx.debit
        if currency == "USD":
            amt *= rate
        if code in {"TRFIN", "TRFINTF", "WIREINTF", "WIREIN"}:
            tin += amt
        elif code in {"TRFOUT", "TRFOUTTF"}:
            tout += amt
    return tin, tout


def extract_wealthsimple_pdf(path: str | Path) -> StatementExtract:
    path = Path(path)
    text = parse_pdf_text(path)
    if not text.strip():
        raise ValueError("Empty PDF text")

    account_number = _parse_account_number(text, path.name)
    period_id, label, start, end = _parse_period(text, path.name)
    acct_type, type_label = _parse_account_type(text)
    currency = _statement_currency(text, account_number)
    fx = _fx_rate(text)
    if currency == "USD" and fx is None:
        # fallback: use 1.0 and flag (merge may refine using CAD sibling FX)
        fx = None

    mv, book = _total_portfolio(text)
    if mv is None:
        raise ValueError("Total Portfolio not found")

    cash = _closing_cash(text)

    dep_c, dep_u = _cash_flow_field(text, r"Deposits")
    wd_c, wd_u = _cash_flow_field(text, r"Withdrawals")
    div_c, div_u = _cash_flow_field(text, r"Dividends")
    # older: Interest ; newer: Interest Earned
    int_c, int_u = _cash_flow_field(text, r"Interest(?:\s+Earned)?")
    fee_c, fee_u = _cash_flow_field(text, r"Fees")
    tax_c, tax_u = _cash_flow_field(text, r"Taxes")
    lend_c, lend_u = _cash_flow_field(text, r"Stock\s+Lending\s+Income")

    notes: list[str] = []
    conf_note: str | None = None

    if currency == "CAD":
        # Dual-column CAD statements: convert any USD cash-flow column with statement FX
        cad_fx = fx if is_plausible_usd_to_cad(fx) else 1.0
        if fx is not None and not is_plausible_usd_to_cad(fx):
            notes.append(f"implausible_cad_statement_fx_ignored:{fx}")
        deposits = _to_cad(dep_c, dep_u, currency, cad_fx)
        withdrawals = _to_cad(wd_c, wd_u, currency, cad_fx)
        dividends = _to_cad(div_c, div_u, currency, cad_fx)
        interest = _to_cad(int_c, int_u, currency, cad_fx)
        fees = _to_cad(fee_c, fee_u, currency, cad_fx)
        taxes = _to_cad(tax_c, tax_u, currency, cad_fx)
        lending = _to_cad(lend_c, lend_u, currency, cad_fx)
        mv_cad = mv
        cash_cad = cash
        book_cad = book
        transfer_fx = 1.0
    else:
        # USD statement: market values are USD; convert with CAD-per-USD rate
        if is_plausible_usd_to_cad(fx):
            r = float(fx)
        else:
            r = 1.0
            conf_note = "missing_fx_rate_usd_assumed_1"
            if fx is not None:
                notes.append(f"implausible_usd_fx_ignored:{fx}")
        mv_cad = mv * r
        cash_cad = (cash * r) if cash is not None else None
        book_cad = (book * r) if book is not None else None
        deposits = dep_c * r
        withdrawals = wd_c * r
        dividends = div_c * r
        interest = int_c * r
        fees = fee_c * r
        taxes = tax_c * r
        lending = lend_c * r
        transfer_fx = r
        fx = r if is_plausible_usd_to_cad(fx) else None

    holdings = _parse_holdings(text)
    txs = _parse_activity(text)
    tin, tout = _transfers_from_activity(txs, transfer_fx, currency)

    # Contributions (CONT) often appear as activity; add to deposits if not already in deposits
    cont = 0.0
    for tx in txs:
        if (tx.code or "").upper() in {"CONT", "DEP"}:
            mult = transfer_fx if currency == "USD" else 1.0
            if tx.credit and tx.credit > 0:
                cont += tx.credit * mult
            elif tx.debit and tx.debit > 0 and (tx.code or "").upper() == "CONT":
                cont += tx.debit * mult
    # Prefer statement summary deposits; if zero but CONT/DEP in ledger, use ledger external credits
    if deposits == 0 and cont > 0:
        deposits = cont

    if conf_note:
        notes.append(conf_note)
    confidence = "high"
    if conf_note or any(n.startswith("implausible_") for n in notes):
        confidence = "medium"
    if mv == 0 and deposits == 0 and withdrawals == 0 and currency == "USD":
        # empty USD sleeve still fine even without FX
        confidence = "high"
        notes = [n for n in notes if n != "missing_fx_rate_usd_assumed_1"]

    return StatementExtract(
        source_path=str(path),
        institution="Wealthsimple",
        account_number=account_number,
        account_type=acct_type,
        statement_currency=currency,
        period_id=period_id,
        label=label,
        start_date=start,
        end_date=end,
        market_value=mv,
        market_value_cad=mv_cad,
        cash=cash_cad if currency == "CAD" else cash_cad,
        book_cost=book_cad,
        deposits=round(deposits, 2),
        withdrawals=round(withdrawals, 2),
        dividends=round(dividends, 2),
        interest=round(interest, 2),
        fees=round(fees + taxes, 2),
        taxes=round(taxes, 2),
        stock_lending_income=round(lending, 2),
        transfers_in=round(tin, 2),
        transfers_out=round(tout, 2),
        fx_rate=fx,
        holdings=holdings,
        transactions=txs,
        raw_account_type_label=type_label,
        confidence=confidence,
        notes=notes,
        extras={
            "taxes": round(taxes, 2),
            "stockLendingIncome": round(lending, 2),
        },
    )
