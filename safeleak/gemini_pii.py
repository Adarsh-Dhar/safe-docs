import json
import logging
import os

import google.generativeai as genai

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"

_model = None


def _get_model():
    global _model
    if _model is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY environment variable not set")
        genai.configure(api_key=api_key)
        _model = genai.GenerativeModel(GEMINI_MODEL)
        logger.info(f"Gemini model loaded: {GEMINI_MODEL}")
    return _model


SYSTEM_PROMPT = """You are a PII (Personally Identifiable Information) detection expert.
Analyse the following text and identify ALL instances of sensitive personal information.

Return a JSON array of findings. Each finding must have exactly these fields:
- "type": one of PERSON, EMAIL_ADDRESS, PHONE_NUMBER, LOCATION, DATE_TIME, CREDIT_CARD, IBAN_CODE, CRYPTO, IP_ADDRESS, MEDICAL_LICENSE, NRP, PASSPORT, DRIVER_LICENSE, SSN, BANK_ACCOUNT, URL, USERNAME, PASSWORD, API_KEY, SECRET_KEY, OTHER_PII
- "score": a float between 0.0 and 1.0 representing your confidence
- "method": always "gemini"
- "context": a very brief description of what was found (e.g. "Full name", "UK phone number", "GPS coordinates") — do NOT include the actual value

Return ONLY the JSON array with no markdown, no code fences, no explanation.
If no PII is found, return an empty array: []

Text to analyse:
"""


def analyse_pii_with_gemini(text: str) -> dict:
    """
    Returns {"findings": [...], "status": "ok"}
    or {"findings": [], "status": "unavailable", "error": "..."}
    Never raises — always returns a dict so callers can proceed with Presidio results.
    """
    if not text or not text.strip():
        return {"findings": [], "status": "ok"}

    try:
        model = _get_model()
        prompt = SYSTEM_PROMPT + text[:8000]
        response = model.generate_content(prompt)
        raw = response.text.strip()

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        findings = json.loads(raw)
        if not isinstance(findings, list):
            return {"findings": [], "status": "ok"}

        result = []
        for f in findings:
            if not isinstance(f, dict):
                continue
            entity_type = str(f.get("type", "OTHER_PII")).upper()
            score = float(f.get("score", 0.7))
            score = max(0.0, min(1.0, score))
            context = str(f.get("context", ""))
            result.append({
                "type": entity_type,
                "text": "[REDACTED]",
                "score": round(score, 3),
                "method": "gemini",
                "context": context,
            })

        logger.info(f"Gemini PII analysis: {len(result)} findings")
        return {"findings": result, "status": "ok"}

    except json.JSONDecodeError as e:
        logger.error(f"Gemini returned non-JSON: {e}")
        return {"findings": [], "status": "unavailable", "error": f"JSON parse error: {e}"}
    except Exception as e:
        logger.error(f"Gemini PII analysis failed: {e}")
        return {"findings": [], "status": "unavailable", "error": str(e)}


def check_gemini() -> str:
    """Live connectivity check — sends a minimal prompt. Returns 'ok' or error string."""
    try:
        result = analyse_pii_with_gemini("test")
        return "ok" if result["status"] == "ok" else f"unavailable ({result.get('error', 'unknown')})"
    except Exception as e:
        return f"unavailable ({e})"


def init_gemini() -> str:
    """Load the model at startup. Returns 'loaded' or error string."""
    try:
        _get_model()
        return "loaded"
    except Exception as e:
        logger.error(f"Gemini init failed: {e}")
        return f"error: {e}"
