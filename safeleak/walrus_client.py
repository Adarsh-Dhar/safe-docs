import logging

import requests

logger = logging.getLogger(__name__)

WALRUS_PUBLISHER = "https://publisher.walrus-testnet.walrus.space"
WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space"
WALRUS_EXPLORER = "https://walruscan.com/testnet/blob"


def upload_to_walrus(file_bytes: bytes, epochs: int = 5) -> dict:
    url = f"{WALRUS_PUBLISHER}/v1/blobs?epochs={epochs}"
    try:
        response = requests.put(
            url,
            data=file_bytes,
            headers={"Content-Type": "application/octet-stream"},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()

        blob_id = None
        if "newlyCreated" in data:
            blob_id = data["newlyCreated"]["blobObject"]["blobId"]
        elif "alreadyCertified" in data:
            blob_id = data["alreadyCertified"]["blobId"]
        else:
            raise ValueError(f"Unexpected Walrus response structure: {list(data.keys())}")

        blob_url = f"{WALRUS_AGGREGATOR}/v1/blobs/{blob_id}"
        explorer_url = f"{WALRUS_EXPLORER}/{blob_id}"
        logger.info(f"Walrus upload success: {blob_id}")
        return {"blob_id": blob_id, "url": blob_url, "explorer_url": explorer_url, "success": True}

    except Exception as e:
        logger.error(f"Walrus upload failed: {e}")
        return {"blob_id": None, "url": None, "explorer_url": None, "success": False, "error": str(e)}


def retrieve_from_walrus(blob_id: str) -> bytes:
    url = f"{WALRUS_AGGREGATOR}/v1/blobs/{blob_id}"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.content


def check_walrus_connectivity() -> str:
    """Ping the Walrus aggregator API endpoint. Returns 'ok' or a description of the issue."""
    try:
        response = requests.get(
            f"{WALRUS_AGGREGATOR}/v1/api",
            timeout=5,
        )
        if response.status_code == 200:
            return "ok"
        return f"degraded (HTTP {response.status_code})"
    except requests.exceptions.Timeout:
        return "unavailable (timeout)"
    except Exception as e:
        return f"unavailable ({str(e)[:60]})"
