"""PII redaction harness.

Load-bearing module for the entire system. Every text snippet from any
extractor flows through `redact()` BEFORE:
  - being sent to any LLM (sentiment, summary, topic extraction)
  - being stored in `daily_pages.page_text`
  - being logged or telemetered
  - being used to compute `text_embed`

Architecture (three lines of defense):

  1. Presidio analyzer + anonymizer — NER + regex over the entity list below.
  2. Custom recognizers (presidio.recognizers.CUSTOM_RECOGNIZERS) — domain
     PII Presidio doesn't know about (medications, broker names, codenames).
     Empty in V0; populated as misses surface.
  3. Post-redaction regex validator — sweeps the redacted text for known
     dangerous patterns (SSN, CC, email, phone) that NER might have missed.
     If anything matches, the page is QUARANTINED (not stored in
     daily_pages) and surfaced for review + recognizer tuning.

`DATE_TIME` is intentionally NOT in the entity list. Health data is full of
timestamps; redacting them removes core signal. Extractors are expected to
emit dates as ISO strings, never as natural-language phrases the analyzer
would catch.

Engine instantiation is expensive (~2-3s for spaCy load). The module-level
caches mean it's paid once per process; tests should mock these or use a
session-scoped fixture.
"""

from __future__ import annotations

import re
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from presidio_analyzer import AnalyzerEngine, RecognizerResult
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig
from pydantic import BaseModel, Field

from .recognizers import CUSTOM_RECOGNIZERS

# ─────────────────────── Entity list (V0) ───────────────────────────────────
ENTITIES: list[str] = [
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "LOCATION",
    "CREDIT_CARD",
    "US_BANK_NUMBER",
    "US_SSN",
    "IP_ADDRESS",
    "URL",
    "IBAN_CODE",
    "US_DRIVER_LICENSE",
    "US_PASSPORT",
]

OPERATORS: dict[str, OperatorConfig] = {
    "PERSON":            OperatorConfig("replace", {"new_value": "[PERSON]"}),
    "EMAIL_ADDRESS":     OperatorConfig("replace", {"new_value": "[EMAIL]"}),
    "PHONE_NUMBER":      OperatorConfig("replace", {"new_value": "[PHONE]"}),
    "LOCATION":          OperatorConfig("replace", {"new_value": "[LOCATION]"}),
    "CREDIT_CARD":       OperatorConfig("replace", {"new_value": "[CARD]"}),
    "US_BANK_NUMBER":    OperatorConfig("replace", {"new_value": "[ACCOUNT]"}),
    "US_SSN":            OperatorConfig("replace", {"new_value": "[SSN]"}),
    "IP_ADDRESS":        OperatorConfig("replace", {"new_value": "[IP]"}),
    "URL":               OperatorConfig("replace", {"new_value": "[URL]"}),
    "IBAN_CODE":         OperatorConfig("replace", {"new_value": "[IBAN]"}),
    "US_DRIVER_LICENSE": OperatorConfig("replace", {"new_value": "[DL]"}),
    "US_PASSPORT":       OperatorConfig("replace", {"new_value": "[PASSPORT]"}),
    "DEFAULT":           OperatorConfig("replace", {"new_value": "[REDACTED]"}),
}

DEFAULT_SCORE_THRESHOLD = 0.5

# ─────────────────────── Post-validator patterns ────────────────────────────
# These patterns scan the *redacted* text. If any match, Presidio missed
# something dangerous and the page must NOT be stored unredacted. Matches
# trigger quarantine, not auto-replacement — silent re-redaction would mask
# the recognizer gap.
VALIDATOR_PATTERNS: dict[str, re.Pattern[str]] = {
    "SSN":        re.compile(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b"),
    "CREDIT_CARD": re.compile(
        r"\b(?:\d[ -]?){13,19}\b"
    ),
    "EMAIL":      re.compile(
        r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
    ),
    "PHONE":      re.compile(
        r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"
    ),
}


# ─────────────────────── Public types ───────────────────────────────────────
class RedactionResult(BaseModel):
    """Output of `redact()`. Always returned, even on quarantine.

    `quarantine=True` means the post-validator caught PII Presidio missed;
    the writer should route the row to `daily_pages_quarantine` for review,
    not `daily_pages`.
    """

    text: str
    entities_found: int = 0
    types: list[str] = Field(default_factory=list)
    presidio_version: str | None = None
    quarantine: bool = False
    validator_findings: list[dict[str, Any]] = Field(default_factory=list)


# ─────────────────────── Engine caches ──────────────────────────────────────
# Presidio defaults to `en_core_web_lg` (~500MB). The hackathon ships
# `en_core_web_sm` (~12MB) — adequate for PERSON / LOCATION NER at this
# scale, and the bigger model can be swapped in here for production.
NLP_CONFIG: dict[str, Any] = {
    "nlp_engine_name": "spacy",
    "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
}


@lru_cache(maxsize=1)
def _analyzer() -> AnalyzerEngine:
    """spaCy + Presidio analyzer. Cached because warmup is ~2-3s."""
    nlp_engine = NlpEngineProvider(nlp_configuration=NLP_CONFIG).create_engine()
    engine = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])
    for recognizer in CUSTOM_RECOGNIZERS:
        engine.registry.add_recognizer(recognizer)
    return engine


@lru_cache(maxsize=1)
def _anonymizer() -> AnonymizerEngine:
    return AnonymizerEngine()


@lru_cache(maxsize=1)
def _presidio_version() -> str | None:
    try:
        return version("presidio-analyzer")
    except PackageNotFoundError:
        return None


# ─────────────────────── Public API ─────────────────────────────────────────
def redact(text: str, score_threshold: float = DEFAULT_SCORE_THRESHOLD) -> RedactionResult:
    """Redact PII from `text`.

    Returns a `RedactionResult` with the cleaned text plus stats. The caller
    must check `quarantine` and route accordingly.
    """
    if not text:
        return RedactionResult(text="", presidio_version=_presidio_version())

    results: list[RecognizerResult] = _analyzer().analyze(
        text=text,
        entities=ENTITIES,
        language="en",
        score_threshold=score_threshold,
    )

    anonymized = _anonymizer().anonymize(
        text=text, analyzer_results=results, operators=OPERATORS
    )

    findings = _validate(anonymized.text)

    return RedactionResult(
        text=anonymized.text,
        entities_found=len(results),
        types=sorted({r.entity_type for r in results}),
        presidio_version=_presidio_version(),
        quarantine=bool(findings),
        validator_findings=findings,
    )


def _validate(redacted_text: str) -> list[dict[str, Any]]:
    """Sweep redacted text for patterns Presidio shouldn't have left behind.

    Each finding shape: {type, count, sample}. Sample is the first match
    only and is intentionally redacted in the finding itself (we don't
    log raw PII even in failure paths).
    """
    findings: list[dict[str, Any]] = []
    for pattern_type, pattern in VALIDATOR_PATTERNS.items():
        matches = pattern.findall(redacted_text)
        if matches:
            findings.append(
                {
                    "type": pattern_type,
                    "count": len(matches),
                    "sample": "[REDACTED_FINDING]",
                }
            )
    return findings
