import io
import zipfile

from fastapi.testclient import TestClient

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000000000200015e2b0a5c0000000049454e44ae426082"
)


def _zip(members: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, xml in members.items():
            z.writestr(name, xml)
    return buf.getvalue()


def _upload(c, name, data):
    r = c.put(f"/api/assistant/attachments/{name}", content=data)
    assert r.status_code == 200, r.text
    return r.json()


def test_kinds_and_download(data_dir):
    from backend.main import app

    with TestClient(app) as c:
        code = _upload(c, "main.py", b"def f():\n    return 42\n")
        assert (code["kind"], code["chars"]) == ("text", 23)
        cyr = _upload(c, "notes.txt", "заметка в cp1251".encode("cp1251"))
        assert cyr["kind"] == "text"
        docx = _upload(c, "spec.docx", _zip({"word/document.xml": "<w:document><w:p><w:t>Требование 1</w:t></w:p></w:document>"}))
        assert docx["kind"] == "document" and docx["chars"] > 0
        pptx = _upload(c, "deck.pptx", _zip({"ppt/slides/slide2.xml": "<a:p>второй</a:p>", "ppt/slides/slide1.xml": "<a:p>первый</a:p>"}))
        assert pptx["kind"] == "document"
        img = _upload(c, "screen.png", PNG)
        assert img["kind"] == "image"
        bin_ = _upload(c, "clip.mov", b"\x00\x00\x00\x18ftypqt  " + bytes(range(256)) * 10)
        assert bin_["kind"] == "binary" and bin_["note"]

        r = c.get(f"/api/assistant/attachments/{code['id']}/file")
        assert r.status_code == 200 and r.content == b"def f():\n    return 42\n"
        assert c.get("/api/assistant/attachments/../../etc/file").status_code in (400, 404)
        assert c.put("/api/assistant/attachments/empty.txt", content=b"").status_code == 400

    from backend.services import attachments
    assert "первый" in attachments.text(attachments.get(pptx["id"])).split("второй")[0]  # slides in order


def test_attachments_reach_the_model_and_are_cleaned(data_dir, monkeypatch):
    from backend.main import app
    from backend.models.lesson import Lesson
    from backend.services import assistant
    from backend.services.storage import Library
    from backend.utils.fs import write_json

    Library.save_lesson(Lesson(id="less_x", job_id="x", title="Урок"))
    write_json(data_dir / "output" / "x" / "segments.json", [{"clean_start": 0, "clean_end": 2, "orig_start": 0, "orig_end": 2, "text": "привет"}])

    seen = {}

    class Fake:
        model = "fake"

        def __init__(self, vision):
            self.can_see_images = vision

        def chat(self, messages, system, images=None, **kw):
            seen["prompt"], seen["images"] = messages[-1]["content"], images or []
            return "ok"

    with TestClient(app) as c:
        doc = _upload(c, "task.md", b"# TODO\nfix the parser")
        img = _upload(c, "screen.png", PNG)

        monkeypatch.setattr(assistant.AI, "get", staticmethod(lambda name: Fake(vision=True)))
        thread = c.post("/api/assistant/lesson/less_x", json={"question": "что в файлах?", "attachments": [doc["id"], img["id"]]}).json()
        assert "fix the parser" in seen["prompt"] and len(seen["images"]) == 1
        assert [a["name"] for a in thread["session"]["messages"][0]["attachments"]] == ["task.md", "screen.png"]

        monkeypatch.setattr(assistant.AI, "get", staticmethod(lambda name: Fake(vision=False)))
        c.post("/api/assistant/lesson/less_x", json={"question": "а картинка?", "attachments": [img["id"]]})
        assert seen["images"] == [] and "не видит изображения" in seen["prompt"]

        c.delete("/api/assistant/lesson/less_x")
        assert not (data_dir / "attachments" / doc["id"]).exists()
