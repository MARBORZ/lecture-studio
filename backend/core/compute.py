"""
Compute devices for local models. Whisper uses it today; any local model added later asks the same two questions:

  probe()        — what this machine has (cached): an NVIDIA GPU usable by CUDA (through torch), the Apple GPU
                   (through MLX), CPU cores; on Windows also what the launcher's GPU probe decided (state/compute.json).
  plan(setting)  — what to run on for a preference auto | gpu | cpu: "cuda", "apple" or "cpu", how many CPU threads,
                   and, when it is the CPU, why (shown in Settings → AI).

A GPU that fails at runtime (missing CUDA libraries, out of memory) is marked with mark_failed(): later plans use the CPU
and say why, instead of failing every job.
"""

import logging
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Literal

from backend import config
from backend.utils.fs import read_json
from backend.utils.proc import cpu_cores

logger = logging.getLogger(__name__)

Backend = Literal["cuda", "apple", "cpu"]
Preference = Literal["auto", "gpu", "cpu"]

# Why the CPU is used (plan.reason). The UI explains each.
REASONS = ("user", "no_gpu", "old_gpu", "old_driver", "torch_cpu", "apple_unavailable", "gpu_failed")


@dataclass(frozen=True)
class Hardware:
    cores: int  # physical
    threads: int  # logical
    cuda: bool = False
    cuda_name: str = ""
    apple_gpu: bool = False
    windows_probe: dict = field(default_factory=dict)  # state/compute.json written by the Windows launcher

    @property
    def gpu_name(self) -> str:
        if self.cuda:
            return self.cuda_name
        return "Apple GPU (Metal)" if self.apple_gpu else ""


@dataclass(frozen=True)
class Plan:
    backend: Backend
    threads: int  # CPU threads for the CPU backend (and for data loading elsewhere)
    gpu_name: str = ""
    reason: str = ""  # one of REASONS (cpu only), "" otherwise
    quiet: bool = False  # the user prefers less noise and heat to speed: fewer threads, nothing at once


_failed: dict[str, str] = {}  # backend -> error, for this process


@lru_cache(maxsize=1)
def probe() -> Hardware:
    cores, threads = cpu_cores()
    windows_probe = read_json(config.STATE_DIR / "compute.json", default={}) if sys.platform == "win32" else {}
    cuda, cuda_name, apple = False, "", False
    try:
        import torch

        if torch.cuda.is_available():
            cuda, cuda_name = True, torch.cuda.get_device_name(0)
    except Exception as e:  # a broken torch install must not take the app down
        logger.warning("torch probe failed: %s", e)
    if sys.platform == "darwin" and not cuda:
        try:
            import mlx.core as mx

            apple = mx.default_device().type == mx.DeviceType.gpu
        except Exception:
            apple = False
    return Hardware(cores=cores, threads=threads, cuda=cuda, cuda_name=cuda_name, apple_gpu=apple, windows_probe=windows_probe or {})


def _why_no_gpu(hw: Hardware) -> str:
    if sys.platform == "darwin":
        return "apple_unavailable"
    reason = str(hw.windows_probe.get("reason", ""))
    if reason in ("old_gpu", "old_driver", "no_nvidia"):
        return "no_gpu" if reason == "no_nvidia" else reason
    if hw.windows_probe.get("torch_build") == "cpu" and reason == "forced":
        return "user"
    try:
        import torch

        if sys.platform == "win32" and not torch.version.cuda:
            return "torch_cpu"
    except Exception:
        pass
    return "no_gpu"


def plan(preference: Preference = "auto", cpu_threads: int = 0, quiet: bool = False) -> Plan:
    hw = probe()
    default = max(1, hw.cores // 2) if quiet else hw.cores  # 0 = every physical core, half of them when quiet
    threads = max(1, min(cpu_threads or default, hw.threads))
    gpu: Backend | None = "cuda" if hw.cuda else "apple" if hw.apple_gpu else None
    if preference == "cpu":
        reason = "user"
    elif gpu is None:
        reason = _why_no_gpu(hw)
    elif gpu in _failed:
        reason = "gpu_failed"
    else:
        return Plan(gpu, threads, gpu_name=hw.gpu_name, quiet=quiet)
    return Plan("cpu", threads, reason=reason, quiet=quiet)


def mark_failed(backend: Backend, error: str) -> None:
    logger.warning("%s failed, the CPU takes over: %s", backend, error)
    _failed[backend] = error[:300]


def failure(backend: Backend) -> str:
    return _failed.get(backend, "")
