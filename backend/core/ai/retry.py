"""
Retries for cloud AI calls. Overload (503), rate limits (429), gateway errors and dropped connections are temporary:
the call is repeated with growing pauses before the job fails. Anything else (bad key, bad request) fails at once.
When retries run out, the error says in plain words what happened and what to do.
"""

import logging
import time
from collections.abc import Callable, Iterator

import httpx

from backend.i18n import tr

logger = logging.getLogger(__name__)

TRANSIENT = {408, 429, 500, 502, 503, 504, 529}  # 529: Anthropic overloaded
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
    if status in (503, 529):
        what = tr("retry.overloaded", provider=provider, status=status)
    elif status == 429:
        what = tr("retry.rate_limited", provider=provider)
    elif status == 0:
        what = tr("retry.offline", provider=provider)
    else:
        what = tr("retry.unavailable", provider=provider, status=status)
    return tr("retry.gave_up", what=what, attempts=attempts, seconds=sum(DELAYS[: attempts - 1]))


def with_retry[T](
    fn: Callable[[], T],
    provider: str,
    check_cancelled: Callable[[], None] = lambda: None,
    sleep: Callable[[float], None] | None = None,
) -> T:
    pause = sleep or time.sleep  # looked up per call (a default argument would freeze it at import)
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
                pause(0.5)
    raise AssertionError("unreachable")


def stream_with_retry(make: Callable[[], Iterator[str]], provider: str) -> Iterator[str]:
    """A streamed answer, retried like with_retry until its first piece arrives (a refused or dropped request);
    once text has been shown, an error ends the answer instead of starting it over."""

    def first() -> tuple[Iterator[str], str | None]:
        it = make()
        return it, next(it, None)

    it, head = with_retry(first, provider)
    if head is None:
        return
    yield head
    yield from it
