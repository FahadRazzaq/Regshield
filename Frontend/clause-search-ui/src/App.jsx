import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_URL  = import.meta.env.VITE_API_URL     || "http://127.0.0.1:5001"; // Flask proxy -> FastAPI
const AUTH_URL = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:5001"; // Flask auth

// --- helpers ---
function highlight(txt, q) {
  if (!q || !txt) return txt || "";
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "ig");
  return String(txt).split(re).map((p, i) => i % 2 ? <mark key={i}>{p}</mark> : p);
}
function parseJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    return JSON.parse(json);
  } catch { return null; }
}
function isExpired(token) {
  const p = parseJwt(token);
  if (!p || !p.exp) return true;
  return Date.now() >= p.exp * 1000;
}

// --- UI ---
function Badge({ children }) {
  return <span className="badge">{children}</span>;
}

function ResultCard({ item, query }) {
  const c = item;
  const citation = `${c.source} • ${c.reference} • p.${c.page}`;
  const copyCitation = async () => {
    try { await navigator.clipboard.writeText(citation); } catch {}
  };
  return (
    <div className="card">
      <div className="card__head">
        <div className="card__title">{c.source}</div>
        <div className="score">score {Number(c.score).toFixed(2)}</div>
      </div>
      <div className="badges">
        <Badge>{c.reference || "Reference"}</Badge>
        <Badge>p.{c.page}</Badge>
        <Badge>{c.filename}</Badge>
      </div>
      <p className="card__text">{highlight(c.text || "⚠️ No text extracted.", query)}</p>
      <div className="card__actions">
        <button className="btn" onClick={copyCitation}>Copy citation</button>
      </div>
    </div>
  );
}

function LoginView({ onLoggedIn }) {
  const [email, setEmail] = useState(""); 
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(""); 
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const res = await fetch(`${AUTH_URL}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.msg || `HTTP ${res.status}`);
      if (!data.access_token) throw new Error("No access token returned");
      localStorage.setItem("token", data.access_token);
      onLoggedIn(data.access_token);
    } catch (e) { setErr(e.message || "Login failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="app-layout" style={{ display: "grid", placeItems: "center" }}>
      <form onSubmit={submit} className="login-box" style={{ width: 360, marginTop: 80 }}>
        <h2>Welcome back</h2>
        <p className="muted" style={{ marginBottom: 12 }}>Please log in to continue.</p>
        <div className="input-group" style={{ marginBottom: 10 }}>
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required />
        </div>
        <div className="input-group" style={{ marginBottom: 10 }}>
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required />
        </div>
        {err && <div className="error">Error: {err}</div>}
        <button type="submit" disabled={loading}>{loading ? "Logging in…" : "Log in"}</button>
      </form>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const payload = token ? parseJwt(token) : null;

  // validate token via /auth/me
  useEffect(() => {
    let cancelled = false;
    async function validate() {
      if (!token || isExpired(token)) {
        localStorage.removeItem("token"); if (!cancelled) { setAuthed(false); setAuthChecked(true); }
        return;
      }
      try {
        const res = await fetch(`${AUTH_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` }});
        if (!res.ok) throw new Error();
        if (!cancelled) { setAuthed(true); setAuthChecked(true); }
      } catch {
        localStorage.removeItem("token");
        if (!cancelled) { setAuthed(false); setAuthChecked(true); }
      }
    }
    validate(); return () => { cancelled = true; };
  }, [token]);

  // search state
  const [query, setQuery] = useState("data breach notification 72 hours PDPL");
  const [method, setMethod] = useState("hybrid");
  const [alpha, setAlpha] = useState(0.6);
  const [topK, setTopK] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState([]);
  const [totalMatches, setTotalMatches] = useState(0);

  const sources = useMemo(() => Array.from(new Set(results.map(r => r.source))).sort(), [results]);
  const [sourceFilter, setSourceFilter] = useState(new Set());
  const filtered = useMemo(() => {
    if (!sourceFilter.size) return results;
    return results.filter(r => sourceFilter.has(r.source));
  }, [results, sourceFilter]);
  const pageItems = filtered.slice(0, topK);

  async function runSearch(e) {
    if (e) e.preventDefault();
    if (!query.trim() || !authed) return;
    setLoading(true); setError("");
    try {
      const url = new URL(`${API_URL}/search`);
      url.searchParams.set("query", query);
      url.searchParams.set("top_k", String(topK));
      url.searchParams.set("method", method);
      if (method === "hybrid") url.searchParams.set("alpha", String(alpha));

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(Array.isArray(data.results) ? data.results : []);
      setTotalMatches(typeof data.total_matches === "number" ? data.total_matches : 0);
    } catch (err) {
      setError(err?.message || String(err));
    } finally { setLoading(false); }
  }

  useEffect(() => { if (authed) runSearch(); /* eslint-disable */ }, [authed]);

  const logout = () => { localStorage.removeItem("token"); setToken(""); setAuthed(false); };
  const toggleSource = (src) => {
    const next = new Set(sourceFilter);
    next.has(src) ? next.delete(src) : next.add(src);
    setSourceFilter(next);
  };

  if (!authChecked) {
    return <div className="app-layout" style={{ display: "grid", placeItems: "center" }}><div className="muted">Checking session…</div></div>;
  }
  if (!authed) return <LoginView onLoggedIn={(t)=>setToken(t)} />;

  return (
    <div className="page">
      <header className="header">
        <h1>🔎 Regulation Clause Search</h1>
        <div className="muted" style={{ fontSize: 14 }}>
          {payload?.username ? `Signed in as ${payload.username}` : payload?.email || "Signed in"}
        </div>
        <button onClick={logout}>Log out</button>
      </header>

      <form className="toolbar" onSubmit={runSearch}>
        <div className="field">
          <label className="label">Query</label>
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="field small">
          <label className="label">Max results</label>
          <input type="number" className="input" min={5} max={100} step={5}
            value={topK} onChange={(e) => setTopK(Number(e.target.value) || 20)} />
        </div>
        <div className="field small">
          <label className="label">Method</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="lexical">lexical</option>
            <option value="semantic">semantic</option>
            <option value="hybrid">hybrid</option>
          </select>
        </div>
        <div className="field small">
          <label className="label">Alpha</label>
          <input type="number" className="input" step={0.05} min={0} max={1}
            value={alpha} onChange={(e)=>setAlpha(Math.max(0, Math.min(1, Number(e.target.value))))}
            disabled={method !== "hybrid"} />
        </div>
        <div className="field small" style={{ alignSelf: "end" }}>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label">Filter by source</label>
          <div className="chips">
            {sources.map((src) => {
              const on = sourceFilter.has(src);
              return (
                <button key={src} type="button"
                  className={`chip ${on ? "chip--on" : ""}`}
                  onClick={() => toggleSource(src)}>
                  {src}
                </button>
              );
            })}
            {!sources.length && <span className="muted">No results yet</span>}
          </div>
        </div>
      </form>

      {error && <div className="error">{error}</div>}
      {loading && <div className="info">Loading…</div>}

      <div className="grid">
        {pageItems.map((r, i) => <ResultCard key={i} item={r} query={query} />)}
        {!loading && pageItems.length === 0 && <div className="muted">No matches. Try broader terms.</div>}
      </div>

      <footer className="footer muted">
        Showing <b>{pageItems.length}</b> of <b>{totalMatches}</b> matches.  
        Backend method: <b>{method}</b>{method==="hybrid" ? ` (alpha=${alpha})` : ""}.
      </footer>
    </div>
  );
}
