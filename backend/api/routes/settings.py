"""
Settings: paths, AI keys/models, processing defaults, interface.
"""

from fastapi import APIRouter, HTTPException

from backend.core.ai import AI, ProviderInfo
from backend.core.ai.prompts import BLOCKS
from backend.services.jobs import JobRegistry
from backend.settings import SettingsService
from backend.settings.schema import (
    DataDirChange,
    KeyTestRequest,
    KeyTestResult,
    PathCheckRequest,
    PathCheckResult,
    PromptUpdate,
    PromptView,
    SettingsPatch,
    SettingsView,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsView)
def get_settings() -> SettingsView:
    return SettingsService.view()


@router.patch("", response_model=SettingsView)
def patch_settings(patch: SettingsPatch) -> SettingsView:
    SettingsService.patch(patch)
    return SettingsService.view()


@router.get("/providers", response_model=dict[str, ProviderInfo])
def providers() -> dict[str, ProviderInfo]:
    return AI.providers()


@router.get("/prompts", response_model=list[PromptView])
def list_prompts() -> list[PromptView]:
    overrides = SettingsService.get().prompts
    return [
        PromptView(
            key=b.key, group=b.group, title=b.title, hint=b.hint, default=b.default,
            value=overrides.get(b.key) or b.default, modified=bool(overrides.get(b.key)),
        )
        for b in BLOCKS.values()
    ]


@router.put("/prompts/{key}", response_model=list[PromptView])
def update_prompt(key: str, req: PromptUpdate) -> list[PromptView]:
    if key not in BLOCKS:
        raise HTTPException(404, detail="Неизвестный блок инструкций")
    same_as_default = req.value.strip() == BLOCKS[key].default.strip()
    SettingsService.set_prompt(key, None if same_as_default else req.value)
    return list_prompts()


@router.delete("/prompts/{key}", response_model=list[PromptView])
def reset_prompt(key: str) -> list[PromptView]:
    if key not in BLOCKS:
        raise HTTPException(404, detail="Неизвестный блок инструкций")
    SettingsService.set_prompt(key, None)
    return list_prompts()


@router.post("/test-key", response_model=KeyTestResult)
def test_key(req: KeyTestRequest) -> KeyTestResult:
    """One tiny completion to prove the key and model work."""
    model = getattr(SettingsService.get().ai, f"{req.provider}_model", "")
    try:
        provider = AI.get(req.provider)
        provider.generate_text("Ответь одним словом: ok", temperature=0.0)
        return KeyTestResult(ok=True, model=provider.model)
    except Exception as e:
        return KeyTestResult(ok=False, model=model, error=str(e)[:300])


@router.post("/check-path", response_model=PathCheckResult)
def check_path(req: PathCheckRequest) -> PathCheckResult:
    return SettingsService.check_path(req.path)


@router.post("/data-dir", response_model=SettingsView)
def change_data_dir(req: DataDirChange) -> SettingsView:
    if JobRegistry.busy_reasons():
        raise HTTPException(409, detail="Нельзя менять папку данных, пока идёт обработка, загрузка или экспорт")
    try:
        SettingsService.change_data_dir(req.path, move=req.mode == "move")
    except (ValueError, OSError) as e:
        raise HTTPException(400, detail=str(e)) from e
    from backend.services.migration import migrate_all
    from backend.services.storage import Library

    Library.import_untracked()
    migrate_all()
    return SettingsService.view()
