"""
Retries for cloud AI calls. Overload (503), rate limits (429), gateway errors and dropped connections are temporary:
the call is repeated with growing pauses before the job fails. Anything else (bad key, bad request) fails at once.
When retries run out, the error says in plain words what happened and what to do.
"""

import logging
import time
from collections.abc import Callable

import httpx

logger = logging.getLogger(__name__)

TRANSIENT = {408, 429, 500, 502, 503, 504}
DELAYS = (2, 5, 10, 20, 30)  # seconds between attempts: ~1 minute in total


class ProviderHTTPError(RuntimeError):
    """A provider answered with an HTTP error (transports without their own exception types use it)."""

    def __init__(self, status: int, message: str):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.detail = message


class AIUnavailable(RuntimeError):
    """The provider stayed unavailable after every retry; the message is for the user."""


def status_of(exc: BaseException) -> int | None:
    """HTTP status of a provider error, 0 for network failures, None for everything else."""
    if isinstance(exc, ProviderHTTPError):
        return exc.status
    code = getattr(exc, "code", None)  # google.genai.errors.APIError
    if isinstance(code, int) and exc.__class__.__module__.startswith("google"):
        return code
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError)):
        return 0
    return None


def _explain(provider: str, status: int, attempts: int) -> str:
    if status == 503:
        what = f"{provider} перегружен (503)"
    elif status == 429:
        what = f"{provider}: превышен лимит запросов или квота ключа (429)"
    elif status == 0:
        what = f"Нет связи с {provider}"
    else:
        what = f"{provider} временно не отвечает ({status})"
    return (
        f"{what} — не помогли {attempts} попыток за ~{sum(DELAYS[: attempts - 1])} с. Это на стороне сервиса, не приложения. "
        "Повторите позже или выберите другую модель (для транскрибации — Whisper, он работает локально)."
    )


def with_retry[T](
    fn: Callable[[], T],
    provider: str,
    check_cancelled: Callable[[], None] = lambda: None,
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    attempts = len(DELAYS) + 1
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as e:
            status = status_of(e)
            if status is None or (status and status not in TRANSIENT):
                raise
            if attempt == attempts:
                raise AIUnavailable(_explain(provider, status, attempts)) from e
            delay = DELAYS[attempt - 1]
            logger.warning("%s: %s, retry %d/%d in %ds", provider, status or "network error", attempt, attempts - 1, delay)
            for _ in range(int(delay * 2)):  # stay cancellable while waiting
                check_cancelled()
                sleep(0.5)
    raise AssertionError("unreachable")
