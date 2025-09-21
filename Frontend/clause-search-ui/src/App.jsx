import { useEffect, useMemo, useState } from "react";
import "./App.css";

/**
 * Frontend for Regulation Clause Search
 * Talks to FastAPI /search
 *
 * Configure backend URL in Vite:
 *  - create `Frontend/clause-search-ui/.env.local` with:
 *      VITE_API_URL=http://127.0.0.1:8000
 */
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// --- utils ---
function tokenize(s) {
  return (s || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function highlight(text, query) {
  if (!query || !text) return text || "";
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "ig");
  const parts = String(text).split(re);
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p));
}

function Badge({ children }) {
  return <span className="badge">{children}</span>;
}

function ResultCard({ item, query }) {
  const c = item; // server returns fields directly on each result
  const citation = `${c.source} • ${c.reference} • p.${c.page}`;
  const copyCitation = async () => {
    try {
      await navigator.clipboard.writeText(citation);
    } catch {}
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
      <p className="card__text">{highlight(c.text || "⚠️ No text extracted for this clause.", query)}</p>
      <div className="card__actions">
        <button className="btn" onClick={copyCitation}>Copy citation</button>
      </div>
    </div>
  );
}

export default function App() {
  const [query, setQuery] = useState("data breach notification 72 hours PDPL");
  const [method, setMethod] = useState("hybrid"); // "lexical" | "semantic" | "hybrid"
  const [alpha, setAlpha] = useState(0.6);        // semantic weight when method=hybrid
  const [topK, setTopK] = useState(20);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState([]);
  const [totalMatches, setTotalMatches] = useState(0);

  // Source filter (client-side) to let users narrow results
  const sources = useMemo(
    () => Array.from(new Set(results.map(r => r.source))).sort(),
    [results]
  );
  const [sourceFilter, setSourceFilter] = useState(new Set());
  const filtered = useMemo(() => {
    if (!sourceFilter.size) return results;
    return results.filter(r => sourceFilter.has(r.source));
  }, [results, sourceFilter]);

  const pageItems = filtered.slice(0, topK);

  async function runSearch(e) {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError("");
    try {
      const url = new URL(`${API_URL}/search`);
      url.searchParams.set("query", query);
      url.searchParams.set("top_k", String(Math.max(1, Math.min(100, topK))));
      url.searchParams.set("method", method);
      if (method === "hybrid") url.searchParams.set("alpha", String(alpha));

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setResults(Array.isArray(data.results) ? data.results : []);
      setTotalMatches(typeof data.total_matches === "number" ? data.total_matches : 0);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  // Auto-search on first load
  useEffect(() => { runSearch(); /* eslint-disable-next-line */ }, []);

  const toggleSource = (src) => {
    const next = new Set(sourceFilter);
    if (next.has(src)) next.delete(src); else next.add(src);
    setSourceFilter(next);
  };

  return (
    <div className="page">
      <header className="header">
        <h1>🔎 Regulation Clause Search</h1>
        <p className="muted">
          Sources: PDPL Implementing Regulation & NCA Essential Cybersecurity Controls (ECC-1:2018)
        </p>
      </header>

      <form className="toolbar" onSubmit={runSearch}>
        <div className="field">
          <label className="label">Query</label>
          <input
            className="input"
            placeholder="Try: notify authority within three days"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="field small">
          <label className="label">Max results</label>
          <input
            type="number"
            className="input"
            min={5}
            max={100}
            step={5}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value) || 20)}
          />
        </div>

        <div className="field small">
          <label className="label">Method</label>
          <select
            className="input"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="lexical">lexical</option>
            <option value="semantic">semantic</option>
            <option value="hybrid">hybrid</option>
          </select>
        </div>

        <div className="field small">
          <label className="label">Alpha (semantic weight)</label>
          <input
            type="number"
            className="input"
            step={0.05}
            min={0}
            max={1}
            value={alpha}
            onChange={(e) => setAlpha(Math.max(0, Math.min(1, Number(e.target.value))))}
            disabled={method !== "hybrid"}
            title="Only used for hybrid"
          />
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
                <button
                  key={src}
                  type="button"
                  className={`chip ${on ? "chip--on" : ""}`}
                  onClick={() => toggleSource(src)}
                  title={src}
                >
                  {src}
                </button>
              );
            })}
            {!sources.length && <span className="muted">No results yet</span>}
          </div>
        </div>
      </form>

      {error && (
        <div className="error">
          Failed to fetch from <code>{API_URL}/search</code>: {error}
        </div>
      )}
      {loading && <div className="info">Loading…</div>}

      <div className="resultsHead">
        <div className="muted">
          Showing <b>{Math.min(pageItems.length, topK)}</b> of <b>{totalMatches}</b> matches
        </div>
      </div>

      <div className="grid">
        {pageItems.map((r, i) => (
          <ResultCard key={i} item={r} query={query} />
        ))}
        {!loading && pageItems.length === 0 && (
          <div className="card">
            <p className="muted">No matches. Try broader terms or change method to hybrid.</p>
          </div>
        )}
      </div>

      <footer className="footer muted">
        Backend method: <b>{method}</b>{method === "hybrid" ? ` (alpha=${alpha})` : ""}. Try lexical for exact term matches, semantic for paraphrases, hybrid for a balance.
      </footer>
    </div>
  );
}
