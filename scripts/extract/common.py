"""Shared PDF text helpers and extract record types."""

from __future__ import annotations

import calendar
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from pypdf import PdfReader


def parse_pdf_text(path: str | Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def money(value: str | None) -> float | None:
    """Parse currency like $1,234.56 or (1,234.56) or -."""
    if value is None:
        return None
    s = value.strip()
    if not s or s in {"-", "—", "–"}:
        return None
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg = True
        s = s[1:-1]
    s = s.replace("$", "").replace(",", "").replace("CAD", "").replace("USD", "").strip()
    if s in {"", "-"}:
        return None
    try:
        n = float(s)
    except ValueError:
        return None
    return -n if neg else n


def money_in_text(text: str, pattern: str, flags: int = re.I) -> float | None:
    m = re.search(pattern, text, flags)
    if not m:
        return None
    return money(m.group(1))


# Plausible CAD per 1 USD for modern CAD/USD (statement era ~2018–2030).
USD_TO_CAD_MIN = 1.10
USD_TO_CAD_MAX = 1.70


def is_plausible_usd_to_cad(rate: float | None) -> bool:
    return rate is not None and USD_TO_CAD_MIN <= rate <= USD_TO_CAD_MAX


def normalize_to_usd_to_cad(raw: float) -> float | None:
    """
    Normalize a printed FX quote to CAD-per-1-USD.

    Statements print either:
      - CAD per USD (e.g. 1.3643) — use as-is
      - USD per CAD (e.g. 0.7306 from `$1 CAD = $0.73 USD`, or mislabeled
        older `$1 USD = 0.78 CAD` that is actually USD-per-CAD) — invert
    """
    if raw <= 0:
        return None
    if is_plausible_usd_to_cad(raw):
        return raw
    inv = 1.0 / raw
    if is_plausible_usd_to_cad(inv):
        return inv
    return None


def parse_usd_to_cad_fx(text: str) -> float | None:
    """
    Extract USD→CAD from Wealthsimple / generic conversion footnotes.
    Prefers current month-end conversion sentences over prior-month rates;
    falls back to activity FX Rate.
    """
    flat = re.sub(r"[ \t]+", " ", text)

    def _from_match(raw: str) -> float | None:
        try:
            return normalize_to_usd_to_cad(float(raw))
        except ValueError:
            return None

    # 1) Month-end / market-value conversion footnotes (exclude Prior month)
    month_end: list[float] = []
    for m in re.finditer(
        r"((?:month-end|Closing Cash|Market Value|convert your).{0,140}?)"
        r"\$1\s*(?:CAD\s*=\s*\$?([0-9.]+)\s*USD|USD\s*=\s*\$?([0-9.]+)\s*CAD)",
        flat,
        re.I,
    ):
        if re.search(r"prior\s+month", m.group(1), re.I):
            continue
        n = _from_match(m.group(2) or m.group(3))
        if n:
            month_end.append(n)
    if month_end:
        return month_end[0]

    # 2) Any $1 CAD/$1 USD quote that is not prior-month
    other: list[float] = []
    for m in re.finditer(
        r"(.{0,60})\$1\s*CAD\s*=\s*\$?([0-9.]+)\s*USD",
        flat,
        re.I,
    ):
        if re.search(r"prior\s+month", m.group(1), re.I):
            continue
        n = _from_match(m.group(2))
        if n:
            other.append(n)
    for m in re.finditer(
        r"(.{0,60})\$1\s*USD\s*=\s*\$?([0-9.]+)\s*CAD",
        flat,
        re.I,
    ):
        if re.search(r"prior\s+month", m.group(1), re.I):
            continue
        n = _from_match(m.group(2))
        if n:
            other.append(n)
    if other:
        return other[0]

    # 3) Prior-month or any remaining quote
    for m in re.finditer(r"\$1\s*CAD\s*=\s*\$?([0-9.]+)\s*USD", flat, re.I):
        n = _from_match(m.group(1))
        if n:
            return n
    for m in re.finditer(r"\$1\s*USD\s*=\s*\$?([0-9.]+)\s*CAD", flat, re.I):
        n = _from_match(m.group(1))
        if n:
            return n

    # 4) Activity "FX Rate: 1.3709"
    activity: list[float] = []
    for m in re.finditer(r"FX\s*Rate:\s*([0-9.]+)", flat, re.I):
        n = _from_match(m.group(1))
        if n:
            activity.append(n)
    if not activity:
        return None
    activity.sort()
    return activity[len(activity) // 2]


def parse_questrade_usd_to_cad_fx(text: str) -> float | None:
    """
    Questrade page footers look like:
      Current month: $1.3627
      Previous month FX rate: $1.00 USD =
      CAD
      $1.3679
      Current month FX rate: $1.00 USD =
      CAD
    The value immediately after 'Current month:' (when near FX labels) is CAD/USD.
    Never treat the literal $1.00 from '$1.00 USD' as the rate.
    """
    flat = re.sub(r"\s+", " ", text)

    # Strong: "Current month: $1.3627 Previous month FX rate"
    m = re.search(
        r"Current month:\s*\$([0-9.]+)\s+Previous month FX rate",
        flat,
        re.I,
    )
    if m:
        n = normalize_to_usd_to_cad(float(m.group(1)))
        if n:
            return n

    # "Previous month FX rate: $1.00 USD = CAD $1.3679"
    m = re.search(
        r"Previous month FX rate:\s*\$1\.00\s*USD\s*=\s*CAD\s*\$([0-9.]+)",
        flat,
        re.I,
    )
    if m:
        n = normalize_to_usd_to_cad(float(m.group(1)))
        if n:
            # Prefer a current-month number if present just before Previous
            m2 = re.search(
                r"\$([0-9.]+)\s+Previous month FX rate:\s*\$1\.00\s*USD\s*=\s*CAD\s*\$([0-9.]+)",
                flat,
                re.I,
            )
            if m2:
                cur = normalize_to_usd_to_cad(float(m2.group(1)))
                if cur:
                    return cur
            return n

    # Collect only rates that appear as CAD-side after USD = CAD (not 1.00)
    rates: list[float] = []
    for m in re.finditer(
        r"USD\s*=\s*CAD\s*\$([0-9.]+)",
        flat,
        re.I,
    ):
        n = normalize_to_usd_to_cad(float(m.group(1)))
        if n:
            rates.append(n)
    if rates:
        return rates[-1]
    return None


def month_bounds(year: int, month: int) -> tuple[str, str, str, str]:
    """Return period_id, label, startDate, endDate."""
    last = calendar.monthrange(year, month)[1]
    period_id = f"{year:04d}-{month:02d}"
    label = f"{calendar.month_abbr[month]} {year}"
    return period_id, label, f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last:02d}"


def normalize_space(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text)


@dataclass
class Holding:
    symbol: str
    name: str | None = None
    quantity: float | None = None
    market_price: float | None = None
    market_value: float | None = None
    book_cost: float | None = None
    currency: str | None = None


@dataclass
class Transaction:
    date: str | None
    code: str | None
    description: str
    debit: float | None = None
    credit: float | None = None
    balance: float | None = None
    currency: str | None = None
    symbol: str | None = None
    quantity: float | None = None
    price: float | None = None
    commission: float | None = None
    net: float | None = None


@dataclass
class StatementExtract:
    """Normalized extract from a single monthly PDF."""

    source_path: str
    institution: str
    account_number: str
    account_type: str  # non_registered | tfsa | rrsp | fhsa | margin | other
    statement_currency: str  # CAD | USD
    period_id: str
    label: str
    start_date: str
    end_date: str
    market_value: float
    market_value_cad: float
    cash: float | None = None
    book_cost: float | None = None
    deposits: float = 0.0
    withdrawals: float = 0.0
    dividends: float = 0.0
    interest: float = 0.0
    fees: float = 0.0
    taxes: float = 0.0
    stock_lending_income: float = 0.0
    transfers_in: float = 0.0
    transfers_out: float = 0.0
    fx_rate: float | None = None  # USD->CAD if known
    money_weighted_return_pct: float | None = None
    balance_change: float | None = None
    holdings: list[Holding] = field(default_factory=list)
    transactions: list[Transaction] = field(default_factory=list)
    raw_account_type_label: str | None = None
    confidence: str = "high"
    notes: list[str] = field(default_factory=list)
    extras: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d


ACCOUNT_COLORS = [
    "#6366f1",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#06b6d4",
    "#ec4899",
    "#84cc16",
    "#14b8a6",
    "#f97316",
    "#a855f7",
    "#64748b",
]


def institution_slug(institution: str) -> str:
    """Map institution display name to a short stable slug for account ids."""
    t = institution.lower().strip()
    aliases = {
        "wealthsimple": "ws",
        "questrade": "qt",
        "interactive brokers": "ibkr",
        "ibkr": "ibkr",
        "td": "td",
        "rbc": "rbc",
        "sample broker": "sample",
    }
    if t in aliases:
        return aliases[t]
    for key, slug in aliases.items():
        if t.startswith(key) or key in t:
            return slug
    # Generic: first letters / alnum slug
    slug = "".join(c for c in t if c.isalnum())[:8] or "acct"
    return slug


def stable_account_id(
    institution: str,
    account_number: str,
    slug: str | None = None,
) -> str:
    """
    Stable account id: `{slug}-{account_number_lower}`.

    Prefer an explicit slug from config (broker id); otherwise derive from
    institution display name. Never hard-codes only qt/ws.
    """
    prefix = (slug or institution_slug(institution)).lower()
    return f"{prefix}-{account_number.lower()}"


def map_account_type_label(label: str) -> str:
    t = label.lower()
    # Check registered/tax-advantaged before generic "margin"
    if "tax-free" in t or "tfsa" in t:
        return "tfsa"
    if "first home" in t or "fhsa" in t:
        return "fhsa"
    if "rrsp" in t or "retirement" in t:
        return "rrsp"
    # Non-registered margin is still a non-registered taxable account
    if "non-registered" in t or "non registered" in t:
        return "non_registered"
    if "margin" in t:
        return "margin"
    if t.strip() in {"cash account", "sdi cash account"}:
        return "non_registered"
    return "other"
