"""
Video encoder choice: NVENC only on a CUDA plan with an FFmpeg that has it; any NVENC failure re-encodes with x264.
"""

import pytest

from backend.core.media import video


def test_pick_encoder(monkeypatch):
    monkeypatch.setattr(video, "has_encoder", lambda name: name == "h264_nvenc")
    assert video.pick_encoder("cuda") == "nvenc"
    assert video.pick_encoder("apple") == "x264"  # VideoToolbox: slower and much larger files on screen recordings
    assert video.pick_encoder("cpu") == "x264"
    monkeypatch.setattr(video, "has_encoder", lambda name: False)
    assert video.pick_encoder("cuda") == "x264"  # an FFmpeg build without NVENC


def test_nvenc_args_keep_quality_and_faststart():
    args = video.VideoProcessor(crf=26, encoder="nvenc")._encode_args()
    assert args[args.index("-c:v") + 1] == "h264_nvenc" and args[args.index("-cq") + 1] == "26"
    assert "+faststart" in args and "-spatial-aq" in args


@pytest.mark.parametrize("fails", [True, False])
def test_nvenc_failure_falls_back_to_x264(monkeypatch, tmp_path, fails):
    used = []

    def run(cmd, desc):
        enc = cmd[cmd.index("-c:v") + 1]
        used.append(enc)
        if enc == "h264_nvenc" and fails:
            raise RuntimeError("FFmpeg (video jump-cut): No NVENC capable devices found")

    monkeypatch.setattr(video, "run_ffmpeg", run)
    monkeypatch.setattr(video, "file_size_mb", lambda p: 1.0)
    monkeypatch.setattr(video, "probe_duration", lambda p: 10.0)
    res = video.VideoProcessor(encoder="nvenc").process(tmp_path / "in.mp4", tmp_path / "out.mp4", [(0.0, 5.0)])
    assert used == (["h264_nvenc", "libx264"] if fails else ["h264_nvenc"])
    assert res["encoder"] == ("x264" if fails else "nvenc")
