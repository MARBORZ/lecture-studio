"""
Compute plan (GPU/CPU choice with reasons) and the GPU -> CPU fallback of local transcription.
"""

import pytest

from backend.core import compute


@pytest.fixture()
def machine(monkeypatch):
    """Pretend hardware: set(cuda=..., apple=...)."""
    monkeypatch.setattr(compute, "_failed", {})

    def set_(cuda=False, apple=False, cores=8, threads=16, windows=None):
        hw = compute.Hardware(cores=cores, threads=threads, cuda=cuda, cuda_name="RTX 3080" if cuda else "", apple_gpu=apple, windows_probe=windows or {})
        monkeypatch.setattr(compute, "probe", lambda: hw)

    return set_


def test_auto_uses_the_gpu_and_all_cores(machine):
    machine(cuda=True)
    p = compute.plan("auto")
    assert (p.backend, p.gpu_name, p.threads, p.reason) == ("cuda", "RTX 3080", 8, "")
    machine(apple=True)
    assert compute.plan("auto").backend == "apple"


def test_cpu_choice_and_threads(machine):
    machine(cuda=True)
    p = compute.plan("cpu", cpu_threads=4)
    assert (p.backend, p.threads, p.reason) == ("cpu", 4, "user")
    assert compute.plan("cpu", cpu_threads=99).threads == 16  # never more than the machine has


def test_cpu_reasons_from_the_windows_probe(machine, monkeypatch):
    monkeypatch.setattr(compute.sys, "platform", "win32")
    machine(windows={"torch_build": "cpu", "reason": "old_driver"})
    assert compute.plan("gpu").reason == "old_driver"
    machine(windows={"torch_build": "cpu", "reason": "no_nvidia"})
    assert compute.plan("auto").reason == "no_gpu"


def test_gpu_failure_falls_back_to_cpu_and_sticks(machine, monkeypatch):
    from backend.core.transcription import engines, whisper

    machine(cuda=True)
    used = []

    class Engine(engines.WhisperEngine):
        backends = ("cuda", "cpu")

        def transcribe(self, *args):
            used.append(self.backend)
            if self.backend == "cuda":
                raise RuntimeError("Library cublas64_12.dll is not found")
            return [{"clean_start": 0, "clean_end": 1, "text": "ok"}]

    monkeypatch.setattr(engines, "ENGINES", (Engine,))
    monkeypatch.setattr(whisper, "engine_for", engines.engine_for)
    assert whisper.transcribe("a.mp3", 1.0, "small", plan=compute.plan("auto"))[0]["text"] == "ok"
    assert used == ["cuda", "cpu"]
    p = compute.plan("auto")
    assert p.backend == "cpu" and p.reason == "gpu_failed" and "cublas64_12" in compute.failure("cuda")


def test_cancel_is_not_retried_on_the_cpu(machine, monkeypatch):
    from backend.core.transcription import engines, whisper

    machine(apple=True)

    class Stop(Exception):
        pass

    class Engine(engines.WhisperEngine):
        backends = ("apple", "cpu")

        def transcribe(self, audio, duration, size, language, vocabulary, check_cancelled, on_progress):
            check_cancelled()
            return []

    def cancel():
        raise Stop

    monkeypatch.setattr(engines, "ENGINES", (Engine,))
    with pytest.raises(Stop):
        whisper.transcribe("a.mp3", 1.0, "small", check_cancelled=cancel, plan=compute.plan("auto"))
    assert compute.failure("apple") == ""


def test_compute_status_endpoint(data_dir, machine):
    from fastapi.testclient import TestClient

    from backend.main import app

    machine(apple=True, cores=10, threads=10)
    with TestClient(app) as c:
        assert c.get("/api/settings/compute").json()["backend"] == "apple"
        c.patch("/api/settings", json={"compute": {"device": "cpu", "cpu_threads": 6}})
        s = c.get("/api/settings/compute").json()
    assert (s["backend"], s["reason"], s["threads"], s["gpu_available"]) == ("cpu", "user", 6, True)
