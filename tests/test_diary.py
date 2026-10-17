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
        assert c.get("/api/diary/entries").json() == {"items": [], "total": 0, "size": 30, "next": None}


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

    def pages(c, **params):
        """Every page in turn, each asked for with the previous page's cursor."""
        out, after = [], None
        while True:
            page = c.get("/api/diary/entries", params={**params, **({"after": after} if after else {})}).json()
            out.append(page)
            if not (after := page["next"]):
                return out

    with TestClient(app, base_url="http://127.0.0.1") as c:
        for i in range(75):
            c.post("/api/diary/entries", json={"text": f"запись {i} {'функции' if i % 5 == 0 else 'списки'}"})
        first = c.get("/api/diary/entries").json()
        assert (first["total"], first["size"], len(first["items"])) == (75, 30, 30) and first["next"]
        all_pages = pages(c)
        assert [len(p["items"]) for p in all_pages] == [30, 30, 15] and all_pages[-1]["next"] is None
        seen = [e["id"] for p in all_pages for e in p["items"]]
        assert len(seen) == 75 and len(set(seen)) == 75  # pages do not overlap and miss nothing
        dates = [e["created_at"] for p in all_pages for e in p["items"]]
        assert dates == sorted(dates, reverse=True)  # newest first across pages

        found = c.get("/api/diary/entries", params={"q": "функции", "size": 10}).json()
        assert found["total"] == 15 and len(found["items"]) == 10  # the search is applied before the cut
        assert all("функции" in e["text"] for e in found["items"])
        assert sum(len(p["items"]) for p in pages(c, q="функции", size=10)) == 15
        assert c.get("/api/diary/entries", params={"size": 1000}).json()["size"] == 100  # capped

        # entries written and deleted between two pages shift nothing: no repeats, nothing skipped
        page1 = c.get("/api/diary/entries").json()
        c.post("/api/diary/entries", json={"text": "новая, пока листали"})
        for e in page1["items"][:3]:
            c.delete(f"/api/diary/entries/{e['id']}")
        page2 = c.get("/api/diary/entries", params={"after": page1["next"]}).json()
        assert page2["items"][0]["id"] == seen[30] and page2["total"] == 73
