import pytest
from fastapi.testclient import TestClient


def test_diary_crud_and_categories(data_dir):
    from backend.services import diary

    assert [c.name for c in diary.list_categories()] == ["Входящие"]
    e = diary.create_entry("Входящие", "# Идея\nкэшировать модели whisper")
    assert e.title == "Идея" and e.excerpt.startswith("кэшировать")
    assert (data_dir / "diary" / "Входящие" / e.id.split("/")[1]).is_file()  # plain .md, Obsidian-compatible

    diary.create_category("Код")
    moved = diary.update_entry(e.id, text="# Идея v2\nтекст", category="Код")
    assert moved.category == "Код" and moved.title == "Идея v2"
    assert [m.id for m in diary.list_entries(query="v2")] == [moved.id]

    assert diary.delete_category("Код") == 1  # entries survive, back to Inbox
    assert [m.category for m in diary.list_entries()] == ["Входящие"]


def test_diary_rejects_path_traversal(data_dir):
    from backend.services import diary

    (data_dir / "secret.md").write_text("x")
    with pytest.raises(diary.DiaryError):
        diary.get_entry("../secret.md")
    with pytest.raises(diary.DiaryError):
        diary.update_entry("Входящие/../../secret.md", text="pwned")
    assert (data_dir / "secret.md").read_text() == "x"
    assert diary.create_category("../../evil").name == "evil"  # dots/slashes stripped, stays inside diary/
    assert (data_dir / "diary" / "evil").is_dir()


def test_diary_api(data_dir):
    from backend.main import app

    with TestClient(app) as c:
        e = c.post("/api/diary/entries", json={"text": "поток мыслей"}).json()
        assert c.get(f"/api/diary/entries/{e['id']}").json()["text"].strip() == "поток мыслей"
        assert c.put(f"/api/diary/entries/{e['id']}", json={"text": "правка"}).json()["title"] == "правка"
        assert c.delete("/api/diary/categories/Входящие").status_code == 400
        assert c.delete(f"/api/diary/entries/{e['id']}").status_code == 200
        assert c.get("/api/diary/entries").json() == []


def test_prompt_overrides(data_dir):
    from backend.core.ai import prompts
    from backend.main import app

    default_style = prompts.BLOCKS["audit.style"].default
    with TestClient(app) as c:
        r = c.put("/api/settings/prompts/audit.style", json={"value": "Пиши как для школьника."}).json()
        style = next(b for b in r if b["key"] == "audit.style")
        assert style["modified"] and "школьника" in prompts.audit_system(True, "ru")
        assert "[MM:SS]" in prompts.audit_system(True, "ru")  # contract stays even with custom style
        c.delete("/api/settings/prompts/audit.style")
        assert prompts.text("audit.style") == default_style
        assert c.put("/api/settings/prompts/nope", json={"value": "x"}).status_code == 404
