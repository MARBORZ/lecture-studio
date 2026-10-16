"""
AI facade: resolves provider + key + model from settings in one place.
"""


from pydantic import BaseModel

import backend.core.ai.providers.anthropic  # noqa: F401,E402
import backend.core.ai.providers.deepseek  # noqa: F401,E402
import backend.core.ai.providers.gemini  # noqa: F401,E402
import backend.core.ai.providers.local  # noqa: F401,E402
import backend.core.ai.providers.openai  # noqa: F401,E402
from backend.core.ai.base import CHARS_PER_TOKEN, MIN_CONTEXT_TOKENS, BaseAIProvider
from backend.core.ai.meta import AIMeta

# Import providers so AIMeta registers them.
from backend.i18n import tr
from backend.settings import SettingsService


class ProviderInfo(BaseModel):
    category: str
    default_model: str
    supported_models: list[str]
    can_transcribe_audio: bool
    configured: bool
    min_context_tokens: int
    max_context_tokens: int
    default_context_tokens: int
    chars_per_token: int


class AI:
    @staticmethod
    def get(category: str, model: str | None = None, api_key: str | None = None) -> BaseAIProvider:
        cls = AIMeta.get_provider_class(category)
        if not cls:
            raise ValueError(tr("ai.unknown_provider", provider=category))
        ai = SettingsService.get().ai
        model = model or getattr(ai, f"{category}_model", None) or cls.default_model
        if category == "local":  # no key: an address and the window the requests are sized for
            return cls(model=model, base_url=ai.local_base_url, context_tokens=AI.context_tokens("local"))
        return cls(api_key=api_key or SettingsService.api_key(category), model=model)

    @staticmethod
    def configured(category: str) -> bool:
        """Ready to be asked: a key for a cloud provider, a chosen model for the local one."""
        if category == "local":
            return bool(SettingsService.get().ai.local_model)
        return bool(SettingsService.api_key(category))

    @staticmethod
    def not_configured(category: str) -> str:
        """What to tell the user when configured() is False."""
        return tr("ai.local_no_model") if category == "local" else tr("ai.no_key", provider=category)

    @staticmethod
    def models(category: str, cls: type[BaseAIProvider]) -> list[str]:
        """The models offered in Settings: ChatGPT's come from the account (/v1/models), the rest are fixed lists."""
        if category == "openai" and (key := SettingsService.api_key("openai")):
            from backend.core.ai.providers.openai import list_models

            return list_models(key)
        return cls.supported_models

    @staticmethod
    def providers() -> dict[str, ProviderInfo]:
        return {
            cat: ProviderInfo(
                category=cat,
                default_model=cls.default_model,
                supported_models=AI.models(cat, cls),
                can_transcribe_audio=cls.can_transcribe_audio,
                configured=AI.configured(cat),
                min_context_tokens=MIN_CONTEXT_TOKENS,
                max_context_tokens=cls.max_context_tokens,
                default_context_tokens=cls.default_context_tokens,
                chars_per_token=CHARS_PER_TOKEN,
            )
            for cat, cls in AIMeta.get_all_providers().items()
        }

    @staticmethod
    def context_tokens(category: str) -> int:
        """The assistant's window for this provider: the setting, else the default; a hand-edited value is clamped."""
        cls = AIMeta.get_provider_class(category)
        if not cls:
            raise ValueError(tr("ai.unknown_provider", provider=category))
        tokens = SettingsService.get().ai.context_tokens.get(category, cls.default_context_tokens)
        return min(max(tokens, MIN_CONTEXT_TOKENS), cls.max_context_tokens)

    @staticmethod
    def check_context_tokens(values: dict[str, int | None]) -> None:
        """Settings patch: each window within MIN_CONTEXT_TOKENS..the model's limit (None = back to the default)."""
        for category, tokens in values.items():
            cls = AIMeta.get_provider_class(category)
            if not cls:
                raise ValueError(tr("ai.unknown_provider", provider=category))
            if tokens is not None and not MIN_CONTEXT_TOKENS <= tokens <= cls.max_context_tokens:
                low, high = (f"{v:,}".replace(",", " ") for v in (MIN_CONTEXT_TOKENS, cls.max_context_tokens))
                raise ValueError(tr("ai.window_range", provider=category, min=low, max=high))
