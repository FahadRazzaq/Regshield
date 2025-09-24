from config import create_app, db, jwt
from auth_routes import auth_bp
import models  # ensure models are registered

import os, requests
from flask import jsonify, request, Response
from flask_jwt_extended import jwt_required, get_jwt_identity

SEARCH_URL = os.getenv("SEARCH_URL", "http://127.0.0.1:8000")

app = create_app()
app.register_blueprint(auth_bp)

with app.app_context():
    db.create_all()

# JWT error helpers
@jwt.unauthorized_loader
def _missing_token(err): return jsonify({"msg": "Missing or invalid Authorization header."}), 401
@jwt.invalid_token_loader
def _bad_token(err): return jsonify({"msg": "Invalid token."}), 401
@jwt.expired_token_loader
def _expired(h, p): return jsonify({"msg": "Token expired."}), 401

# Proxy: /search -> FastAPI
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

# Example protected ping
@app.get('/protected/ping')
@jwt_required()
def protected_ping():
    return jsonify({"ok": True, "user_id": get_jwt_identity()}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
