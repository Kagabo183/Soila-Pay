"""Datetimes leave the API with their UTC offset.

The database stores naive DATETIMEs in the server's local time - and the
production server runs on US Eastern time, 7 hours behind Kigali. Without an
offset the browser read "05:08" for a payment made at 12:08 in Kigali.
Attaching the server's offset lets every client show its own local time."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional


def iso(value: Optional[date]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        # Naive = server local time (MySQL CURRENT_TIMESTAMP / datetime.now()).
        return (value.astimezone() if value.tzinfo is None else value).isoformat()
    return value.isoformat()  # a plain date has no time zone
