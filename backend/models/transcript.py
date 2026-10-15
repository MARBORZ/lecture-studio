"""
Transcript segment schemas. segments.json is the canonical transcript of a lesson.
"""

from typing import List

from pydantic import BaseModel, Field


class Segment(BaseModel):
    """One spoken phrase on both timelines (seconds)."""

    clean_start: float
    clean_end: float
    orig_start: float
    orig_end: float
    text: str


class GeminiSegment(BaseModel):
    """Structured-output schema for Gemini audio transcription."""

    start_time_mm_ss: str = Field(description="Phrase start, e.g. '00:05' or '01:24'")
    end_time_mm_ss: str = Field(description="Phrase end, e.g. '00:18' or '01:42'")
    text: str = Field(description="Verbatim, punctuated speech")


class GeminiTranscript(BaseModel):
    segments: List[GeminiSegment]
