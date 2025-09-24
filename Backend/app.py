from config import create_app, db, jwt
from auth_routes import auth_bp
import models  # ensures models are registered with SQLAlchemy metadata

# --- optional: proxy config to FastAPI search (prevents CORS by using one origin) ---
import os
import requests
from flask import jsonify, request, Response

SEARCH_URL = os.getenv("SEARCH_URL", "http://127.0.0.1:8000")  # FastAPI base

from flask_jwt_extended import jwt_required, get_jwt_identity

app = create_app()
app.register_blueprint(auth_bp)

# Create DB tables on first run (safe for SQLite dev; use migrations in prod)
with app.app_context():
    db.create_all()

# ---------------- JWT error handlers (nicer errors) ----------------
@jwt.unauthorized_loader
def _missing_token(err):
    return jsonify({"msg": "Missing or invalid Authorization header."}), 401

@jwt.invalid_token_loader
def _bad_token(err):
    return jsonify({"msg": "Invalid token."}), 401

@jwt.expired_token_loader
def _expired(jwt_header, jwt_payload):
    return jsonify({"msg": "Token expired."}), 401

# ---------------- Optional permanent /search proxy -----------------
# This lets the browser always talk to Flask (same origin).
# Keep if you want a permanent, no-CORS solution; otherwise remove.

@app.get("/search")
def proxy_search():
    upstream = f"{SEARCH_URL}/search"
    try:
        r = requests.get(
            upstream,
            params=request.args,
            timeout=30,
            headers={"Accept": "application/json"},
        )
        ct = r.headers.get("content-type", "application/json")
        return Response(r.content, status=r.status_code, content_type=ct)
    except requests.RequestException as e:
        return Response(
            response=f'{{"error":"upstream_unreachable","detail":"{str(e)}"}}',
            status=502,
            content_type="application/json",
        )

@app.get("/search/health")
def proxy_search_health():
    try:
        r = requests.get(f"{SEARCH_URL}/health", timeout=10)
        return Response(r.content, status=r.status_code, content_type=r.headers.get("content-type", "application/json"))
    except requests.RequestException as e:
        return Response(f'{{"status":"down","detail":"{str(e)}"}}', 502, content_type="application/json")

# ---------------- Example protected route ----------------
@app.get('/protected/ping')
@jwt_required()
def protected_ping():
    return jsonify({"ok": True, "user_id": get_jwt_identity()}), 200

# ---- add alongside your existing proxy routes ----
@app.get("/health")
def proxy_root_health():
    try:
        r = requests.get(f"{SEARCH_URL}/health", timeout=10)
        return Response(
            r.content,
            status=r.status_code,
            content_type=r.headers.get("content-type", "application/json"),
        )
    except requests.RequestException as e:
        return Response(
            f'{{"status":"down","detail":"{str(e)}"}}',
            502,
            content_type="application/json",
        )


if __name__ == '__main__':
    # For dev, expose on 5001
    app.run(host='0.0.0.0', port=5001, debug=True)
