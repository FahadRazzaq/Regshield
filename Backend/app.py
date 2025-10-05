# app.py
from config import create_app, db, jwt
from auth_routes import auth_bp
import models  # ensure models are registered
from typing import List, Dict, Any  # 3.8-safe generics

import os, requests
from flask import jsonify, request, Response, send_from_directory

# app.py (new imports)
import io
import math
import mimetypes
from werkzeug.utils import secure_filename

# File parsing helpers
try:
    import pdfplumber
except Exception:
    pdfplumber = None

try:
    from docx import Document as DocxDocument
except Exception:
    DocxDocument = None

# Gemini
import google.generativeai as genai


SEARCH_URL = os.getenv("SEARCH_URL", "http://127.0.0.1:8000")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL   = os.getenv("GEMINI_MODEL")
MAX_MATCHES_PER_SECTION = int(os.getenv("MAX_MATCHES_PER_SECTION", "3"))
MAX_SECTIONS            = int(os.getenv("MAX_SECTIONS", "25"))  # safety cap per upload

app = create_app()
app.register_blueprint(auth_bp)

with app.app_context():
    db.create_all()

# ---------- Serve static UI from Backend/ui ----------
UI_DIR = os.path.join(os.path.dirname(__file__), "UI")
print("[ui] serving from:", UI_DIR)

@app.route("/")
def ui_root():
    return send_from_directory(UI_DIR, "login.html")

@app.route("/login.html")
def ui_login():
    return send_from_directory(UI_DIR, "login.html")

@app.route("/index.html")
def ui_index():
    return send_from_directory(UI_DIR, "index.html")

@app.route("/<path:path>")
def ui_assets(path):
    # serves styles.css, images, etc.
    return send_from_directory(UI_DIR, path)

@app.route("/policy-compare.html")
def ui_policy_compare():
    return send_from_directory(UI_DIR, "policy-compare.html")

@app.route("/policy-compare.css")
def ui_policy_compare_css():
    return send_from_directory(UI_DIR, "policy-compare.css")

@app.route("/policy-compare.js")
def ui_policy_compare_js():
    return send_from_directory(UI_DIR, "policy-compare.js")

ALLOWED_EXTS = {"pdf", "docx", "txt"}

def _ext(filename: str) -> str:
    return (filename.rsplit(".", 1)[-1] or "").lower()

def allowed_file(filename: str) -> bool:
    return "." in filename and _ext(filename) in ALLOWED_EXTS

def read_txt_bytes(data: bytes) -> str:
    try:
        return data.decode("utf-8", errors="ignore")
    except Exception:
        return data.decode("latin-1", errors="ignore")

def read_docx_bytes(data: bytes) -> str:
    if DocxDocument is None:
        return ""
    buf = io.BytesIO(data)
    doc = DocxDocument(buf)
    return "\n".join(p.text for p in doc.paragraphs)

def read_pdf_bytes(data: bytes) -> str:
    if pdfplumber is None:
        return ""
    text_parts = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            if t.strip():
                text_parts.append(t)
    return "\n".join(text_parts)

def extract_text_from_upload(filename: str, raw: bytes) -> str:
    ext = _ext(filename)
    if ext == "txt":
        return read_txt_bytes(raw)
    if ext == "docx":
        return read_docx_bytes(raw)
    if ext == "pdf":
        return read_pdf_bytes(raw)
    # best-effort by MIME
    mt, _ = mimetypes.guess_type(filename)
    if mt and "text" in mt:
        return read_txt_bytes(raw)
    return ""

# --- Deduplicate search matches by (source, reference, page) keeping the best score ---
from typing import List, Dict, Any, Tuple

def _dedupe_matches(items: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    best: Dict[Tuple[str, str, int], Dict[str, Any]] = {}
    for m in items or []:
        key = (m.get("source") or "", m.get("reference") or "", int(m.get("page") or 0))
        if key not in best or float(m.get("score") or 0.0) > float(best[key].get("score") or 0.0):
            best[key] = m
    # sort by score desc to keep strongest first, then trim
    out = sorted(best.values(), key=lambda x: -float(x.get("score") or 0.0))
    return out[:max(1, limit)]

import re
def normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()

def split_policy_into_sections(text: str) -> list[dict]:
    """
    Heuristic: split by H2-ish headings or blank lines; keep sections > 240 chars.
    """
    t = text.replace("\r", "")
    # promote headings (lines in ALL CAPS or numbered headings) as split anchors
    tagged = re.sub(r"(?m)^(?P<h>([A-Z][A-Z0-9 ._-]{6,}|(\d+(\.\d+){0,3})[^\n]{0,60}))\s*$",
                    r"\n\n### \g<h>\n\n", t)
    # split on double blank lines
    raw_sections = re.split(r"\n{2,}", tagged)
    out = []
    idx = 1
    for seg in raw_sections:
        seg = normalize_ws(seg)
        if len(seg) >= 240:
            title = None
            m = re.match(r"^###\s+(.{3,120})", seg)
            if m:
                title = m.group(1).strip()
            out.append({"id": idx, "title": title, "text": seg})
            idx += 1
    return out

def call_gemini_compare(policy_excerpt: str, matches: list[dict]) -> str:
    """
    Returns Markdown with a side-by-side style comparison table.
    """
    if not GEMINI_API_KEY:
        return "_(Gemini disabled — set GEMINI_API_KEY)_"

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    # Compose a compact prompt
    reg_rows = []
    for m in matches:
        label = f'{m.get("source", "")} — {m.get("reference", "")} (p.{m.get("page", "")})'
        reg_rows.append(f"- **{label}**\n  {m.get('text','')[:1200]}")

    prompt = f"""
You are a compliance analyst.  Compare the POLICY EXCERPT with the matched REGULATORY CLAUSES.
Return concise Markdown with a two-column table: (Return **only one** Markdown table and **nothing else** (no headings, no paragraphs, no lists before or after).
The table must start **exactly** with:)

Columns:
- **Policy** (quote the key sentence(s))
- **Regulation** (source + reference)
- **Verdict** (Aligns / Partially aligns / Conflicts / Gap)
- **Notes** (brief, specific)

Only include the most relevant {len(matches)} clauses below.

POLICY EXCERPT:
\"\"\"{policy_excerpt[:4000]}\"\"\"

REGULATORY CLAUSES:
{chr(10).join(reg_rows)}
"""

    try:
        resp = model.generate_content(prompt)
        return (resp.text or "").strip() if hasattr(resp, "text") else str(resp).strip()
    except Exception as e:
        return f"_Gemini error: {e}_"


# ---------- JWT error helpers ----------
@jwt.unauthorized_loader
def _missing_token(err): return jsonify({"msg": "Missing or invalid Authorization header."}), 401
@jwt.invalid_token_loader
def _bad_token(err): return jsonify({"msg": "Invalid token."}), 401
@jwt.expired_token_loader
def _expired(h, p): return jsonify({"msg": "Token expired."}), 401

# ---------- Proxy: /search -> FastAPI ----------
@app.get("/search")
def proxy_search():
    upstream = f"{SEARCH_URL}/search"
    try:
        r = requests.get(upstream, params=request.args, timeout=30, headers={"Accept": "application/json"})
        return Response(r.content, status=r.status_code, content_type=r.headers.get("content-type", "application/json"))
    except requests.RequestException as e:
        app.logger.error("Upstream search failed (to %s): %s", upstream, e)
        return Response(f'{{"error":"upstream_unreachable","detail":"{str(e)}"}}', 502, content_type="application/json")

@app.get("/health")
def proxy_root_health():
    try:
        r = requests.get(f"{SEARCH_URL}/health", timeout=10)
        return Response(r.content, status=r.status_code, content_type=r.headers.get("content-type", "application/json"))
    except requests.RequestException as e:
        return Response(f'{{"status":"down","detail":"{str(e)}"}}', 502, content_type="application/json")

# Example protected route
from flask_jwt_extended import jwt_required, get_jwt_identity
@app.get('/protected/ping')
@jwt_required()
def protected_ping():
    return jsonify({"ok": True, "user_id": get_jwt_identity()}), 200

from flask_jwt_extended import jwt_required

@app.post("/compare/policy")
@jwt_required()
def compare_policy():
    """
    Multipart/form-data:
      - file: the uploaded policy (pdf, docx, txt)
      - method (optional): lexical|semantic|hybrid (default hybrid)
      - top_k (optional): int per section (default MAX_MATCHES_PER_SECTION)
    """
    if "file" not in request.files:
        return jsonify({"error": "no_file", "msg": "Please upload a policy file."}), 400

    f = request.files["file"]
    filename = secure_filename(f.filename or "policy.txt")
    if not allowed_file(filename):
        return jsonify({"error": "bad_ext", "msg": f"Allowed: {', '.join(sorted(ALLOWED_EXTS))}"}), 400

    raw = f.read()
    text = extract_text_from_upload(filename, raw) or ""
    if len(text.strip()) < 50:
        return jsonify({"error": "empty_text", "msg": "Could not extract text from file."}), 422

    sections = split_policy_into_sections(text)
    if not sections:
        # fallback: treat whole doc as one section
        sections = [{"id": 1, "title": None, "text": normalize_ws(text)}]

    sections = sections[:MAX_SECTIONS]

    method = request.form.get("method", "hybrid")
    try:
        top_k = int(request.form.get("top_k", str(MAX_MATCHES_PER_SECTION)))
        top_k = max(1, min(8, top_k))
    except Exception:
        top_k = MAX_MATCHES_PER_SECTION

    compared = []
    # Query your FastAPI search per section
    for sec in sections:
        q = sec["text"][:500]  # short query improves speed/precision
        try:
            r = requests.get(
                f"{SEARCH_URL}/search",
                params={"query": q, "top_k": top_k, "method": method, "alpha": 0.6},
                timeout=40,
                headers={"Accept": "application/json"},
            )
            r.raise_for_status()
            data = r.json()
            results_raw = data.get("results", [])
            results = _dedupe_matches(results_raw, top_k)
        except Exception as e:
            results = []
            app.logger.error("Search failed for section %s: %s", sec["id"], e)

        # Build Gemini comparison per section
        mini = [
            {
                "source": m.get("source"),
                "filename": m.get("filename"),
                "page": m.get("page"),
                "reference": m.get("reference"),
                "text": m.get("text"),
                "score": m.get("score"),
            }
            for m in results
        ]
        md = call_gemini_compare(sec["text"], mini) if mini else "_No relevant matches found._"

        compared.append({
            "section_id": sec["id"],
            "title": sec["title"],
            "policy_excerpt": sec["text"],
            "matches": mini,
            "ai_comparison_markdown": md,
        })

    return jsonify({
        "filename": filename,
        "sections_compared": len(compared),
        "method": method,
        "top_k": top_k,
        "items": compared,
    }), 200


if __name__ == '__main__':
    # IMPORTANT: run on 127.0.0.1 so your .bat browser link works
    app.run(host='127.0.0.1', port=5001, debug=True)
