"""
AI facade: resolves provider + key + model from settings in one place.
"""


from pydantic import BaseModel

# Import providers so AIMeta registers them.
import backend.core.ai.providers.deepseek  # noqa: F401,E402
import backend.core.ai.providers.gemini  # noqa: F401,E402
from backend.core.ai.base import BaseAIProvider
from backend.core.ai.meta import AIMeta
from backend.settings import SettingsService


class ProviderInfo(BaseModel):
    category: str
    default_model: str
    supported_models: list[str]
    can_transcribe_audio: bool
    configured: bool


class AI:
    @staticmethod
    def get(category: str, model: str | None = None, api_key: str | None = None) -> BaseAIProvider:
        cls = AIMeta.get_provider_class(category)
        if not cls:
            raise ValueError(f"Неизвестный провайдер ИИ: {category}. Доступны: {AIMeta.list_categories()}")
        ai = SettingsService.get().ai
        model = model or getattr(ai, f"{category}_model", None) or cls.default_model
        return cls(api_key=api_key or SettingsService.api_key(category), model=model)

    @staticmethod
    def providers() -> dict[str, ProviderInfo]:
        return {
            cat: ProviderInfo(
                category=cat,
                default_model=cls.default_model,
                supported_models=cls.supported_models,
                can_transcribe_audio=cls.can_transcribe_audio,
                configured=bool(SettingsService.api_key(cat)),
            )
            for cat, cls in AIMeta.get_all_providers().items()
        }
