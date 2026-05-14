# SafeLeak MVP

A document metadata scrubber and decentralised storage tool for the Sui Overflow 2026 hackathon. Users upload a document; SafeLeak strips all metadata, runs AI-powered PII detection, and uploads the sanitised file to Walrus decentralised storage.

## Run & Operate

- `cd safeleak && python main.py` — run the Flask app (port 8000)
- Workflow: `SafeLeak` — configured and running via Replit
- Health check: `curl http://localhost:8000/health`
- spaCy model (run once): `python -m spacy download en_core_web_lg`

## Stack

- Backend: Python 3.11, Flask, flask-cors
- AI/NLP: Microsoft Presidio (presidio-analyzer, presidio-anonymizer), spaCy en_core_web_lg
- File parsing: PyMuPDF (fitz), python-docx, Pillow
- Storage: Walrus Testnet HTTP API (PUT /v1/blobs)
- Frontend: Single HTML file, vanilla JS + CSS (no frameworks)
- Database: None — in-memory JOBS dict keyed by UUID job_id

## Where things live

- `safeleak/main.py` — Flask app, all routes, in-memory JOBS store
- `safeleak/scrubber.py` — ScrubberAgent class: metadata stripping + Presidio PII detection
- `safeleak/walrus_client.py` — Walrus Testnet upload/retrieve via requests.put()
- `safeleak/templates/index.html` — Full frontend SPA: upload zone, pipeline UI, report cards
- `safeleak/requirements.txt` — Python dependencies
- `safeleak/.env` — OPENAI_API_KEY placeholder (reserved for future)

## API Routes

Note: Routes use `/scrub`, `/health`, `/download/<id>` (not `/api/` prefix) to avoid proxy conflict with the Node.js api-server at `/api`.

- `GET /` — serves index.html
- `GET /health` — returns presidio/spacy status
- `POST /scrub` — accepts `document` file, returns full scrub report JSON
- `GET /download/<job_id>` — returns clean file bytes for download

## Architecture decisions

- Presidio AnalyzerEngine loaded ONCE at startup (not per-request) — takes 3-5s, subsequent requests are fast.
- Flask routes avoid `/api/` prefix because the monorepo proxy routes that path to the Node.js api-server.
- In-memory JOBS dict stores clean bytes for download; no DB needed for MVP.
- Walrus upload failure is non-fatal — scrub result is always returned even if storage fails.
- Image stripping uses pixel-copy approach (new image from data) to guarantee EXIF removal.

## Product

Upload PDF, DOCX, TXT, JPG, or PNG → strip all structural metadata (EXIF, PDF properties, author, GPS) → AI PII scan (PERSON, EMAIL, PHONE, LOCATION, CREDIT_CARD, CRYPTO, IP, etc.) → SHA-256 integrity hashes → upload clean file to Walrus Testnet → return blobId as verifiable receipt → download sanitised document.

## Gotchas

- spaCy en_core_web_lg must be downloaded once: `python -m spacy download en_core_web_lg`
- Flask runs on port 8000; the shared proxy routes `/api/*` to the Node.js api-server on 8080 — do not use `/api/` prefix for Flask routes.
- Walrus testnet may be slow or unavailable; always returns scrub result regardless.
