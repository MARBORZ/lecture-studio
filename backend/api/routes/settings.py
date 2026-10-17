"""
Settings: paths, AI keys/models, processing defaults, interface.
"""

from fastapi import APIRouter, HTTPException

from backend.core.ai import AI, ProviderInfo
from backend.core.ai.prompts import BLOCKS
from backend.core.ai.providers.local import LocalServer, inspect
from backend.i18n import tr
from backend.services.jobs import JobRegistry
from backend.settings import SettingsService, hotkeys
from backend.settings.schema import (
    ComputeStatus,
    DataDirChange,
    HotkeyCheck,
    HotkeyCheckRequest,
    KeyTestRequest,
    KeyTestResult,
    LocalCheckRequest,
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
    if patch.ai and patch.ai.context_tokens:
        try:
            AI.check_context_tokens(patch.ai.context_tokens)
        except ValueError as e:
            raise HTTPException(422, detail=str(e)) from e
    try:
        SettingsService.patch(patch)
    except hotkeys.HotkeyError as e:
        p = e.problem
        raise HTTPException(422, detail={"message": tr(f"hotkey.{p.code}"), "code": p.code, "action": p.action, "other": p.other}) from e
    return SettingsService.view()


@router.post("/hotkeys/check", response_model=HotkeyCheck)
def check_hotkey(req: HotkeyCheckRequest) -> HotkeyCheck:
    """While the user records a combination: can this action take it (format, three keys, reserved, conflicts)?"""
    problem = hotkeys.check(req.action, req.combo, SettingsService.get().hotkeys)
    combo = hotkeys.normalize(req.combo) or req.combo
    if problem:
        return HotkeyCheck(ok=False, combo=combo, problem=problem.code, other=problem.other)
    return HotkeyCheck(ok=True, combo=combo)


@router.get("/providers", response_model=dict[str, ProviderInfo])
def providers() -> dict[str, ProviderInfo]:
    return AI.providers()


@router.get("/prompts", response_model=list[PromptView])
def list_prompts() -> list[PromptView]:
    overrides = SettingsService.get().prompts
    return [
        PromptView(
            key=b.key, group=b.group, default=b.default,
            value=overrides.get(b.key) or b.default, modified=bool(overrides.get(b.key)),
        )
        for b in BLOCKS.values()
    ]


@router.put("/prompts/{key}", response_model=list[PromptView])
def update_prompt(key: str, req: PromptUpdate) -> list[PromptView]:
    if key not in BLOCKS:
        raise HTTPException(404, detail=tr("settings.unknown_prompt"))
    same_as_default = req.value.strip() == BLOCKS[key].default.strip()
    SettingsService.set_prompt(key, None if same_as_default else req.value)
    return list_prompts()


@router.delete("/prompts/{key}", response_model=list[PromptView])
def reset_prompt(key: str) -> list[PromptView]:
    if key not in BLOCKS:
        raise HTTPException(404, detail=tr("settings.unknown_prompt"))
    SettingsService.set_prompt(key, None)
    return list_prompts()


@router.post("/test-key", response_model=KeyTestResult)
def test_key(req: KeyTestRequest) -> KeyTestResult:
    """One tiny completion to prove the key and model work."""
    model = getattr(SettingsService.get().ai, f"{req.provider}_model", "")
    try:
        provider = AI.get(req.provider)
        provider.generate_text("Reply with one word: ok", temperature=0.0)
        return KeyTestResult(ok=True, model=provider.model)
    except Exception as e:
        return KeyTestResult(ok=False, model=model, error=str(e)[:300])


@router.post("/local/check", response_model=LocalServer)
def check_local(req: LocalCheckRequest) -> LocalServer:
    """Is a local model server (Ollama, LM Studio) answering at this address, and which models does it have."""
    return inspect(req.base_url or SettingsService.get().ai.local_base_url)


@router.post("/check-path", response_model=PathCheckResult)
def check_path(req: PathCheckRequest) -> PathCheckResult:
    return SettingsService.check_path(req.path)


@router.post("/data-dir", response_model=SettingsView)
def change_data_dir(req: DataDirChange) -> SettingsView:
    if JobRegistry.busy_reasons():
        raise HTTPException(409, detail=tr("settings.data_dir_busy"))
    try:
        SettingsService.change_data_dir(req.path, move=req.mode == "move")
    except (ValueError, OSError) as e:
        raise HTTPException(400, detail=str(e)) from e
    from backend.services.migration import migrate_all
    from backend.services.storage import Lessons

    Lessons.import_untracked()
    migrate_all()
    return SettingsService.view()



@router.get("/compute", response_model=ComputeStatus)
def compute_status() -> ComputeStatus:
    """What local transcription runs on now and why (the first call imports torch: about a second)."""
    from backend.core import compute

    c = SettingsService.get().compute
    plan, hw = compute.plan(c.device, c.cpu_threads), compute.probe()
    return ComputeStatus(
        preference=c.device, backend=plan.backend, gpu_name=hw.gpu_name, gpu_available=bool(hw.gpu_name),
        reason=plan.reason, failure=compute.failure("cuda") or compute.failure("apple"),
        threads=plan.threads, cores=hw.cores, logical_cores=hw.threads,
    )
