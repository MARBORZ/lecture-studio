from backend.core.timeline import (
    TimeMap,
    format_srt,
    format_tc,
    frame_snap,
    normalize_timecodes,
    parse_srt,
    parse_tc,
    rewrite_timecodes,
    timecodes_in,
)
from tests.conftest import TIME_MAP


def test_format_and_parse():
    assert format_tc(65.9) == "01:05"
    assert format_tc(3725) == "01:02:05"
    assert format_srt(12.3456) == "00:00:12,346"
    assert parse_tc("01:05") == 65
    assert parse_tc("[01:02:05]") == 3725
    assert parse_tc("00:00:01,500") == 1.5


def test_timemap_roundtrip():
    tm = TimeMap(TIME_MAP)
    for clean in (0.0, 5.5, 10.0, 19.9, 25.0, 30.0):
        assert abs(tm.orig_to_clean(tm.clean_to_orig(clean)) - clean) < 1e-6


def test_orig_inside_pause_maps_to_cut_point():
    tm = TimeMap(TIME_MAP)
    assert tm.orig_to_clean(15.0) == 10.0   # pause between 12 and 20
    assert tm.orig_to_clean(50.0) == 20.0   # pause between 30 and 100
    assert tm.orig_to_clean(1.0) == 0.0     # before first span
    assert tm.orig_to_clean(500.0) == 30.0  # after the end


def test_frame_snap_aligns_and_keeps_order():
    spans = frame_snap([(0.013, 1.021), (1.02, 2.5)], fps=30)
    for s, e in spans:
        assert abs(s * 30 - round(s * 30)) < 1e-4 and abs(e * 30 - round(e * 30)) < 1e-4
    assert spans[1][0] >= spans[0][1]


def test_rewrite_and_normalize_timecodes():
    md = "a `[00:00:12]` b [01:40] c [99:00]"
    assert rewrite_timecodes(md, lambda t: t + 1) == "a [00:13] b [01:41] c [01:39:01]"
    assert normalize_timecodes(md, duration=120) == "a [00:12] b [01:40] c"
    assert timecodes_in("[00:05] x [1:00:00]") == [5, 3600]
    assert "```" in rewrite_timecodes("```py\nx\n```", lambda t: t)


def test_parse_srt():
    items = parse_srt("1\n00:00:01,000 --> 00:00:02,500\nhello\n\n2\n00:00:03,000 --> 00:00:04,000\nworld\n")
    assert items == [{"start": 1.0, "end": 2.5, "text": "hello"}, {"start": 3.0, "end": 4.0, "text": "world"}]
