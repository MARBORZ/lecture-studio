"""
Atomic writes (backend/utils/fs.py): simultaneous writers never trip over each other, and on Windows a rename that
meets a reader is retried.
"""

import threading
from pathlib import Path

import pytest

from backend.utils import fs


def test_simultaneous_writers_of_one_file(tmp_path):
    target = tmp_path / "db.json"
    errors = []

    def writer(tag):
        try:
            for i in range(150):
                fs.write_text(target, f"{tag}{i}")
        except OSError as e:  # one shared temp file: a writer found it renamed away by the other
            errors.append(e)

    threads = [threading.Thread(target=writer, args=(t,)) for t in "ab"]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert target.read_text() in {"a149", "b149"}
    assert [p.name for p in tmp_path.iterdir()] == ["db.json"]  # no temp files left behind


def test_windows_rename_waits_for_a_reader(tmp_path, monkeypatch):
    target = tmp_path / "db.json"
    target.write_text("old")
    real_replace, refused = Path.replace, []

    def replace(self, dst):
        if len(refused) < 3:
            refused.append(1)
            raise PermissionError(13, "The process cannot access the file because it is being used by another process")
        return real_replace(self, dst)

    monkeypatch.setattr(Path, "replace", replace)
    monkeypatch.setattr(fs, "_WINDOWS", True)
    fs.write_text(target, "new")
    assert target.read_text() == "new" and len(refused) == 3

    # elsewhere a refused rename is a real permission problem: it fails at once and leaves no temp file
    refused.clear()
    monkeypatch.setattr(fs, "_WINDOWS", False)
    with pytest.raises(PermissionError):
        fs.write_text(target, "newer")
    assert len(refused) == 1 and target.read_text() == "new"
    assert [p.name for p in tmp_path.iterdir()] == ["db.json"]
