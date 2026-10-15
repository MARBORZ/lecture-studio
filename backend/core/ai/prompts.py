"""
Every prompt Lecture Studio sends to a model lives here. Providers never hold prompt text.

Two kinds of text:
  * editable blocks (BLOCKS) — role, style, structure, assistant tasks. The user can override any of them
    in Settings -> Instructions; untouched blocks use the defaults below (lessons, programming-friendly).
  * contract (TIMECODE_RULE, CITATION_*, chunk/merge mechanics) — fixed, because the UI parses it
    (clickable [MM:SS], [[lesson@MM:SS]] citations).

Default house style: slide-deck speaker notes. Blunt, architectural, no softening, no filler, no emoji.
"""

from dataclasses import dataclass
from typing import Literal

from backend.settings import SettingsService

AUDIT_STYLE = """\
СТИЛЬ (обязателен, нарушение = брак):
- Формат заметок к слайдам: один пункт = одна строка, максимум ~15 слов.
- Только факты, решения, причины, последствия. Начинай пункт с сути: существительное или глагол.
- Грубо и прямо. Без смягчений и оговорок: никаких «стоит отметить», «важно понимать», «можно сказать», «как бы», «интересно», «давайте».
- Без вводных, без пересказа очевидного, без похвалы лектору, без морали, без восклицаний.
- Никаких эмодзи и декоративных символов.
- Если лектор ошибается, упрощает или противоречит себе — пиши прямо: «Неверно: …», «Упрощение: …», «Противоречие: …».
- Повторы лектора сворачивай в один пункт. Оговорки, шум, «эээ» — выбрасывай.
- Термины — как есть, без перевода на «простой язык».
- Код, команды, пути, флаги — дословно, в кодовых блоках с языком.
"""

TIMECODE_RULE = """\
ТАЙМКОДЫ:
- Формат строго [MM:SS] или [HH:MM:SS], в квадратных скобках, без обратных кавычек.
- Бери время только из строк стенограммы. Не выдумывай и не округляй сверх строки.
- Таймкод ставится в начале пункта или в заголовке блока.
"""

NO_TIMECODE_RULE = """\
ТАЙМКОДЫ: не используй вообще. Никаких [MM:SS] и упоминаний времени.
"""

AUDIT_STRUCTURE_TIMED = """\
СТРУКТУРА (Markdown, ровно эти разделы, пустой раздел — удалить):
# <Тема урока — 3–8 слов>
**Суть:** 1–2 строки — что разобрано и зачем.

## Блоки
### [MM:SS] <Название смыслового блока>
- тезис
- тезис

## Архитектура и решения
- [MM:SS] решение — почему — цена/компромисс

## Код и команды
```язык
дословно
```
- [MM:SS] что делает, одной строкой

## Ошибки и антипаттерны
- [MM:SS] ошибка → как правильно

## Термины
| Термин | Определение | Время |
|---|---|---|

## Итог
- 3–5 пунктов: что вынести с урока
"""

AUDIT_STRUCTURE_PLAIN = """\
СТРУКТУРА (Markdown, ровно эти разделы, пустой раздел — удалить):
# <Тема урока — 3–8 слов>
**Суть:** 1–2 строки — что разобрано и зачем.

## Блоки
### <Название смыслового блока>
- тезис

## Архитектура и решения
- решение — почему — цена/компромисс

## Код и команды
```язык
дословно
```

## Ошибки и антипаттерны
- ошибка → как правильно

## Термины
| Термин | Определение |
|---|---|

## Итог
- 3–5 пунктов: что вынести с урока
"""

ROLE_AUDITOR = (
    "Ты — технический аудитор учебных материалов. Твой продукт — жёсткий аудит лекции "
    "в виде заметок к презентации: прочитал за минуту, понял архитектуру, пошёл дальше."
)



def audit_system(timed: bool) -> str:
    return "\n\n".join([
        text("audit.role"),
        text("audit.style"),
        TIMECODE_RULE if timed else NO_TIMECODE_RULE,
        _structure(timed),
        "Отвечай на языке лекции. Выводи только Markdown аудита, без предисловий.",
    ])


def audit_prompt(transcript: str, timed: bool) -> str:
    kind = "Стенограмма с таймкодами чистой записи" if timed else "Стенограмма"
    return f"{kind}. Сделай аудит по структуре.\n\n{transcript}"


# ---------- long lectures: chunk notes -> final merge ----------

def chunk_notes_system(timed: bool) -> str:
    return "\n\n".join([
        text("audit.role"),
        text("audit.style"),
        TIMECODE_RULE if timed else NO_TIMECODE_RULE,
        "Это часть длинной лекции. Выведи только заметки этой части:\n"
        + ("### [MM:SS] <блок>\n- тезис" if timed else "### <блок>\n- тезис")
        + "\nПлюс отдельными списками, если есть: «Код и команды», «Ошибки», «Термины». Без заголовка урока и итогов.",
    ])


def chunk_notes_prompt(transcript: str, part: int, total: int) -> str:
    return f"Часть {part} из {total}.\n\n{transcript}"


def merge_system(timed: bool) -> str:
    return "\n\n".join([
        text("audit.role"),
        text("audit.style"),
        TIMECODE_RULE if timed else NO_TIMECODE_RULE,
        _structure(timed),
        "На входе — заметки по частям одной лекции. Собери единый аудит по структуре. "
        "Сохрани все блоки и все таймкоды. Дубли объедини. Выводи только Markdown.",
    ])


# ---------- assistant (NotebookLM) ----------

ASSISTANT_BASE = """\
Ты — ассистент по базе лекций пользователя. Отвечаешь только по предоставленным источникам.
Стиль: заметки к слайдам. Коротко, прямо, без смягчений, без вводных, без эмодзи.
Нет ответа в источниках — так и скажи одной строкой: «В источниках нет».
"""

CITATION_SINGLE = """\
ЦИТИРОВАНИЕ: каждый факт подкрепляй таймкодом [MM:SS] или [HH:MM:SS] из стенограммы.
"""

CITATION_MULTI = """\
ЦИТИРОВАНИЕ: каждый факт подкрепляй ссылкой вида [[<lesson_id>@MM:SS]] (или @HH:MM:SS),
где lesson_id — из заголовка источника, время — из его стенограммы. Пример: [[less_ab12cd34@04:15]].
"""

ROLE_TASKS: dict[str, str] = {
    "qa": "Ответь на вопрос. Списком, если пунктов больше двух.",
    "key_moments": "Ключевые моменты: 8–15 пунктов, каждый с привязкой ко времени.",
    "quiz": "Тест самопроверки: 6 вопросов. Формат: вопрос → короткий правильный ответ → ссылка на время.",
    "pitfalls": "Ошибки, антипаттерны, предостережения лектора. Формат: ошибка → как правильно → время.",
    "code_summary": "Весь код, команды, пути, флаги — дословно в кодовых блоках, по порядку, с временем.",
    "chapters": "Оглавление-главы: 8–15 строк вида «[MM:SS] Название», начиная с [00:00].",
}

# Compressing the older part of a chat session (our own context window, services/context_window.py).
ASSISTANT_COMPACT = """\
Сожми начало переписки пользователя с ассистентом по лекциям в рабочую сводку для продолжения разговора.
Сохрани: что спрашивал пользователь и зачем; данные ответы и выводы; определения и термины; решения и поправки;
код, команды и пути — дословно; таймкоды и ссылки на источники — как есть; что осталось непонятным, на чём остановились.
Убери: повторы, вежливость, пересказ источников, который и так есть в материалах.
Стиль: заметки, пункты, без вводных и без эмодзи.
"""

COMPACT_CONTRACT = """\
Выводи только сводку. Объём — не больше {limit} символов.
Если дана прошлая сводка, объедини её с новыми сообщениями в одну, ничего важного из неё не теряя.
"""


def compact_system() -> str:
    return text("assistant.compact")


def compact_prompt(previous_summary: str, transcript: str, limit: int) -> str:
    parts = [COMPACT_CONTRACT.format(limit=limit)]
    if previous_summary.strip():
        parts.append(f"ПРОШЛАЯ СВОДКА:\n{previous_summary.strip()}")
    parts.append(f"НОВЫЕ СООБЩЕНИЯ:\n{transcript}")
    return "\n\n".join(parts)


ROLE_DEFAULT_QUESTIONS: dict[str, str] = {
    "key_moments": "Выдели ключевые моменты.",
    "quiz": "Сделай тест самопроверки.",
    "pitfalls": "Собери ошибки и антипаттерны.",
    "code_summary": "Собери весь код и команды.",
    "chapters": "Сделай оглавление по главам.",
}



# ---------- editable blocks ----------

@dataclass(frozen=True)
class PromptBlock:
    key: str
    group: Literal["audit", "assistant"]
    title: str
    hint: str
    default: str


BLOCKS: dict[str, PromptBlock] = {
    b.key: b
    for b in [
        PromptBlock("audit.role", "audit", "Роль", "Кто пишет аудит и для чего.", ROLE_AUDITOR),
        PromptBlock("audit.style", "audit", "Стиль", "Тон, длина пунктов, запреты.", AUDIT_STYLE),
        PromptBlock("audit.structure_timed", "audit", "Структура (с таймкодами)", "Разделы аудита в формате «С таймкодами».", AUDIT_STRUCTURE_TIMED),
        PromptBlock("audit.structure_plain", "audit", "Структура (без таймкодов)", "Разделы аудита в формате «Без таймкодов».", AUDIT_STRUCTURE_PLAIN),
        PromptBlock("assistant.base", "assistant", "Базовая инструкция", "Как ассистент отвечает по источникам.", ASSISTANT_BASE),
        PromptBlock("assistant.role.qa", "assistant", "Вопрос-ответ", "Свободный вопрос из поля ввода.", ROLE_TASKS["qa"]),
        PromptBlock("assistant.role.key_moments", "assistant", "Ключевое", "Кнопка «Ключевое».", ROLE_TASKS["key_moments"]),
        PromptBlock("assistant.role.pitfalls", "assistant", "Ошибки", "Кнопка «Ошибки».", ROLE_TASKS["pitfalls"]),
        PromptBlock("assistant.role.code_summary", "assistant", "Код", "Кнопка «Код».", ROLE_TASKS["code_summary"]),
        PromptBlock("assistant.role.quiz", "assistant", "Тест", "Кнопка «Тест».", ROLE_TASKS["quiz"]),
        PromptBlock("assistant.role.chapters", "assistant", "Главы", "Кнопка «Главы».", ROLE_TASKS["chapters"]),
        PromptBlock("assistant.compact", "assistant", "Сжатие истории", "Как сворачивать старую часть длинной сессии в сводку.", ASSISTANT_COMPACT),
    ]
}


def text(key: str) -> str:
    """Effective block text: the user's override from settings, else the default."""
    override = SettingsService.get().prompts.get(key, "")
    return override if override.strip() else BLOCKS[key].default


def _structure(timed: bool) -> str:
    return text("audit.structure_timed" if timed else "audit.structure_plain")


def assistant_system(role: str, multi_source: bool) -> str:
    task = text(f"assistant.role.{role}" if f"assistant.role.{role}" in BLOCKS else "assistant.role.qa")
    return "\n".join([
        text("assistant.base"),
        CITATION_MULTI if multi_source else CITATION_SINGLE,
        "ЗАДАЧА: " + task,
    ])


# ---------- Gemini transcription ----------

def gemini_transcription_instruction(language: str, vocabulary: str) -> str:
    lang = {"ru": "in Russian", "en": "in English"}.get(language, f"in {language}" if language and language != "auto" else "in the spoken language")
    vocab = f"\nSpell these terms exactly: {vocabulary.strip()}." if vocabulary.strip() else ""
    return (
        f"Transcribe the audio verbatim {lang}. Do not summarize. Punctuate. "
        "Split into natural phrases of 3–15 seconds. For each phrase return start_time_mm_ss, end_time_mm_ss, text."
        f"{vocab}"
    )
