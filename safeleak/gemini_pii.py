import json
import logging
import os

import requests

logger = logging.getLogger(__name__)

GITHUB_MODELS_ENDPOINT = "https://models.inference.ai.azure.com/chat/completions"
GITHUB_MODEL = "gpt-4o-mini"


SYSTEM_PROMPT = """You are a PII (Personally Identifiable Information) detection expert.
Analyse the following text and identify ALL instances of sensitive personal information.

Return a JSON array of findings. Each finding must have exactly these fields:
- "type": one of PERSON, EMAIL_ADDRESS, PHONE_NUMBER, LOCATION, DATE_TIME, CREDIT_CARD, IBAN_CODE, CRYPTO, IP_ADDRESS, MEDICAL_LICENSE, NRP, PASSPORT, DRIVER_LICENSE, SSN, BANK_ACCOUNT, URL, USERNAME, PASSWORD, API_KEY, SECRET_KEY, OTHER_PII
- "score": a float between 0.0 and 1.0 representing your confidence
- "method": always "github_models"
- "context": a very brief description of what was found (e.g. "Full name", "UK phone number", "GPS coordinates") — do NOT include the actual value

Return ONLY the JSON array with no markdown, no code fences, no explanation.
If no PII is found, return an empty array: []

Text to analyse:
"""


def analyse_pii_with_gemini(text: str) -> dict:
    """
    Backwards-compatible alias for analyse_pii_with_github_models.
    Returns {"findings": [...], "status": "ok"}
    or {"findings": [], "status": "unavailable", "error": "..."}
    Never raises — always returns a dict so callers can proceed with Presidio results.
    """
    return analyse_pii_with_github_models(text)


def analyse_pii_with_github_models(text: str) -> dict:
    """
    Analyse PII using GitHub Models gpt-4o-mini endpoint.
    Returns {"findings": [...], "status": "ok"}
    or {"findings": [], "status": "unavailable", "error": "..."}
    Never raises — always returns a dict so callers can proceed with Presidio results.
    """
    if not text or not text.strip():
        return {"findings": [], "status": "ok"}

    try:
        token = os.environ.get("GITHUB_TOKEN")
        if not token:
            raise RuntimeError("GITHUB_TOKEN environment variable not set")

        prompt = SYSTEM_PROMPT + text[:8000]
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": GITHUB_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": 1024,
        }

        response = requests.post(
            GITHUB_MODELS_ENDPOINT,
            json=payload,
            headers=headers,
            timeout=10,
        )
        response.raise_for_status()

        data = response.json()
        if not data.get("choices") or not data["choices"][0].get("message"):
            logger.error(f"Unexpected response format: {data}")
            return {"findings": [], "status": "unavailable", "error": "Invalid API response"}

        raw = data["choices"][0]["message"].get("content", "").strip()

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
                "method": "github_models",
                "context": context,
            })

        logger.info(f"GitHub Models PII analysis: {len(result)} findings")
        return {"findings": result, "status": "ok"}

    except json.JSONDecodeError as e:
        logger.error(f"GitHub Models returned non-JSON: {e}")
        return {"findings": [], "status": "unavailable", "error": f"JSON parse error: {e}"}
    except Exception as e:
        logger.error(f"GitHub Models PII analysis failed: {e}")
        return {"findings": [], "status": "unavailable", "error": str(e)}


def check_gemini() -> str:
    """Live connectivity check for GitHub Models. Returns 'ok' or error string."""
    try:
        result = analyse_pii_with_github_models("test")
        return "ok" if result["status"] == "ok" else f"unavailable ({result.get('error', 'unknown')})"
    except Exception as e:
        return f"unavailable ({e})"


def init_gemini() -> str:
    """Initialize GitHub Models. Returns 'loaded' or error string."""
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        logger.warning("GITHUB_TOKEN not set - GitHub Models PII analysis will be unavailable")
        return "unavailable"
    logger.info("GitHub Models initialized with gpt-4o-mini")
    return "loaded"
