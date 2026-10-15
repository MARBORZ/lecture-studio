import json

from backend.core.timeline import TimeMap, format_srt, timecodes_in
from backend.services.migration import migrate_lesson_dir
from tests.conftest import TIME_MAP


def test_legacy_lesson_moves_to_clean_timeline(tmp_path):
    d = tmp_path / "job1"
    d.mkdir()
    tm = TimeMap(TIME_MAP)
    (d / "time_map.json").write_text(json.dumps(TIME_MAP))
    # older format: only ORIGINAL timeline SRT, audit built from it
    phrases = [(1.0, 4.0, "one"), (12.0, 15.0, "two"), (25.0, 28.0, "three")]
    srt = "\n".join(
        f"{i}\n{format_srt(tm.clean_to_orig(a))} --> {format_srt(tm.clean_to_orig(b))}\n{t}\n"
        for i, (a, b, t) in enumerate(phrases, 1)
    )
    (d / "transcript_orig.srt").write_text(srt)
    (d / "lesson_audit.md").write_text("### `[00:00:22]` two\n- [01:45] three")

    report = migrate_lesson_dir(d)
    assert report == {"segments": 3, "audit_remapped": True}

    segments = json.loads((d / "segments.json").read_text())
    assert [s["clean_start"] for s in segments] == [1.0, 12.0, 25.0]
    assert (d / "transcript_clean.srt").read_text().startswith("1\n00:00:01,000")
    assert timecodes_in((d / "lesson_audit.md").read_text()) == [12, 25]
    assert (d / "lesson_audit.orig.md").exists()

    assert migrate_lesson_dir(d) == {"segments": 0, "audit_remapped": False}  # idempotent
