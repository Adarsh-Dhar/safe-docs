import base64
import hashlib
import io
import json
import logging
import os
import uuid

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_file
from flask_cors import CORS

from scrubber import ScrubberAgent
from walrus_client import check_walrus_connectivity, upload_to_walrus

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

SUPPORTED_EXTENSIONS = {"pdf", "docx", "jpg", "jpeg", "png", "txt"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

# ── Job persistence ────────────────────────────────────────────────────────────
# Try Replit DB first; fall back to in-memory dict so the app works anywhere.
try:
    from replit import db as _replit_db
    _USE_REPLIT_DB = True
    logger.info("Job persistence: Replit DB")
except Exception:
    _replit_db = {}
    _USE_REPLIT_DB = False
    logger.info("Job persistence: in-memory (Replit DB unavailable)")

_MEMORY_JOBS: dict = {}  # fallback


def _save_job(job_id: str, job_data: dict) -> None:
    serialisable = {k: v for k, v in job_data.items() if k != "clean_bytes"}
    if "clean_bytes" in job_data:
        serialisable["clean_bytes_b64"] = base64.b64encode(job_data["clean_bytes"]).decode()
    try:
        if _USE_REPLIT_DB:
            _replit_db[f"job:{job_id}"] = json.dumps(serialisable)
        else:
            _MEMORY_JOBS[job_id] = job_data  # keep bytes in memory
    except Exception as e:
        logger.warning(f"DB save failed, falling back to memory: {e}")
        _MEMORY_JOBS[job_id] = job_data


def _load_job(job_id: str) -> dict | None:
    # Check memory first (covers in-memory fallback AND current-session Replit DB writes)
    if job_id in _MEMORY_JOBS:
        return _MEMORY_JOBS[job_id]
    try:
        if _USE_REPLIT_DB:
            raw = _replit_db.get(f"job:{job_id}")
            if raw:
                data = json.loads(str(raw))
                if "clean_bytes_b64" in data:
                    data["clean_bytes"] = base64.b64decode(data["clean_bytes_b64"])
                    del data["clean_bytes_b64"]
                return data
    except Exception as e:
        logger.warning(f"DB load failed: {e}")
    return None


# ── Startup ────────────────────────────────────────────────────────────────────
logger.info("Initialising ScrubberAgent (idle mode — agent loads on first document)...")
try:
    scrubber = ScrubberAgent()  # Just creates the object, loads nothing
    logger.info("Server ready — agent idle, waiting for document upload")
except Exception as e:
    logger.error(f"Failed to create ScrubberAgent: {e}")
    scrubber = None

from gemini_pii import check_gemini


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
@app.route("/api/health")
def health():
    agent_state = "loaded" if scrubber and scrubber._analyzer is not None else "idle"
    return jsonify({
        "status": "ok",
        "agent_state": agent_state,
        "presidio": "loaded" if scrubber and scrubber._analyzer is not None else "idle",
        "spacy": "loaded" if scrubber and scrubber._analyzer is not None else "idle",
        "gemini": check_gemini(),
        "walrus": check_walrus_connectivity(),
    })


@app.route("/scrub", methods=["POST"])
@app.route("/api/scrub", methods=["POST"])
def scrub():
    if scrubber is None:
        return jsonify({"error": "ScrubberAgent failed to initialize. Check logs for details."}), 500

    if "document" not in request.files:
        return jsonify({"error": "No file uploaded. Use field name 'document'."}), 400

    file = request.files["document"]
    filename = file.filename or "upload.bin"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in SUPPORTED_EXTENSIONS:
        return jsonify({"error": "Unsupported file type. Use PDF, DOCX, TXT, JPG, or PNG."}), 400

    file_bytes = file.read()

    if len(file_bytes) == 0:
        return jsonify({"error": "Uploaded file is empty (0 bytes)."}), 400

    if len(file_bytes) > MAX_FILE_SIZE:
        return jsonify({"error": "File exceeds 10 MB limit."}), 400

    original_hash = hashlib.sha256(file_bytes).hexdigest()

    result = scrubber.scrub(file_bytes, filename)
    if "error" in result:
        err_msg = result["error"]
        is_parse_error = any(k in err_msg.lower() for k in (
            "could not parse", "corrupted", "password", "not a valid"
        ))
        return jsonify({"error": err_msg}), 422 if is_parse_error else 500

    clean_bytes: bytes = result["clean_bytes"]
    clean_hash = hashlib.sha256(clean_bytes).hexdigest()
    gemini_status = result.get("gemini_status", "unavailable")

    walrus_result = upload_to_walrus(clean_bytes)
    walrus_blob_id = walrus_result.get("blob_id")
    walrus_url = walrus_result.get("url")
    walrus_error = None if walrus_result.get("success") else (
        walrus_result.get("error", "Walrus upload failed — document scrubbed successfully but not stored")
    )

    job_id = str(uuid.uuid4())
    _save_job(job_id, {
        "original_hash": original_hash,
        "clean_hash": clean_hash,
        "metadata_removed": result["metadata_removed"],
        "pii_found": result["pii_found"],
        "walrus_blob_id": walrus_blob_id,
        "clean_bytes": clean_bytes,
        "filename": filename,
    })

    response = {
        "job_id": job_id,
        "original_filename": filename,
        "original_hash": original_hash,
        "clean_hash": clean_hash,
        "metadata_removed": result["metadata_removed"],
        "pii_found": result["pii_found"],
        "pii_count": result["pii_count"],
        "gemini_status": gemini_status,
        "walrus_blob_id": walrus_blob_id,
        "walrus_url": walrus_url,
        "status": "success",
    }
    if walrus_error:
        response["walrus_error"] = walrus_error

    return jsonify(response)


@app.route("/download/<job_id>")
@app.route("/api/download/<job_id>")
def download(job_id: str):
    job = _load_job(job_id)
    if not job:
        return jsonify({"error": "Job not found or expired."}), 404

    clean_bytes: bytes = job["clean_bytes"]
    filename: str = job["filename"]
    base, dot, ext = filename.rpartition(".")
    clean_filename = f"{base}_clean{dot}{ext}" if dot else f"{filename}_clean"

    return send_file(
        io.BytesIO(clean_bytes),
        as_attachment=True,
        download_name=clean_filename,
        mimetype="application/octet-stream",
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
