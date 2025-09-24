# server_app.py
import os, re, json, threading
from dataclasses import dataclass, asdict
from typing import List, Tuple
from collections import Counter

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ---------- PDF parsing ----------
try:
    import PyPDF2
except Exception:
    PyPDF2 = None
try:
    import pdfplumber
except Exception:
    pdfplumber = None

# ---------- .env (force load + override) ----------
from dotenv import load_dotenv, find_dotenv
BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # <-- fix __file__
ENV_PATH = find_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv(ENV_PATH, override=True)

def resolve_env_or_default(key: str, default_filename: str) -> str:
    val = os.environ.get(key)
    # absolute path?
    if val and os.path.isabs(val) and os.path.exists(val):
        return val
    # if provided (possibly "Backend/PDPL.pdf"), try relative to this file
    if val:
        cand = os.path.normpath(os.path.join(BASE_DIR, val))
        if os.path.exists(cand):
            return cand
        # try project root (one level up), just in case
        cand2 = os.path.normpath(os.path.join(os.path.dirname(BASE_DIR), val))
        if os.path.exists(cand2):
            return cand2
    return os.path.join(BASE_DIR, default_filename)

PDPL_PATH = resolve_env_or_default("PDPL_PATH", "PDPL.pdf")
ECC_PATH  = resolve_env_or_default("ECC_PATH",  "ecc-en.pdf")

print(f"[startup] PDPL_PATH = {PDPL_PATH} (exists={os.path.exists(PDPL_PATH)})")
print(f"[startup] ECC_PATH  = {ECC_PATH} (exists={os.path.exists(ECC_PATH)})")

APP_HOST  = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT  = int(os.getenv("APP_PORT", "8000"))
ALLOW_ORIGINS = os.getenv("ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")

# ---------- Files to index ----------
PDFS = [
    (PDPL_PATH, "PDPL (Implementing Regulation)"),
    (ECC_PATH,  "NCA Essential Cybersecurity Controls (ECC-1:2018)"),
]

# ---------- Read PDF ----------
def read_pdf_text(path: str) -> List[Tuple[int, str]]:
    """Return list[(page_no, text)] with non-empty text."""
    pages: List[Tuple[int, str]] = []
    if not os.path.exists(path):
        return pages

    # Try PyPDF2
    if PyPDF2 is not None:
        try:
            with open(path, "rb") as f:
                r = PyPDF2.PdfReader(f)
                for i, page in enumerate(r.pages):
                    try:
                        t = page.extract_text() or ""
                    except Exception:
                        t = ""
                    if t.strip():
                        pages.append((i + 1, t))
        except Exception:
            pass

    # Fallback to pdfplumber if PyPDF2 got nothing
    if not pages and pdfplumber is not None:
        try:
            with pdfplumber.open(path) as pdf:
                for i, page in enumerate(pdf.pages):
                    t = page.extract_text() or ""
                    if t and t.strip():
                        pages.append((i + 1, t))
        except Exception:
            pass

    return pages

def normalize_whitespace(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def split_into_clauses(text: str) -> List[str]:
    # preserve your earlier anchors (Article numbers, ECC codes, etc.)
    t = text.replace("\r", "")
    t = re.sub(r"\n{3,}", "\n\n", t)
    anchors = re.split(
        r"(?=^Article\s+\d+)|(?=^\d-\d-(?:\d|-){1,6}\b)|(?=^[A-Z][A-Za-z \-/()]{5,}\s+\d-\d\b)",
        t, flags=re.MULTILINE
    )
    parts = []
    for seg in anchors:
        seg = seg.strip()
        if not seg:
            continue
        for p in re.split(r"\n{2,}", seg):
            p = normalize_whitespace(p)
            if len(p) > 50:
                parts.append(p)
    return parts

def guess_reference(chunk: str, source_label: str) -> str:
    # keep clause/article inference you had
    m = re.search(r"(Article\s+\d+)(?::?\s*([^\n]+)?)?", chunk, re.IGNORECASE)
    if m:
        title = (m.group(2) or "").strip()
        ref = m.group(1).title()
        return f"{ref}" + (f": {title}" if title else "")
    m2 = re.search(r"\b\d-\d-(?:\d|-){1,6}\b", chunk)  # ECC code-like
    if m2:
        return m2.group(0)
    # fallback: first words
    words = chunk.split()
    return " ".join(words[:8]) + ("..." if len(words) > 8 else "")

# ---------- Data types ----------
@dataclass
class Clause:
    source: str
    filename: str
    page: int
    reference: str
    text: str

class SearchResponseItem(BaseModel):
    source: str
    filename: str
    page: int
    reference: str
    text: str
    score: float

class SearchResponse(BaseModel):
    query: str
    total_matches: int
    returned: int
    results: List[SearchResponseItem]

# ---------- Index caching ----------
INDEX: List[Clause] = []
INDEX_PATH = os.path.join(BASE_DIR, "index.json")

def load_index_from_disk() -> bool:
    global INDEX
    if os.path.exists(INDEX_PATH):
        try:
            with open(INDEX_PATH, "r", encoding="utf-8") as f:
                items = json.load(f)
            INDEX = [Clause(**it) for it in items]
            print(f"[index] loaded cached index: {len(INDEX)} clauses")
            return True
        except Exception as e:
            print(f"[index] failed to load cache: {e}")
    return False

def save_index_to_disk():
    try:
        with open(INDEX_PATH, "w", encoding="utf-8") as f:
            json.dump([asdict(c) for c in INDEX], f, ensure_ascii=False)
        print(f"[index] saved index: {len(INDEX)} clauses")
    except Exception as e:
        print(f"[index] failed to save cache: {e}")

def build_index() -> List[Clause]:
    if load_index_from_disk():
        return INDEX
    clauses: List[Clause] = []
    for path, label in PDFS:
        page_texts = read_pdf_text(path)
        print(f"[index] {label}: {len(page_texts)} pages with text (file={os.path.basename(path)})")
        for page_no, text in page_texts:
            if not text or len(text.strip()) < 20:  # skip empty pages
                continue
            for chunk in split_into_clauses(text):
                ref = guess_reference(chunk, label)
                clauses.append(Clause(
                    source=label,
                    filename=os.path.basename(path),
                    page=page_no,
                    reference=ref,
                    text=chunk
                ))
    print(f"[index] built fresh: {len(clauses)} clauses")
    return clauses

def ensure_index():
    global INDEX
    if not INDEX:
        INDEX = build_index()
        save_index_to_disk()

# ---------- Lexical scoring ----------
def tokenize(s: str):
    return re.findall(r"[a-z0-9]+", s.lower())

def score_clause(clause: Clause, query_tokens, phrase: str) -> float:
    tf = Counter(tokenize(clause.text))
    score = sum(tf.get(t, 0) for t in query_tokens)
    if phrase and phrase in clause.text.lower():
        score += 3.0
    ref = clause.reference.lower()
    score += sum(1.5 for t in query_tokens if t in ref)
    # (keep your earlier optional source-boosts if you want them back)
    return float(score)

# ---------- Semantic / Hybrid (fast model + caching) ----------
import numpy as np
from sentence_transformers import SentenceTransformer

EMBEDDER = None
CLAUSE_EMB = None  # np.ndarray (N, D)
EMBED_DIM = 384    # all-MiniLM-L6-v2

EMB_PATH   = os.path.join(BASE_DIR, "embeddings.npy")
MODEL_NAME = "all-MiniLM-L6-v2"  # fast & good

def get_embedder():
    global EMBEDDER
    if EMBEDDER is None:
        EMBEDDER = SentenceTransformer(MODEL_NAME)
    return EMBEDDER

def clause_repr(c: Clause) -> str:
    body = c.text if len(c.text) < 1200 else c.text[:1200]  # shorter = faster
    return f"{c.source} | {c.reference} | p.{c.page}\n{body}"

def try_load_embeddings_from_disk() -> bool:
    global CLAUSE_EMB
    if os.path.exists(EMB_PATH):
        try:
            arr = np.load(EMB_PATH)
            if len(INDEX) and arr.shape[0] == len(INDEX) and arr.shape[1] == EMBED_DIM:
                CLAUSE_EMB = arr
                print(f"[emb] loaded cached: {CLAUSE_EMB.shape}")
                return True
        except Exception as e:
            print(f"[emb] failed to load cache: {e}")
    return False

def build_embeddings():
    global CLAUSE_EMB
    ensure_index()
    if try_load_embeddings_from_disk():
        return
    if not INDEX:
        CLAUSE_EMB = np.empty((0, EMBED_DIM), dtype=np.float32)
        print("[emb] no clauses; embeddings empty")
        return
    enc = get_embedder()
    texts = [clause_repr(c) for c in INDEX]
    vecs = enc.encode(texts, batch_size=64, normalize_embeddings=True, show_progress_bar=False)
    CLAUSE_EMB = np.asarray(vecs, dtype=np.float32)
    np.save(EMB_PATH, CLAUSE_EMB)
    print(f"[emb] built & saved: {CLAUSE_EMB.shape}")

def ensure_embeddings():
    global CLAUSE_EMB
    if CLAUSE_EMB is None or (len(INDEX) and CLAUSE_EMB.shape[0] != len(INDEX)):
        build_embeddings()

def search_semantic(query: str, top_k: int = 20):
    ensure_index()
    try:
        ensure_embeddings()
    except Exception as e:
        print(f"[emb] ensure_embeddings failed: {e}")
        return []
    if CLAUSE_EMB is None or CLAUSE_EMB.size == 0:
        return []
    enc = get_embedder()
    qv = enc.encode([query], normalize_embeddings=True)
    sims = (CLAUSE_EMB @ qv[0])  # cosine for normalized vectors
    idx = np.argsort(-sims)[:top_k]
    return [(INDEX[i], float(sims[i])) for i in idx]

def search_hybrid(query: str, top_k: int = 20, alpha: float = 0.6):
    q_tokens = tokenize(query)
    # 1) lexical (cheap)
    lex = []
    for c in INDEX:
        s = score_clause(c, q_tokens, query.lower().strip())
        if s > 0:
            lex.append((c, s))
    if lex:
        max_lex = max(s for _, s in lex) or 1.0
        lex = [(c, s / max_lex) for c, s in lex]

    # 2) semantic (over-fetch but keep small for speed)
    sem = search_semantic(query, top_k=max(80, top_k))
    if sem:
        min_s = min(s for _, s in sem)
        max_s = max(s for _, s in sem) or 1.0
        rng = max(max_s - min_s, 1e-6)
        sem = [(c, (s - min_s) / rng) for c, s in sem]

    # 3) merge
    scores = {}
    for c, s in sem:
        scores[id(c)] = scores.get(id(c), 0.0) + alpha * s
    for c, s in lex:
        scores[id(c)] = scores.get(id(c), 0.0) + (1.0 - alpha) * s

    combined = [(c, scores[id(c)]) for c in INDEX if id(c) in scores]
    combined.sort(key=lambda x: x[1], reverse=True)
    return combined[:top_k]

# ---------- FastAPI ----------
from enum import Enum
class Method(str, Enum):
    lexical = "lexical"
    semantic = "semantic"
    hybrid = "hybrid"

# Robust CORS parsing
raw = ALLOW_ORIGINS or ""
origins = ["*"] if raw.strip() == "*" else [o.strip() for o in re.split(r"[,;\s]+", raw) if o.strip()]
print(f"[startup] ALLOW_ORIGINS parsed: {origins}")

app = FastAPI(title="Regulation Clause Search API", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Content-Type", "Authorization"],
)

@app.on_event("startup")
def _startup():
    ensure_index()
    def _bg():
        try:
            build_embeddings()
        except Exception as e:
            print(f"[emb] background build failed: {e}")
    threading.Thread(target=_bg, daemon=True).start()

@app.get("/health")
def health():
    emb_ready = CLAUSE_EMB is not None and CLAUSE_EMB.size > 0
    return {
        "status": "ok",
        "pdpl": os.path.exists(PDPL_PATH),
        "ecc": os.path.exists(ECC_PATH),
        "count": len(INDEX),
        "embeddings_ready": emb_ready
    }

@app.get("/index")
def get_index_preview(limit: int = Query(200, ge=1, le=5000)):
    ensure_index()
    return {"count": len(INDEX), "preview": [asdict(c) for c in INDEX[:limit]]}

@app.get("/search", response_model=SearchResponse)
def search(
    query: str,
    top_k: int = Query(20, ge=1, le=100),
    method: Method = Method.lexical,
    alpha: float = Query(0.6, ge=0.0, le=1.0),
):
    ensure_index()
    if not INDEX:
        return SearchResponse(query=query, total_matches=0, returned=0, results=[])
    if method == Method.lexical:
        q_tokens = tokenize(query)
        scored = []
        for c in INDEX:
            s = score_clause(c, q_tokens, query.lower().strip())
            if s > 0:
                scored.append((c, s))
        scored.sort(key=lambda x: x[1], reverse=True)
    elif method == Method.semantic:
        scored = search_semantic(query, top_k=top_k)
    else:
        scored = search_hybrid(query, top_k=top_k, alpha=alpha)

    total = len(scored)
    top = scored[:top_k]
    results = [SearchResponseItem(**asdict(c), score=round(s, 3)) for c, s in top]
    return SearchResponse(query=query, total_matches=total, returned=len(results), results=results)

@app.post("/reindex")
def reindex():
    """Rebuild index and embeddings; clears caches so next request is fresh."""
    global INDEX, CLAUSE_EMB
    INDEX = build_index()
    save_index_to_disk()
    CLAUSE_EMB = None
    try:
        if os.path.exists(EMB_PATH):
            os.remove(EMB_PATH)
    except Exception:
        pass
    threading.Thread(target=build_embeddings, daemon=True).start()
    return {"status": "ok", "count": len(INDEX)}

if __name__ == "__main__":  # <-- fix __name__
    uvicorn.run("server_app:app", host=APP_HOST, port=APP_PORT, reload=True)
