"""
A local model: Ollama or LM Studio (or any OpenAI-compatible server) on this computer. No key, nothing leaves the machine.

  Ollama      http://127.0.0.1:11434/v1   chat goes through its own /api/chat: only there can the request set the context
                                          window (options.num_ctx); its OpenAI endpoint keeps the server default (a few
                                          thousand tokens) and cuts longer prompts silently
  LM Studio   http://127.0.0.1:1234/v1    OpenAI /v1/chat/completions; the window is the one the model was loaded with

Models come from /api/tags (Ollama) or /v1/models; the context length a model supports from /api/show (Ollama) or
/api/v0/models (LM Studio), where the server tells it. A server that does not answer fails at once, with no retries.
"""

import re
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from backend.core.ai.base import BaseAIProvider
from backend.core.ai.retry import AIUnavailable, ProviderHTTPError, with_retry
from backend.i18n import tr

DEFAULT_URL = "http://127.0.0.1:11434/v1"
_THINK = re.compile(r"<think>.*?</think>\s*", re.S)  # reasoning models (qwen3, deepseek-r1) think out loud first
_CHECK_TIMEOUT = httpx.Timeout(5.0, connect=3.0)
_CHAT_TIMEOUT = httpx.Timeout(1800.0, connect=5.0)  # a local model on a laptop can take minutes for a long part


class LocalModel(BaseModel):
    id: str
    context_tokens: int | None = None  # the most the model supports, when the server says


class LocalServer(BaseModel):
    ok: bool
    kind: Literal["ollama", "openai", ""] = ""
    base_url: str
    models: list[LocalModel] = []
    error: str = ""


def root(base_url: str) -> str:
    """http://host:port without /v1."""
    return re.sub(r"/v1/?$", "", base_url.strip().rstrip("/"))


def _down(base_url: str) -> AIUnavailable:
    return AIUnavailable(tr("ai.local_down", url=base_url))


def _is_ollama(client: httpx.Client, base: str) -> bool:
    try:
        r = client.get(f"{base}/api/version")
        return r.status_code == 200 and "version" in r.json()
    except (httpx.HTTPError, ValueError):
        return False


def inspect(base_url: str) -> LocalServer:
    """What is running at base_url: Ollama or another OpenAI-compatible server, and its models. Never raises."""
    url = base_url.strip().rstrip("/") or DEFAULT_URL
    base = root(url)
    try:
        with httpx.Client(timeout=_CHECK_TIMEOUT) as client:
            if _is_ollama(client, base):
                names = [m["name"] for m in client.get(f"{base}/api/tags").raise_for_status().json().get("models", [])]
                models = [LocalModel(id=n, context_tokens=_ollama_context(client, base, n)) for n in names]
                return LocalServer(ok=True, kind="ollama", base_url=url, models=models)
            ids = [m["id"] for m in client.get(f"{url}/models").raise_for_status().json().get("data", [])]
            limits = _lmstudio_contexts(client, base)
            return LocalServer(ok=True, kind="openai", base_url=url, models=[LocalModel(id=i, context_tokens=limits.get(i)) for i in ids])
    except httpx.ConnectError:
        return LocalServer(ok=False, base_url=url, error=tr("ai.local_down", url=url))
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
        return LocalServer(ok=False, base_url=url, error=tr("ai.local_bad_server", url=url, error=str(e)[:200]))


def _ollama_context(client: httpx.Client, base: str, model: str) -> int | None:
    try:
        info = client.post(f"{base}/api/show", json={"model": model}).json().get("model_info", {})
        return next((int(v) for k, v in info.items() if k.endswith(".context_length")), None)
    except (httpx.HTTPError, ValueError, TypeError):
        return None


def _lmstudio_contexts(client: httpx.Client, base: str) -> dict[str, int]:
    try:
        data = client.get(f"{base}/api/v0/models").json().get("data", [])
        return {m["id"]: int(m["max_context_length"]) for m in data if m.get("max_context_length")}
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return {}


class LocalProvider(BaseAIProvider):
    category = "local"
    default_model = ""
    supported_models: list[str] = []  # whatever the server has: inspect()
    max_context_tokens = 1_048_576  # the model's own limit is shown in Settings; the server enforces it
    default_context_tokens = 8_000

    def __init__(self, api_key: str = "", model: str | None = None, base_url: str = DEFAULT_URL, context_tokens: int = 8_000, thinking: bool = False):
        if not model:
            raise ValueError(tr("ai.local_no_model"))
        self.api_key = ""
        self.model = model
        self.base_url = base_url.strip().rstrip("/") or DEFAULT_URL
        self.context_tokens = context_tokens
        # reasoning models think before answering unless told not to: Ollama "think": false, LM Studio and other
        # OpenAI-style servers "reasoning_effort": "none" (measured: 12 s -> 0.2 s on a short question). A server that
        # does not know the field and refuses it is asked again without it.
        self.thinking = thinking
        self._ollama: bool | None = None

    def audit_window_tokens(self) -> int | None:
        return self.context_tokens

    def _complete(self, messages: list[dict[str, str]], temperature: float) -> str:
        base = root(self.base_url)

        def call() -> str:
            try:
                with httpx.Client(timeout=_CHAT_TIMEOUT) as client:
                    if self._ollama is None:
                        self._ollama = _is_ollama(client, base)
                    if self._ollama:
                        url = f"{base}/api/chat"
                        payload: dict[str, Any] = {
                            "model": self.model, "messages": messages, "stream": False,
                            "options": {"temperature": temperature, "num_ctx": self.context_tokens},
                        }
                        quiet = {"think": False}
                    else:
                        url = f"{self.base_url}/chat/completions"
                        payload = {"model": self.model, "messages": messages, "temperature": temperature}
                        quiet = {"reasoning_effort": "none"}
                    resp = client.post(url, json=payload if self.thinking else {**payload, **quiet})
                    if not self.thinking and resp.status_code == 400:
                        resp = client.post(url, json=payload)  # this model or server does not take the switch
            except httpx.ConnectError as e:
                raise _down(self.base_url) from e
            if resp.status_code >= 400:
                raise ProviderHTTPError(resp.status_code, tr("ai.local_error", model=self.model, error=resp.text[:300]))
            data = resp.json()
            text = data["message"]["content"] if self._ollama else data["choices"][0]["message"]["content"]
            return _THINK.sub("", text or "").strip()

        return with_retry(call, tr("ai.local_name"))

    def generate_text(self, prompt: str, system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
        return self._complete(msgs, temperature)

    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        msgs = ([{"role": "system", "content": system}] if system else []) + messages
        return self._complete(msgs, temperature)
