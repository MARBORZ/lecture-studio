"""
Steps sharing a `together` key (the video encode and the transcription) run at once when each says it pays off;
quiet mode keeps them one by one, halves the threads and lowers FFmpeg's priority; batched Faster-Whisper halves its
batch on a GPU out of memory before giving the GPU up.
"""

import time

import pytest

from backend.core import compute


class Sleepy:
    """A fake step that records when it ran."""

    def __init__(self, stage, together="media", overlap=True, fail=None):
        self.stage, self.weight, self.together, self.overlap, self.fail = stage, 1.0, together, overlap, fail
        self.span = (0.0, 0.0)

    def enabled(self, ctx):
        return True

    def may_overlap(self, ctx):
        return self.overlap

    def execute(self, ctx, progress):
        start = time.monotonic()
        for i in range(5):
            progress(i / 5, self.stage)
            if self.fail and i == 2:
                raise self.fail
            time.sleep(0.04)
        self.span = (start, time.monotonic())


def run(steps, data_dir):
    from backend.core.pipeline.runner import LecturePipeline
    from backend.core.pipeline.steps import JobContext
    from backend.models.job import JobOptions
    from backend.services.jobs import JobRegistry

    job = JobRegistry.create("process", "t", [s.stage for s in steps])
    ctx = JobContext(job.id, JobOptions(), lesson=None)
    try:
        LecturePipeline(steps).run(job, ctx)
    finally:
        JobRegistry.update(job.id, status="completed")  # a fake job must not keep the system busy for other tests
    return job


def overlapped(a, b):
    return a.span[0] < b.span[1] and b.span[0] < a.span[1]


def test_neighbours_run_at_once(data_dir):
    video, text = Sleepy("video"), Sleepy("transcribe")
    run([video, text], data_dir)
    assert overlapped(video, text)


def test_one_by_one_when_a_step_says_no(data_dir):
    video, text = Sleepy("video"), Sleepy("transcribe", overlap=False)
    run([video, text], data_dir)
    assert not overlapped(video, text)


def test_a_cancel_in_one_part_stops_the_job(data_dir):
    from backend.services.jobs import JobCancelled

    with pytest.raises(JobCancelled):
        run([Sleepy("video"), Sleepy("transcribe", fail=JobCancelled())], data_dir)


def test_quiet_halves_threads(monkeypatch):
    hw = compute.Hardware(cores=8, threads=16)
    monkeypatch.setattr(compute, "probe", lambda: hw)
    assert compute.plan("cpu").threads == 8
    assert compute.plan("cpu", quiet=True).threads == 4
    assert compute.plan("cpu", 6, quiet=True).threads == 6  # a number set by hand wins


def test_quiet_ffmpeg_runs_at_low_priority(monkeypatch):
    import sys

    from backend.core.media import base

    monkeypatch.setattr(sys, "platform", "darwin")
    token = base.low_priority.set(True)
    try:
        cmd, extra = base._lowered(["ffmpeg", "-i", "x"])
    finally:
        base.low_priority.reset(token)
    assert cmd[:3] == ["nice", "-n", "10"] and extra == {}
    assert base._lowered(["ffmpeg"]) == (["ffmpeg"], {})


def test_gpu_out_of_memory_halves_the_batch(monkeypatch):
    import faster_whisper

    from backend.core.transcription import engines

    tried = []

    class Seg:
        start, end, text = 0.0, 1.0, "слово"

    class Pipeline:
        def __init__(self, model):
            pass

        def transcribe(self, audio, batch_size, **kw):
            tried.append(batch_size)
            if batch_size > 4:
                raise RuntimeError("CUDA failed with error out of memory")
            return iter([Seg()]), None

    monkeypatch.setattr(faster_whisper, "BatchedInferencePipeline", Pipeline)
    engine = engines.FasterWhisperEngine("cuda", 8)
    monkeypatch.setattr(engine, "_model", lambda size: object())
    out = engine.transcribe("a.wav", 1.0, "large-v3-turbo", "ru", "", lambda: None, None)
    assert tried == [16, 8, 4] and out[0]["text"] == "слово"
