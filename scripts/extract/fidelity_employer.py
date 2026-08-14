"""Fidelity Employer (NetBenefits workplace) statement parser.

All Fidelity Employer / NetBenefits plan accounts are USD-native.
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


def _slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:48] or "plan"


def _period(text: str, path: Path) -> tuple[str, str, str, str]:
    """
    Statement Period: 07/01/2026 to 07/31/2026
    """
    m = re.search(
        r"Statement\s+Period:\s*(\d{2})/(\d{2})/(\d{4})\s+to\s+(\d{2})/(\d{2})/(\d{4})",
        text,
        re.I,
    )
    if m:
        sm, sd, sy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        em, ed, ey = int(m.group(4)), int(m.group(5)), int(m.group(6))
        period_id, label, _, _ = month_bounds(ey, em)
        start = f"{sy:04d}-{sm:02d}-{sd:02d}"
        end = f"{ey:04d}-{em:02d}-{ed:02d}"
        return period_id, label, start, end
    # Fallback: filename month name
    m = re.search(
        r"(January|February|March|April|May|June|July|August|September|October|November|December)"
        r"\s+(\d{4})",
        path.name,
        re.I,
    )
    if m:
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
        mo = months[m.group(1).lower()]
        return month_bounds(int(m.group(2)), mo)
    raise ValueError(f"Statement Period not found in Fidelity Employer PDF {path}")


def _plan_identity(text: str, path: Path) -> tuple[str, str]:
    """
    Stable account number + display raw label.

    Prefer plan name from header (e.g. 'Tesla, Inc. 401(k) Plan').
    """
    m = re.search(
        r"([A-Za-z0-9][A-Za-z0-9,.'&\- ]{2,80}?)\s+401\s*\(\s*k\s*\)\s+Plan",
        text,
        re.I,
    )
    if m:
        plan_name = re.sub(r"\s+", " ", m.group(1)).strip(" ,")
        slug = _slugify(f"{plan_name}-401k")
        return slug, f"{plan_name} 401(k) Plan"
    m = re.search(
        r"([A-Za-z0-9][A-Za-z0-9,.'&\- ]{2,80}?)\s+Retirement\s+Savings\s+Statement",
        text,
        re.I,
    )
    if m:
        plan_name = re.sub(r"\s+", " ", m.group(1)).strip(" ,")
        slug = _slugify(plan_name)
        return slug, plan_name
    # Filename fallback
    base = path.stem
    return _slugify(base), base


def _ending_balance(text: str) -> float:
    m = re.search(r"Ending\s+Balance\s+\$?([\d,]+\.\d{2})", text, re.I)
    if m:
        v = money(m.group(1))
        if v is not None:
            return v
    raise ValueError("Ending Balance not found on NetBenefits statement")


def _brokeragelink_value(text: str) -> float:
    """
    Market value of the Brokeragelink sleeve inside the employer plan total.

    Appearances:
      Brokeragelink ... $3,959.62
      Ending Balance $3,959.62$617.84$4,577.46  (activity table)
    """
    # Explicit investment row
    m = re.search(
        r"Brokeragelink\s*[\d.,]*\s*[\d.,]*\s*\$?[\d.]*\s*\$?[\d.]*\s*\$?[\d.,]*\s*\$?([\d,]+\.\d{2})",
        text,
        re.I,
    )
    if m:
        v = money(m.group(1))
        if v is not None and v > 0:
            return v
    m = re.search(r"Brokeragelink[^\n$]{0,40}\$?([\d,]+\.\d{2})", text, re.I)
    if m:
        v = money(m.group(1))
        if v is not None:
            return abs(v)
    # Activity table Ending Balance column order: Brokeragelink, fund, Total
    m = re.search(
        r"Ending\s+Balance\s+\$?([\d,]+\.\d{2})\s*\$?([\d,]+\.\d{2})\s*\$?([\d,]+\.\d{2})",
        text,
        re.I,
    )
    if m:
        # First is Brokeragelink sleeve when present
        v = money(m.group(1))
        total = money(m.group(3))
        if v is not None and total is not None and v < total:
            return v
    return 0.0


def _contributions(text: str) -> tuple[float, float]:
    """
    Return (employee_contributions, employer_contributions) for the period.

    Account summary:
      Your Contributions $4,384.62
      Employer Contributions $173.08
    Contribution Summary table also has EmployeeDeferral / EmployerMatch.
    """
    employee = 0.0
    employer = 0.0
    m = re.search(r"Your\s+Contributions\s+\$?([\d,]+\.\d{2})", text, re.I)
    if m:
        employee = money(m.group(1)) or 0.0
    m = re.search(r"Employer\s+Contributions\s+\$?([\d,]+\.\d{2})", text, re.I)
    if m:
        employer = money(m.group(1)) or 0.0
    # Prefer contribution summary breakdown when summary total is zero
    if employee == 0.0:
        m = re.search(r"Employee\s*Deferral\s+\$?([\d,]+\.\d{2})", text, re.I)
        if m:
            employee = money(m.group(1)) or 0.0
        m = re.search(r"After-Tax\s+\$?([\d,]+\.\d{2})", text, re.I)
        if m:
            # After-tax is also employee money; summary "Your Contributions" already
            # includes both deferral + after-tax when present. Only add if employee
            # still zero.
            if employee == 0.0:
                employee = money(m.group(1)) or 0.0
    if employer == 0.0:
        m = re.search(r"Employer\s*Match\s+\$?([\d,]+\.\d{2})", text, re.I)
        if m:
            employer = money(m.group(1)) or 0.0
    return abs(employee), abs(employer)


def _plan_fund_holdings(text: str, exclude_brokeragelink: bool = True) -> list[Holding]:
    """Best-effort fund rows from Market Value of Your Account."""
    holdings: list[Holding] = []
    # Jammed NetBenefits export text, e.g.:
    #   SP 500 IndexPL CL C 0.000 1.727 $357.99$357.76 $0.00 $617.84
    row = re.compile(
        r"(SP\s*500\s*IndexPL\s*CL\s*C|S&P\s*500[^\n$]{0,40}?|"
        r"Fidelity[^\n$]{0,40}?|Vanguard[^\n$]{0,40}?)"
        r"\s*([\d,]+\.\d+)\s+([\d,]+\.\d+)\s*"
        r"\$?([\d,]+\.\d+)\s*\$?([\d,]+\.\d+)\s*"
        r"\$?([\d,]+\.\d{2})\s*\$?([\d,]+\.\d{2})",
        re.I,
    )
    for m in row.finditer(text):
        name = re.sub(r"\s+", " ", m.group(1)).strip()
        if exclude_brokeragelink and re.search(r"brokerage", name, re.I):
            continue
        mv = money(m.group(7))
        if mv is None or mv <= 0:
            continue
        qty = money(m.group(3))
        price = money(m.group(5))
        sym = re.sub(r"[^A-Za-z0-9]", "", name)[:12].upper() or "FUND"
        holdings.append(
            Holding(
                symbol=sym,
                name=name,
                quantity=qty,
                market_price=price,
                market_value=mv,
                currency="USD",
            )
        )
    if not exclude_brokeragelink:
        bl = _brokeragelink_value(text)
        if bl > 0:
            holdings.append(
                Holding(
                    symbol="BROKERAGELINK",
                    name="Brokeragelink",
                    quantity=None,
                    market_price=None,
                    market_value=bl,
                    currency="USD",
                )
            )
    return holdings


def extract_fidelity_employer_pdf(path: str | Path) -> StatementExtract:
    """
    Parse a NetBenefits retirement savings statement.

    Double-count rule: Employer Ending Balance includes the Brokeragelink
    sleeve that Fidelity Personal BrokerageLink INVESTMENT REPORTs also cover.
    We keep only non-BrokerageLink plan assets here (Ending Balance −
    Brokeragelink), and record the full ending balance + BL amount in extras.
    """
    path = Path(path)
    text = parse_pdf_text(path)
    if not text.strip():
        raise ValueError("Empty PDF text")
    if not re.search(
        r"NetBenefits|Retirement\s+Savings\s+Statement|Your\s+Account\s+Summary",
        text,
        re.I,
    ):
        raise ValueError(f"Not a Fidelity Employer / NetBenefits statement: {path.name}")

    account_number, plan_label = _plan_identity(text, path)
    period_id, label, start, end = _period(text, path)
    ending = _ending_balance(text)
    bl = _brokeragelink_value(text)
    # Avoid double-counting Personal BrokerageLink sleeves
    plan_only = round(ending - bl, 2)
    if plan_only < 0:
        plan_only = ending
        bl = 0.0

    employee, employer = _contributions(text)
    deposits = round(employee + employer, 2)
    holdings = _plan_fund_holdings(text, exclude_brokeragelink=True)

    notes = [
        "fidelity_employer_usd_native",
        "missing_fx_rate_usd_assumed_1",
    ]
    if bl > 0:
        notes.append(
            "employer_excludes_brokeragelink_sleeve_to_avoid_double_count_with_personal"
        )
        notes.append(f"brokeragelink_sleeve_usd:{bl:.2f}")
        notes.append(f"employer_full_ending_balance_usd:{ending:.2f}")

    return StatementExtract(
        source_path=str(path),
        institution="Fidelity Employer",
        account_number=account_number,
        account_type="rrsp",
        statement_currency="USD",
        period_id=period_id,
        label=label,
        start_date=start,
        end_date=end,
        market_value=plan_only,
        market_value_cad=plan_only,
        cash=None,
        book_cost=None,
        deposits=deposits,
        withdrawals=0.0,
        dividends=0.0,
        interest=0.0,
        fees=0.0,
        transfers_in=0.0,
        transfers_out=0.0,
        fx_rate=None,
        holdings=holdings,
        raw_account_type_label=plan_label,
        confidence="medium",
        notes=notes,
        extras={
            "form": "fidelity_netbenefits",
            "fullEndingBalanceUsd": ending,
            "brokeragelinkSleeveUsd": bl,
            "planOnlyBalanceUsd": plan_only,
            "employeeContributionsUsd": employee,
            "employerContributionsUsd": employer,
        },
    )
