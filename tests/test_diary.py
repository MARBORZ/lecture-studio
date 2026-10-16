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

    with TestClient(app, base_url="http://127.0.0.1") as c:
        e = c.post("/api/diary/entries", json={"text": "поток мыслей"}).json()
        assert c.get(f"/api/diary/entries/{e['id']}").json()["text"].strip() == "поток мыслей"
        assert c.put(f"/api/diary/entries/{e['id']}", json={"text": "правка"}).json()["title"] == "правка"
        assert c.delete("/api/diary/categories/Входящие").status_code == 400
        assert c.delete(f"/api/diary/entries/{e['id']}").status_code == 200
        assert c.get("/api/diary/entries").json() == {"items": [], "total": 0, "page": 1, "size": 30}


def test_prompt_overrides(data_dir):
    from backend.core.ai import prompts
    from backend.main import app

    default_style = prompts.BLOCKS["audit.style"].default
    with TestClient(app, base_url="http://127.0.0.1") as c:
        r = c.put("/api/settings/prompts/audit.style", json={"value": "Пиши как для школьника."}).json()
        style = next(b for b in r if b["key"] == "audit.style")
        assert style["modified"] and "школьника" in prompts.audit_system(True, "ru")
        assert "[MM:SS]" in prompts.audit_system(True, "ru")  # contract stays even with custom style
        c.delete("/api/settings/prompts/audit.style")
        assert prompts.text("audit.style") == default_style
        assert c.put("/api/settings/prompts/nope", json={"value": "x"}).status_code == 404


def test_entries_come_a_page_at_a_time(data_dir):
    from fastapi.testclient import TestClient

    from backend.main import app

    with TestClient(app, base_url="http://127.0.0.1") as c:
        for i in range(75):
            c.post("/api/diary/entries", json={"text": f"запись {i} {'функции' if i % 5 == 0 else 'списки'}"})
        first = c.get("/api/diary/entries").json()
        assert (first["total"], first["page"], first["size"], len(first["items"])) == (75, 1, 30, 30)
        seen = [e["id"] for p in (1, 2, 3) for e in c.get("/api/diary/entries", params={"page": p}).json()["items"]]
        assert len(seen) == 75 and len(set(seen)) == 75  # pages do not overlap and miss nothing
        dates = [e["created_at"] for p in (1, 2, 3) for e in c.get("/api/diary/entries", params={"page": p}).json()["items"]]
        assert dates == sorted(dates, reverse=True)  # newest first across pages
        assert c.get("/api/diary/entries", params={"page": 4}).json()["items"] == []  # past the end: empty, total kept

        found = c.get("/api/diary/entries", params={"q": "функции", "size": 10}).json()
        assert found["total"] == 15 and len(found["items"]) == 10  # the search is applied before the cut
        assert all("функции" in e["text"] for e in found["items"])
        assert c.get("/api/diary/entries", params={"size": 1000}).json()["size"] == 100  # capped
        assert c.get("/api/diary/entries", params={"page": 0}).json()["page"] == 1
