"""
The audit algorithm, once for every provider: a short transcript goes in one request; a long one is cut on line
boundaries into parts that fit the provider's window, each part becomes notes, and the notes are merged (in rounds when
even they do not fit a small local window). Providers only carry the text (generate_text) and say their window.
"""

from collections.abc import Callable

from backend.core.ai import prompts
from backend.core.ai.base import CHARS_PER_TOKEN, BaseAIProvider
from backend.core.ai.output import clean_output
from backend.i18n import tr

CHUNK_CHARS = 30_000
SEPARATOR = "\n\n---\n\n"


def split_lines(text: str, limit: int = CHUNK_CHARS) -> list[str]:
    """Split on line boundaries into chunks of at most ~limit chars."""
    chunks, buf, size = [], [], 0
    for line in text.splitlines():
        if buf and size + len(line) > limit:
            chunks.append("\n".join(buf))
            buf, size = [], 0
        buf.append(line)
        size += len(line) + 1
    if buf:
        chunks.append("\n".join(buf))
    return chunks


def part_limit(provider: BaseAIProvider, system: str) -> int:
    """Characters of material one request may carry next to `system`, leaving room for the answer."""
    window = provider.audit_window_tokens()
    if not window:
        return CHUNK_CHARS
    answer = min(4096, max(1024, window // 4))  # tokens kept free for the reply
    room = int((window - answer) * CHARS_PER_TOKEN * 0.9) - len(system) - 500  # 10% margin: the estimate is rough
    return max(2000, min(CHUNK_CHARS, room))


def write(
    provider: BaseAIProvider,
    transcript: str,
    duration: float | None,
    timed: bool = True,
    on_progress: Callable[[float, str], None] | None = None,
    language: str = "en",
) -> str:
    """Audit markdown from a compact '[MM:SS] text' transcript (clean timeline), written in `language`."""
    report = on_progress or (lambda f, m: None)
    if not transcript.strip():
        raise ValueError(tr("audit.empty"))

    systems = (prompts.audit_system(timed, language), prompts.chunk_notes_system(timed, language), prompts.merge_system(timed, language))
    limit = part_limit(provider, max(systems, key=len))
    chunks = split_lines(transcript, limit)
    if len(chunks) == 1:
        report(0.1, tr("audit.start"))
        raw = provider.generate_text(prompts.audit_prompt(transcript, timed), prompts.audit_system(timed, language))
        return clean_output(raw, duration, timed)

    notes = []
    for i, chunk in enumerate(chunks, start=1):
        report((i - 1) / (len(chunks) + 1), tr("audit.part", i=i, n=len(chunks)))
        notes.append(provider.generate_text(
            prompts.chunk_notes_prompt(chunk, i, len(chunks)),
            prompts.chunk_notes_system(timed, language),
        ))
    report(len(chunks) / (len(chunks) + 1), tr("audit.merge"))
    raw = provider.generate_text(fit_notes(provider, notes, limit, prompts.merge_system(timed, language)), prompts.merge_system(timed, language))
    return clean_output(raw, duration, timed)

def fit_notes(provider: BaseAIProvider, notes: list[str], limit: int, merge_system: str) -> str:
    """The parts' notes joined for the final merge. When they do not fit the window (a small local model), groups of
    them are merged first, round after round, until they do."""
    joined = SEPARATOR.join(notes)
    while len(joined) > limit and len(notes) > 1:
        groups: list[list[str]] = [[]]
        for note in notes:
            if groups[-1] and len(SEPARATOR.join([*groups[-1], note])) > limit:
                groups.append([])
            groups[-1].append(note)
        if all(len(g) == 1 for g in groups):  # every note alone is near the limit: pairs, each cut to fit
            half = limit // 2 - len(SEPARATOR)
            groups = [[n[:half] for n in notes[i : i + 2]] for i in range(0, len(notes), 2)]
        notes = [provider.generate_text(SEPARATOR.join(g), merge_system) if len(g) > 1 else g[0] for g in groups]
        joined = SEPARATOR.join(notes)
    return joined[:limit]
