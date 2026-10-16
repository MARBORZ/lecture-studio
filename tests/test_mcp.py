"""
The MCP server (mcp_server.py) as agents see it.
"""


def test_inbox_has_a_name_for_agents(data_dir):
    import mcp_server
    from backend.models.project import INBOX_ID, ProjectPatch
    from backend.services.storage import Library

    def inbox():
        return next(p for p in mcp_server.lecture_list_projects() if p["id"] == INBOX_ID)

    assert inbox()["name"] == "Inbox" and inbox()["description"]
    assert Library.get_project(INBOX_ID).name == ""  # nothing is written back: the app keeps showing its own name
    Library.patch_project(INBOX_ID, ProjectPatch(name="Разное"))
    assert inbox()["name"] == "Разное"  # a name the user gave wins
