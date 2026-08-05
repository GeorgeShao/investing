"""Questrade monthly account statement parser."""

from __future__ import annotations

import re
from pathlib import Path

from .common import (
    Holding,
    StatementExtract,
    Transaction,
    map_account_type_label,
    money,
    month_bounds,
    parse_pdf_text,
    parse_questrade_usd_to_cad_fx,
)


def _account_number(text: str, path: Path) -> str:
    m = re.search(r"Account\s*#:\s*(\d+)", text, re.I)
    if m:
        return m.group(1)
    # folder names contain account ids
    m = re.search(r"(\d{8})", str(path))
    if m:
        return m.group(1)
    raise ValueError(f"Account number not found in {path}")


def _account_type(text: str) -> tuple[str, str]:
    m = re.search(r"Type:\s*(.+?)(?:\n|Account opened|Currency:)", text, re.S)
    label = "Unknown"
    if m:
        label = re.sub(r"\s+", " ", m.group(1)).strip()
        # strip trailing page junk
        label = label.split("Account opened")[0].strip()
    return map_account_type_label(label), label


def _period(text: str, path: Path) -> tuple[str, str, str, str]:
    # Current month: June 30, 2025  OR  Current month: March 28, 2024
    m = re.search(
        r"Current month:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})",
        text,
    )
    if m:
        month_name, _day, year = m.group(1), int(m.group(2)), int(m.group(3))
        months = {
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
        mo = months.get(month_name.lower())
        if mo:
            return month_bounds(year, mo)
    m = re.search(r"_(\d{4})-(\d{2})-\d{2}", path.name)
    if m:
        return month_bounds(int(m.group(1)), int(m.group(2)))
    raise ValueError(f"Period not found in {path}")


def _current_balance(text: str) -> float | None:
    m = re.search(
        r"Current month balance:\s*\$?([\d,]+\.\d{2})",
        text,
        re.I,
    )
    if m:
        return money(m.group(1))
    # Closing balance under Balance Changes CURRENT MONTH
    m = re.search(
        r"Closing balance\s+\$?([\d,]+\.\d{2}|\([\d,]+\.\d{2}\)|-)",
        text,
        re.I,
    )
    if m:
        return money(m.group(1)) or 0.0
    return None


def _fx_rate(text: str) -> float | None:
    """Return CAD per 1 USD from Questrade statement footers (never the bare $1.00)."""
    return parse_questrade_usd_to_cad_fx(text)


def _balance_changes_current_month(text: str) -> dict[str, float]:
    """
    Parse Balance Changes table CURRENT MONTH column.
    Layout (text extract order varies):
      Deposits
      3,013.54
      ...
    Or inline: Deposits 3,013.54 ...
    """
    result = {
        "deposits": 0.0,
        "withdrawals": 0.0,
        "change": 0.0,
        "opening": 0.0,
        "closing": 0.0,
    }
    # Narrow to Balance Changes section
    sec = text
    m = re.search(r"Balance Changes(.*?)(?:Investment return|02\.\s*PERFORMANCE|Allocation of)", text, re.S | re.I)
    if m:
        sec = m.group(1)

    def first_amount_after(label: str) -> float:
        # CURRENT MONTH is first numeric column after label
        pat = rf"{label}\s+(-|\$?[\d,]+\.\d{{2}}|\(\$?[\d,]+\.\d{{2}}\))"
        mm = re.search(pat, sec, re.I)
        if not mm:
            return 0.0
        v = money(mm.group(1))
        return abs(v) if v is not None and label.lower().startswith("withdraw") else (v or 0.0)

    result["opening"] = first_amount_after("Opening balance") or 0.0
    dep = first_amount_after("Deposits")
    result["deposits"] = abs(dep) if dep else 0.0
    wd = first_amount_after("Withdrawals")
    result["withdrawals"] = abs(wd) if wd else 0.0
    ch = first_amount_after("Change in balance")
    result["change"] = ch if ch is not None else 0.0
    cl = first_amount_after("Closing balance")
    result["closing"] = cl if cl is not None else 0.0
    return result


def _cash_and_book(text: str) -> tuple[float | None, float | None]:
    cash = None
    book = None
    m = re.search(
        r"Total Cash\s+\$?([\d,]+\.\d{2}|\([\d,]+\.\d{2}\)|-)",
        text,
        re.I,
    )
    if m:
        cash = money(m.group(1)) or 0.0
    m = re.search(
        r"Total Position\s*Cost\s+\$?([\d,]+\.\d{2}|\([\d,]+\.\d{2}\)|-)",
        text,
        re.I,
    )
    if m:
        book = money(m.group(1))
    # Total Market Value (securities only, often excludes cash)
    return cash, book


def _investment_income(text: str) -> tuple[float, float]:
    """Dividend and interest from Investment income section (current month first)."""
    div = int_ = 0.0
    sec_m = re.search(r"Investment income(.*?)(?:Transactions|04\.\s*ACTIVITY|Glossary)", text, re.S | re.I)
    sec = sec_m.group(1) if sec_m else text
    m = re.search(r"Dividend\s+(-|\$?[\d,]+\.\d{2})", sec, re.I)
    if m:
        div = money(m.group(1)) or 0.0
    m = re.search(r"Interest\s+(-|\$?[\d,]+\.\d{2})", sec, re.I)
    if m:
        int_ = money(m.group(1)) or 0.0
    return abs(div), abs(int_)


def _cash_changes_income(text: str) -> tuple[float, float, float]:
    """
    From Cash changes: Dividends, Interest, Commission/Fees current month.
    Returns dividends, interest, fees (absolute).
    """
    sec_m = re.search(r"Cash changes(.*?)(?:Investment income|Transactions|04\.)", text, re.S | re.I)
    sec = sec_m.group(1) if sec_m else ""
    def grab(label: str) -> float:
        # Combined in CAD is often the 3rd amount; take last money on line chunk
        m = re.search(
            rf"{label}\s+((?:-|\$?[\d,]+\.\d{{2}}|\(\$?[\d,]+\.\d{{2}}\)\s*)+)",
            sec,
            re.I,
        )
        if not m:
            return 0.0
        amounts = re.findall(r"\$?[\d,]+\.\d{2}|\(\$?[\d,]+\.\d{2}\)|(?<![\d])-(?![\d])", m.group(1))
        vals = [money(a) for a in amounts if money(a) is not None or a.strip() == "-"]
        vals = [v if v is not None else 0.0 for v in vals]
        if not vals:
            return 0.0
        # Prefer last (combined CAD) if multiple
        return abs(vals[-1])

    return grab("Dividends"), grab("Interest"), grab("Commission") + grab("Fees And Rebates")


def _money_weighted(text: str) -> float | None:
    m = re.search(
        r"Money-weighted total return[^\n]*\n\s*([-\d.,]+)",
        text,
        re.I,
    )
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            return None
    # Same line variant
    m = re.search(
        r"Money-weighted total return\s*[²2]?\s*([-\d.,]+)",
        text,
        re.I,
    )
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            return None
    return None


def _parse_holdings(text: str) -> list[Holding]:
    """
    Parse Questrade Investment Details position rows.

    Modern pypdf layout (multi-line name):
      Securities held in USD
      AMZN
      AMAZON.COM INC
      BK
      49.6610
      ...
      11,880.40

    Multi-line names (e.g. GLOBAL X ... CLASS ETF, INVESCO ... CAD UNIT) must
    not treat trailing words (CLASS, UNIT) as the ticker.
    """
    holdings: list[Holding] = []

    section_iter = re.finditer(
        r"Securities held in (?P<ccy>CAD|USD)\s+"
        r"(?P<body>.*?)(?="
        r"Securities held in (?:CAD|USD)|"
        r"04\.\s*ACTIVITY|"
        r"ACTIVITY DETAILS|"
        r"Cash changes|"
        r"Glossary|"
        r"$)",
        text,
        re.S | re.I,
    )

    # SYMBOL\n multi-line name \n BK|AVG \n qty \n segr \n cost/share \n pos \n price \n mv
    row = re.compile(
        r"(?P<symbol>[A-Z][A-Z0-9.\-]{0,11})\s*\n"
        r"(?P<name>(?:[A-Za-z0-9][^\n]*\n)+?)"
        r"(?:BK|AVG)\s*\n"
        r"(?P<qty>[\d.]+)\s*\n"
        r"(?P<segr>[\d.]+)\s*\n"
        r"(?P<costshare>[\d,]+\.\d{2})\s*\n"
        r"(?P<poscost>[\d,]+\.\d{2})\s*\n"
        r"(?P<mktprice>[\d,]+\.\d{2})\s*\n"
        r"(?P<mktval>[\d,]+\.\d{2})",
        re.M,
    )

    found_any = False
    for sec in section_iter:
        ccy = sec.group("ccy").upper()
        body = sec.group("body")
        for m in row.finditer(body):
            sym = m.group("symbol").strip()
            # Skip section chrome / page headers that look like symbols
            if sym in {"CAD", "USD", "BK", "AVG", "P", "L"} or len(sym) > 12:
                continue
            name = re.sub(r"\s+", " ", m.group("name")).strip()
            if not name or name.upper().startswith("SECURITIES"):
                continue
            qty = float(m.group("qty"))
            holdings.append(
                Holding(
                    symbol=sym,
                    name=name,
                    quantity=qty,
                    market_price=money(m.group("mktprice")),
                    market_value=money(m.group("mktval")),
                    book_cost=money(m.group("poscost")),
                    currency=ccy,
                )
            )
            found_any = True

    if found_any:
        return holdings

    # Fallback: older single-line extracts
    legacy = re.compile(
        r"\b(?P<symbol>[A-Z]{1,6})\s+"
        r"(?P<name>[A-Z][A-Z0-9 .,&'\-/]{2,60}?)\s+"
        r"(?:BK|AVG)\s+"
        r"(?P<qty>[\d.]+)\s+"
        r"(?P<segr>[\d.]+)\s+"
        r"(?P<costshare>[\d,]+\.\d{2})\s+"
        r"(?P<poscost>[\d,]+\.\d{2})\s+"
        r"(?P<mktprice>[\d,]+\.\d{2})\s+"
        r"(?P<mktval>[\d,]+\.\d{2})\s+"
        r"(?P<pl>-?[\d,]+\.\d{2})",
        re.M,
    )
    for m in legacy.finditer(text):
        sym = m.group("symbol")
        name = m.group("name").strip()
        # Reject mid-name false positives (CLASS ETF, CAD UNIT)
        if sym in {"CLASS", "CAD", "UNIT", "IDX", "ETF"} or name in {
            "ETF",
            "UNIT",
            "CLASS ETF",
        }:
            continue
        currency = (
            "USD"
            if "Securities held in USD"
            in text[max(0, m.start() - 200) : m.start() + 50]
            else None
        )
        holdings.append(
            Holding(
                symbol=sym,
                name=name,
                quantity=float(m.group("qty")),
                market_price=money(m.group("mktprice")),
                market_value=money(m.group("mktval")),
                book_cost=money(m.group("poscost")),
                currency=currency,
            )
        )
    return holdings


def _parse_transactions(text: str) -> list[Transaction]:
    txs: list[Transaction] = []
    sec_m = re.search(r"Transactions(.*?)(?:Glossary|For your information|07\.)", text, re.S | re.I)
    if not sec_m:
        return txs
    sec = sec_m.group(1)
    # Date-like lines with activity type
    for m in re.finditer(
        r"(\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})?\s*"
        r"(Buy|Sell|Deposit|Withdrawal|DIV|INT|FX|Transfer|Contribution|EFT)[^\n]{0,200}",
        sec,
        re.I,
    ):
        line = re.sub(r"\s+", " ", m.group(0)).strip()
        amounts = re.findall(r"\$?([\d,]+\.\d{2})", line)
        txs.append(
            Transaction(
                date=m.group(1),
                code=m.group(2),
                description=line[:400],
                net=money(amounts[-1]) if amounts else None,
            )
        )
    return txs


def extract_questrade_pdf(path: str | Path) -> StatementExtract:
    path = Path(path)
    text = parse_pdf_text(path)
    if not text.strip():
        raise ValueError("Empty PDF text")

    account_number = _account_number(text, path)
    acct_type, type_label = _account_type(text)
    period_id, label, start, end = _period(text, path)
    fx = _fx_rate(text)

    mv = _current_balance(text)
    if mv is None:
        raise ValueError("Current month balance not found")

    changes = _balance_changes_current_month(text)
    cash, book = _cash_and_book(text)
    div_inc, int_inc = _investment_income(text)
    div_cc, int_cc, fees_cc = _cash_changes_income(text)
    dividends = div_inc or div_cc
    interest = int_inc or int_cc
    fees = fees_cc

    mw = _money_weighted(text)
    holdings = _parse_holdings(text)
    txs = _parse_transactions(text)

    deposits = changes["deposits"]
    withdrawals = changes["withdrawals"]
    # Questrade Balance Changes deposits/withdrawals include transfers; we cannot always split.
    # Store full amounts as deposits/withdrawals; transfers stay 0 unless activity codes exist.
    transfers_in = 0.0
    transfers_out = 0.0
    for tx in txs:
        code = (tx.code or "").lower()
        if "transfer" in code and tx.net:
            if tx.net > 0:
                transfers_in += abs(tx.net)
            else:
                transfers_out += abs(tx.net)

    notes: list[str] = []
    if deposits or withdrawals:
        notes.append(
            "questrade_balance_changes_deposits_withdrawals_may_include_transfers"
        )

    return StatementExtract(
        source_path=str(path),
        institution="Questrade",
        account_number=account_number,
        account_type=acct_type,
        statement_currency="CAD",
        period_id=period_id,
        label=label,
        start_date=start,
        end_date=end,
        market_value=mv,
        market_value_cad=mv,
        cash=cash,
        book_cost=book,
        deposits=round(deposits, 2),
        withdrawals=round(withdrawals, 2),
        dividends=round(dividends, 2),
        interest=round(interest, 2),
        fees=round(fees, 2),
        transfers_in=round(transfers_in, 2),
        transfers_out=round(transfers_out, 2),
        fx_rate=fx,
        money_weighted_return_pct=mw,
        balance_change=changes.get("change"),
        holdings=holdings,
        transactions=txs,
        raw_account_type_label=type_label,
        confidence="high",
        notes=notes,
        extras={
            "openingBalance": changes.get("opening"),
            "closingBalance": changes.get("closing") or mv,
            "moneyWeightedReturnPct": mw,
        },
    )
