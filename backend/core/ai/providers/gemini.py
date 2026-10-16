"""
Google Gemini provider (text). Audio transcription lives in core/transcription/gemini.py.
"""

import logging
import math
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.core.ai import prompts
from backend.core.ai.base import BaseAIProvider, clean_output
from backend.core.ai.retry import with_retry
from backend.i18n import tr

logger = logging.getLogger(__name__)

VIDEO_PART_SEC = 45 * 60  # one request per part of a long video (offsets inside one uploaded file)
VIDEO_TOKENS_PER_SEC = 100  # low media resolution: ~66 tokens per frame at 1 fps + ~32 for audio


def upload_file(client, path: str | Path, check_cancelled: Callable[[], None] = lambda: None):
    """Upload to the Gemini Files API and wait until it is ready (video takes a while to process)."""
    uploaded = with_retry(lambda: client.files.upload(file=str(path)), "Gemini", check_cancelled)
    for _ in range(300):  # up to ~10 minutes for a long video
        state = getattr(client.files.get(name=uploaded.name).state, "name", "")
        if state == "ACTIVE":
            return uploaded
        if state == "FAILED":
            raise RuntimeError(tr("ai.file_rejected", provider="Gemini", name=Path(path).name))
        check_cancelled()
        time.sleep(2)
    raise RuntimeError(tr("ai.file_timeout", provider="Gemini", name=Path(path).name))


def delete_file(client, uploaded) -> None:
    try:
        client.files.delete(name=uploaded.name)
    except Exception as e:  # cloud cleanup is best-effort
        logger.warning("Gemini file cleanup failed: %s", e)


class GeminiProvider(BaseAIProvider):
    category = "gemini"
    default_model = "gemini-3.5-flash"
    supported_models = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"]
    can_transcribe_audio = True
    can_see_images = True
    can_watch_video = True
    max_context_tokens = 1_000_000
    default_context_tokens = 400_000

    def _generate(self, contents: list, system: str, temperature: float) -> str:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key)
        config = types.GenerateContentConfig(temperature=temperature, system_instruction=system or None)
        return with_retry(lambda: client.models.generate_content(model=self.model, contents=contents, config=config).text or "", "Gemini")

    def generate_text(self, prompt: str, system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        return self._generate([prompt], system, temperature)

    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        from google.genai import types

        contents = [
            types.Content(role="model" if m["role"] == "assistant" else "user", parts=[types.Part(text=m["content"])])
            for m in messages
        ]
        images = kwargs.get("images") or []
        if images and contents:
            contents[-1].parts.extend(types.Part.from_bytes(data=data, mime_type=mime) for data, mime in images)
        return self._generate(contents, system, temperature)

    def generate_audit_from_video(
        self,
        video_path: str | Path,
        duration: float,
        timed: bool,
        transcript_between: Callable[[float, float], str],
        on_progress: Callable[[float, str], None] | None = None,
        check_cancelled: Callable[[], None] = lambda: None,
    ) -> str:
        """Audit from an optimized video copy (+ the transcript of each part when there is one). Long videos go part by
        part over one uploaded file (video offsets), then the part notes are merged like a long transcript audit."""
        from google import genai
        from google.genai import types

        report = on_progress or (lambda f, m: None)
        client = genai.Client(api_key=self.api_key)
        report(0.02, tr("audit.video_upload"))
        uploaded = upload_file(client, video_path, check_cancelled)
        try:
            n = max(1, math.ceil(duration / VIDEO_PART_SEC))
            spans = [(i * VIDEO_PART_SEC, min((i + 1) * VIDEO_PART_SEC, duration)) for i in range(n)]
            has_transcript = bool(transcript_between(0, duration).strip())
            notes = []
            for i, (a, b) in enumerate(spans, start=1):
                check_cancelled()
                report(i / (n + 1), tr("audit.video_part", i=i, n=n) if n > 1 else tr("audit.video"))
                meta = types.VideoMetadata(start_offset=f"{a:.0f}s", end_offset=f"{b:.0f}s") if n > 1 else None
                video = types.Part(file_data=types.FileData(file_uri=uploaded.uri, mime_type=uploaded.mime_type), video_metadata=meta)
                config = types.GenerateContentConfig(
                    system_instruction=prompts.video_audit_system(timed, has_transcript, part=n > 1),
                    temperature=0.2,
                    media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW,
                )
                text = prompts.video_audit_prompt(transcript_between(a, b), i, n)
                notes.append(with_retry(
                    lambda v=video, t=text, c=config: client.models.generate_content(model=self.model, contents=[v, t], config=c).text or "",
                    "Gemini",
                    check_cancelled,
                ))
            if n == 1:
                raw = notes[0]
            else:
                report(n / (n + 1), tr("audit.video_merge"))
                raw = self.generate_text("\n\n---\n\n".join(notes), prompts.merge_system(timed))
            return clean_output(raw, duration, timed)
        finally:
            delete_file(client, uploaded)
