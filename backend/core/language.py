"""
Which language an audit is written in.

  detect(text)                    — the language of a transcript by its script: Cyrillic -> "ru", Latin -> "en".
                                    Enough for the interface languages; "" when there is too little text to tell.
  resolve(choice, ui, speech)     — the output language for a choice: "interface" (default), "recording" (the language
                                    spoken in the lecture) or an explicit code.
"""

from backend.settings.schema import OutputLanguage

__all__ = ["OutputLanguage", "detect", "resolve"]


def detect(text: str) -> str:
    letters = [c for c in text if c.isalpha()]
    if len(letters) < 20:
        return ""
    cyrillic = sum("\u0400" <= c <= "\u04ff" for c in letters)  # the Cyrillic block
    return "ru" if cyrillic / len(letters) > 0.3 else "en"


def resolve(choice: str, ui_language: str, speech_language: str) -> str:
    if choice == "interface":
        return ui_language
    if choice == "recording":
        return speech_language or ui_language
    return choice
