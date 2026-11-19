"""Where a new transaction came from (API / portal / console / Test Lab /
import), who started it and from which IP - set by the API route, read by
PaymentRepo.create, so the service layer doesn't have to pass it around.

A ContextVar is per request: FastAPI runs each request in its own task, so
one request's origin can never leak into another's."""
from __future__ import annotations

from contextvars import ContextVar
from typing import Optional

API = "API"
PORTAL = "PORTAL"
CONSOLE = "CONSOLE"
TEST_LAB = "TEST_LAB"
IMPORT = "IMPORT"

_ORIGIN: ContextVar[Optional[dict]] = ContextVar("payment_origin", default=None)


def set_origin(source: str, actor: Optional[str], client_ip: Optional[str]) -> None:
    _ORIGIN.set({"source": source, "actor": (actor or "")[:191] or None, "client_ip": (client_ip or "")[:45] or None})


def current() -> dict:
    return _ORIGIN.get() or {}
