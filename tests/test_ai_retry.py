"""
Temporary provider failures are retried; permanent ones fail at once; exhausted retries explain themselves.
"""

import httpx
import pytest
from google.genai import errors

from backend.core.ai.retry import DELAYS, AIUnavailable, ProviderHTTPError, with_retry

OVERLOADED = {"error": {"code": 503, "message": "The model is overloaded. Please try again later.", "status": "UNAVAILABLE"}}


def flaky(failures):
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        if calls["n"] <= len(failures):
            raise failures[calls["n"] - 1]
        return "ok"

    return fn, calls


def test_gemini_overload_is_retried_until_it_answers():
    fn, calls = flaky([errors.ServerError(503, OVERLOADED), errors.ServerError(503, OVERLOADED)])
    assert with_retry(fn, "Gemini", sleep=lambda s: None) == "ok" and calls["n"] == 3


def test_rate_limit_and_network_errors_are_temporary():
    fn, calls = flaky([ProviderHTTPError(429, "slow down"), httpx.ConnectError("reset")])
    assert with_retry(fn, "DeepSeek", sleep=lambda s: None) == "ok" and calls["n"] == 3


def test_bad_request_fails_at_once():
    fn, calls = flaky([ProviderHTTPError(401, "bad key")])
    with pytest.raises(ProviderHTTPError):
        with_retry(fn, "DeepSeek", sleep=lambda s: None)
    assert calls["n"] == 1


def test_exhausted_retries_explain_in_plain_words():
    fn, calls = flaky([errors.ServerError(503, OVERLOADED)] * 10)
    with pytest.raises(AIUnavailable) as e:
        with_retry(fn, "Gemini", sleep=lambda s: None)
    assert calls["n"] == len(DELAYS) + 1
    assert "Gemini перегружен (503)" in str(e.value) and "Whisper" in str(e.value) and "{'error'" not in str(e.value)


def test_waiting_stays_cancellable():
    class Cancelled(Exception):
        pass

    def cancel():
        raise Cancelled

    fn, _ = flaky([errors.ServerError(503, OVERLOADED)])
    with pytest.raises(Cancelled):
        with_retry(fn, "Gemini", check_cancelled=cancel, sleep=lambda s: None)
