import json
import logging
import os
import subprocess
import tempfile
import time

logger = logging.getLogger(__name__)

PACKAGE_ID = os.environ.get("SUI_PACKAGE_ID", "")
SUI_NETWORK = os.environ.get("SUI_NETWORK", "testnet")
SUI_GAS_BUDGET = "10000000"


def _run_sui_cmd(args: list, timeout: int = 30) -> dict:
    """Run a sui CLI command and return parsed JSON output."""
    cmd = ["sui"] + args + ["--json"]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            raise RuntimeError(f"sui CLI error: {result.stderr[:300]}")
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        raise RuntimeError("sui CLI timed out after 30s")
    except json.JSONDecodeError as e:
        raise RuntimeError(f"sui CLI returned non-JSON: {result.stdout[:200]}")


def register_leak_on_chain(
    original_hash: str,
    clean_hash: str,
    walrus_blob_id: str,
    agent_log_blob_id: str,
    seal_policy_id: str = "",
) -> dict:
    """
    Calls safeleak::safeleak::register_leak on Sui testnet.
    Returns dict with record_id, tx_digest, explorer_url.
    Non-fatal: returns error dict if Sui is unavailable.
    """
    if not PACKAGE_ID:
        logger.warning("SUI_PACKAGE_ID not set — skipping on-chain registration")
        return {
            "success": False,
            "error": "SUI_PACKAGE_ID not configured",
            "record_id": None,
            "tx_digest": None,
        }

    try:
        # Sui CLI takes vector<u8> args as JSON arrays of byte values
        def str_to_bytes_arg(s: str) -> str:
            return json.dumps(list(s.encode("utf-8")))

        data = _run_sui_cmd([
            "client", "call",
            "--package", PACKAGE_ID,
            "--module", "safeleak",
            "--function", "register_leak",
            "--args",
                str_to_bytes_arg(original_hash),
                str_to_bytes_arg(clean_hash),
                str_to_bytes_arg(walrus_blob_id),
                str_to_bytes_arg(agent_log_blob_id),
                str_to_bytes_arg(seal_policy_id or "pending"),
            "--gas-budget", SUI_GAS_BUDGET,
        ])

        # Extract created object ID from effects
        record_id = None
        for change in data.get("objectChanges", []):
            if change.get("type") == "created" and "LeakRecord" in change.get("objectType", ""):
                record_id = change["objectId"]
                break

        tx_digest = data.get("digest", "")
        explorer_url = f"https://suiscan.xyz/testnet/tx/{tx_digest}"

        logger.info(f"On-chain registration success: {record_id}")
        return {
            "success": True,
            "record_id": record_id,
            "tx_digest": tx_digest,
            "explorer_url": explorer_url,
            "suiscan_object_url": f"https://suiscan.xyz/testnet/object/{record_id}",
        }

    except Exception as e:
        logger.error(f"On-chain registration failed (non-fatal): {e}")
        return {
            "success": False,
            "error": str(e),
            "record_id": None,
            "tx_digest": None,
        }


def grant_access_on_chain(record_object_id: str, journalist_address: str) -> dict:
    """
    Calls safeleak::safeleak::grant_access to issue AccessCap to journalist.
    Returns cap_id (the AccessCap object ID) for use in decryption.
    """
    if not PACKAGE_ID:
        return {"success": False, "error": "SUI_PACKAGE_ID not configured"}

    try:
        data = _run_sui_cmd([
            "client", "call",
            "--package", PACKAGE_ID,
            "--module", "safeleak",
            "--function", "grant_access",
            "--args",
                record_object_id,
                journalist_address,
            "--gas-budget", SUI_GAS_BUDGET,
        ])

        # Extract created AccessCap object ID
        cap_id = None
        for change in data.get("objectChanges", []):
            if change.get("type") == "created" and "AccessCap" in change.get("objectType", ""):
                cap_id = change["objectId"]
                break

        tx_digest = data.get("digest", "")
        return {
            "success": True,
            "tx_digest": tx_digest,
            "cap_id": cap_id,
            "explorer_url": f"https://suiscan.xyz/testnet/tx/{tx_digest}",
        }
    except Exception as e:
        logger.error(f"grant_access failed: {e}")
        return {"success": False, "error": str(e)}


def check_sui_connectivity() -> str:
    """Health check for Sui CLI availability. Returns 'ok' or error string."""
    if not PACKAGE_ID:
        return "unconfigured (SUI_PACKAGE_ID not set)"
    try:
        result = subprocess.run(
            ["sui", "client", "active-address"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            addr = result.stdout.strip()
            return f"ok ({addr[:10]}...)"
        return f"unavailable ({result.stderr[:50]})"
    except FileNotFoundError:
        return "unavailable (sui CLI not installed)"
    except Exception as e:
        return f"unavailable ({str(e)[:50]})"
