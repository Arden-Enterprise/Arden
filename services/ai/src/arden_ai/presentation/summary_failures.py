"""Closed diagnostic categories; provider messages and exception repr never escape."""

from typing import Literal

from pydantic import ValidationError

from arden_ai.application.reader_summary import InvalidSummary

SummaryFailure = Literal[
    "TIMEOUT", "PROVIDER_BUSY", "PROVIDER_AUTH", "INVALID_OUTPUT", "UNAVAILABLE",
]


def summary_failure(error: BaseException) -> SummaryFailure:
    if isinstance(error, BaseExceptionGroup):
        codes = [summary_failure(item) for item in error.exceptions]
        for code in ("PROVIDER_AUTH", "PROVIDER_BUSY", "TIMEOUT", "UNAVAILABLE", "INVALID_OUTPUT"):
            if code in codes:
                return code
    if isinstance(error, TimeoutError):
        return "TIMEOUT"
    status = getattr(error, "status_code", None)
    if type(status) is int:
        if status in (401, 403):
            return "PROVIDER_AUTH"
        if status == 429:
            return "PROVIDER_BUSY"
    if isinstance(error, (InvalidSummary, ValidationError)):
        return "INVALID_OUTPUT"
    return "UNAVAILABLE"
