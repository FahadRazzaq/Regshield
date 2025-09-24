from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from sqlalchemy.exc import IntegrityError
from config import db
from models import User

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

# POST /auth/login
@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json(force=True)
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not email or not password:
        return jsonify({"msg": "Email and password are required."}), 400

    user = User.query.filter_by(email=email).first()
    if user is None or not user.check_password(password):
        return jsonify({"msg": "Invalid email or password."}), 401

    additional_claims = {"username": user.username, "email": user.email}
    # ⬇️ Make identity a STRING
    token = create_access_token(identity=str(user.id), additional_claims=additional_claims)

    return jsonify({"access_token": token}), 200


# GET /auth/me
@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def me():
    user_id = get_jwt_identity()
    # ⬇️ Cast back to int (optional, but your PK is int)
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return jsonify({"msg": "Invalid token subject."}), 422

    user = User.query.get(user_id)
    if not user:
        return jsonify({"msg": "User not found."}), 404

    return jsonify({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "phone_number": user.phone_number,
    }), 200
