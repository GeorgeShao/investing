"""
Parser registry — map config `parser` keys to extract functions.

Adding a brokerage:
  1. Implement `extract_<broker>_pdf(path) -> StatementExtract` in a new module.
  2. Register it below (or via register_parser()).
  3. Add a brokers[] entry in config/config.example.json (or config.local.json)
     with folder + parser id. No changes to merge/dashboard core required.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from .common import StatementExtract
from .questrade import extract_questrade_pdf
from .wealthsimple import extract_wealthsimple_pdf

ParserFn = Callable[[str | Path], StatementExtract]

_REGISTRY: dict[str, ParserFn] = {}


def register_parser(name: str, fn: ParserFn) -> None:
    """Register or replace a parser by config key (case-insensitive)."""
    _REGISTRY[name.lower().strip()] = fn


def get_parser(name: str) -> ParserFn:
    key = name.lower().strip()
    if key not in _REGISTRY:
        known = ", ".join(sorted(_REGISTRY)) or "(none)"
        raise KeyError(f"Unknown parser '{name}'. Registered: {known}")
    return _REGISTRY[key]


def list_parsers() -> list[str]:
    return sorted(_REGISTRY)


# Built-in investment brokerage parsers
register_parser("questrade", extract_questrade_pdf)
register_parser("wealthsimple", extract_wealthsimple_pdf)
# Common aliases
register_parser("qt", extract_questrade_pdf)
register_parser("ws", extract_wealthsimple_pdf)
