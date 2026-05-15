import json
import logging
import os
import subprocess
import tempfile

from dotenv import load_dotenv

# Load .env BEFORE reading environment variables
load_dotenv()

logger = logging.getLogger(__name__)

SEAL_HELPER_DIR = os.path.join(os.path.dirname(__file__), '..', 'seal-helper')
PACKAGE_ID = os.environ.get("SUI_PACKAGE_ID", "")


def _ensure_seal_deps():
    """Install seal-helper npm deps if not present."""
    node_modules = os.path.join(SEAL_HELPER_DIR, 'node_modules')
    if not os.path.exists(node_modules):
        logger.info("Installing seal-helper npm dependencies...")
        subprocess.run(
            ['npm', 'install'],
            cwd=SEAL_HELPER_DIR,
            capture_output=True,
            check=True,
        )


def encrypt_with_seal(clean_bytes: bytes, policy_id: str) -> dict:
    """
    Encrypts clean_bytes using Seal, tied to policy_id (the LeakRecord object ID).
    
    Returns:
        {"success": True, "encrypted_bytes": bytes, "policy_id": str}
        {"success": False, "error": str, "encrypted_bytes": clean_bytes}  # fallback
    
    Never raises — falls back to unencrypted if Seal is unavailable.
    """
    if not PACKAGE_ID:
        logger.warning("SUI_PACKAGE_ID not set — skipping Seal encryption")
        return {
            "success": False,
            "error": "SUI_PACKAGE_ID not configured",
            "encrypted_bytes": clean_bytes,
            "seal_used": False,
        }

    if not policy_id or policy_id == "pending":
        logger.warning("No policy_id provided — skipping Seal encryption")
        return {
            "success": False,
            "error": "No policy_id — register on-chain first",
            "encrypted_bytes": clean_bytes,
            "seal_used": False,
        }

    try:
        _ensure_seal_deps()

        # Write clean bytes to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
            f.write(clean_bytes)
            input_path = f.name

        output_path = input_path + '.sealed'

        env = os.environ.copy()
        env['SUI_PACKAGE_ID'] = PACKAGE_ID

        result = subprocess.run(
            ['node', 'seal_encrypt.js', input_path, policy_id, output_path],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=SEAL_HELPER_DIR,
            env=env,
        )

        # Clean up input temp file
        try:
            os.unlink(input_path)
        except Exception:
            pass

        if result.returncode != 0:
            err_text = result.stderr.strip() or result.stdout.strip()
            # Try to parse JSON error from stderr
            try:
                err_data = json.loads(err_text)
                err_msg = err_data.get("error", err_text)
            except Exception:
                err_msg = err_text[:200]
            raise RuntimeError(f"seal_encrypt.js failed: {err_msg}")

        output_data = json.loads(result.stdout.strip())
        if not output_data.get("success"):
            raise RuntimeError(output_data.get("error", "Unknown Seal error"))

        with open(output_path, 'rb') as f:
            encrypted_bytes = f.read()

        try:
            os.unlink(output_path)
        except Exception:
            pass

        logger.info(f"Seal encryption success: {len(clean_bytes)} → {len(encrypted_bytes)} bytes")
        return {
            "success": True,
            "encrypted_bytes": encrypted_bytes,
            "policy_id": policy_id,
            "seal_used": True,
            "original_size": len(clean_bytes),
            "encrypted_size": len(encrypted_bytes),
        }

    except Exception as e:
        logger.error(f"Seal encryption failed (non-fatal, uploading unencrypted): {e}")
        # Graceful fallback — upload without Seal rather than failing the whole scrub
        return {
            "success": False,
            "error": str(e),
            "encrypted_bytes": clean_bytes,
            "seal_used": False,
        }


def check_seal_availability() -> str:
    """Health check for Seal. Returns 'ok' or error string."""
    if not PACKAGE_ID:
        return "unconfigured (SUI_PACKAGE_ID not set)"
    try:
        _ensure_seal_deps()
        result = subprocess.run(
            ['node', '--version'],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            return f"available (node {result.stdout.strip()})"
        return "unavailable (node not found)"
    except Exception as e:
        return f"unavailable ({str(e)[:50]})"
