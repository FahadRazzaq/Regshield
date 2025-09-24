import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import config from './../../../config.js';
import './LoginPage.css';

// If you have a local logo, import it instead of the dummy URL:
// import logo from '../../assets/logo.svg';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/case';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const response = await fetch(`${config.backendUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.msg || 'Login failed. Please check your credentials.');

      // Persist the token (optionally respect "remember me")
      if (remember) {
        localStorage.setItem('token', data.access_token);
      } else {
        sessionStorage.setItem('token', data.access_token);
      }

      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        {/* Brand / Logo */}
        <div className="brand">
          <img
            className="brand-logo"
            src="https://dummyimage.com/96x96/1877f2/ffffff.png&text=AI"
            alt="RAG.AI Logo"
            width="72"
            height="72"
            loading="eager"
          />
          <div className="brand-text">
            <h1 className="brand-title">RAG.AI Console</h1>
            <p className="brand-subtitle">Sign in to continue</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <div className="input-group">
            <label htmlFor="email">Email</label>
            <input
              autoComplete="email"
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <input
              autoComplete="current-password"
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <div className="form-meta">
            <label className="remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>Remember me</span>
            </label>
            <Link className="forgot" to="/forgot-password">Forgot password?</Link>
          </div>

          {error && <p className="error-message" role="alert">{error}</p>}

          <button type="submit" className="login-button">Log In</button>
        </form>

        <p className="signup-link">
          Don&apos;t have an account? <a href="/signup">Sign Up</a>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
