const API_URL   = "http://127.0.0.1:5001";
const LOGIN_PAGE = "login.html";

const form = document.getElementById("searchForm");
const qInput = document.getElementById("q");
const topKInput = document.getElementById("topK");
const methodSel = document.getElementById("method");
const alphaInput = document.getElementById("alpha");
const alphaHint = document.getElementById("alphaHint");
const corpusSel = document.getElementById("corpus");
const statText = document.getElementById("statText");
const countPill = document.getElementById("countPill");
const errBox = document.getElementById("err");
const infoBox = document.getElementById("info");
const answerBox = document.getElementById("llmAnswer");
const resultsBox = document.getElementById("results");
const exportBtn = document.getElementById("exportBtn");

// keep last data for export
let LAST_DATA = null;
let LAST_META = null;

function show(el, on = true){ el.style.display = on ? "" : "none"; }
function setText(el, t){ el.textContent = t; }
function safe(s){ return String(s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function highlight(text, q){
  if (!q || !text) return safe(text || "");
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(" + esc + ")", "ig");
  return safe(text).replace(re, "<mark>$1</mark>");
}
function copy(text){ navigator.clipboard?.writeText(text).catch(()=>{}); }

function renderMarkdown(md) {
  if (!md) return "";
  let html = safe(md);
  html = html
    .replace(/^###### (.*)$/gm, "<h6>$1</h6>")
    .replace(/^##### (.*)$/gm, "<h5>$1</h5>")
    .replace(/^#### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/(\n<li>.*<\/li>)+/g, m => `<ul>${m}</ul>`)
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\n{2,}/g, "<br><br>");
  return html;
}

function updateControls() {
  const isHybrid = methodSel.value === "hybrid";
  alphaInput.disabled = !isHybrid;
  alphaHint.textContent = isHybrid ? "active" : "disabled";
  alphaHint.style.color = isHybrid ? "#0a5f2b" : "#a1a1a1";
}
methodSel.addEventListener("change", updateControls);
updateControls();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  show(errBox, false);
  show(infoBox, true);
  setText(infoBox, "Searching…");
  setText(statText, "Searching…");
  show(countPill, false);
  resultsBox.innerHTML = "";
  show(answerBox, false);
  answerBox.innerHTML = "";

  const q = qInput.value.trim();
  const topK = Math.max(5, Math.min(100, Number(topKInput.value) || 20));
  const method = methodSel.value;
  const alpha = Number(alphaInput.value);
  const sources = (corpusSel?.value || "all");

  try {
    const url = new URL(`${API_URL}/search`);
    url.searchParams.set("query", q);
    url.searchParams.set("top_k", String(topK));
    url.searchParams.set("method", method);
    url.searchParams.set("sources", sources);
    if (method === "hybrid") url.searchParams.set("alpha", String(alpha));

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // keep for export
    LAST_DATA = data;
    LAST_META = { q, topK, method, alpha, sources, when: new Date().toLocaleString() };

    if (data.answer_markdown) {
      answerBox.innerHTML = `
        <h3 style="margin-top:0">RAG Response</h3>
        <div class="markdown">${renderMarkdown(data.answer_markdown)}</div>
      `;
      show(answerBox, true);
    }

    const items = Array.isArray(data.results) ? data.results : [];
    const total = typeof data.total_matches === "number" ? data.total_matches : items.length;

    if (!items.length) {
      resultsBox.innerHTML = `<div class="card">No results.</div>`;
      setText(statText, "No results.");
      show(infoBox, false);
      return;
    }

    const frag = document.createDocumentFragment();
    items.slice(0, topK).forEach((c) => {
      const card = document.createElement("article");
      card.className = "card";
      const citation = `${c.source || ""} • ${c.reference || ""} • p.${c.page ?? ""}`.trim();
      card.innerHTML = `
        <div class="card__top">
          <div class="title">${safe(c.source || "Source")}</div>
          <div class="score">score ${Number(c.score ?? 0).toFixed(2)}</div>
        </div>
        <div class="meta">
          <span class="badge">${safe(c.reference || "—")}</span>
          <span class="badge">p.${safe(String(c.page ?? ""))}</span>
          <span class="badge">${safe(c.filename || "")}</span>
        </div>
        <div class="text">${highlight(c.text || "", q)}</div>
        <div class="actions">
          <button class="btn" type="button">Copy citation
            <img src="copy.png" width="16" height="16" alt="copy">
          </button>
        </div>
      `;
      card.querySelector(".btn").addEventListener("click", () => copy(citation));
      frag.appendChild(card);
    });
    resultsBox.appendChild(frag);

    const methodLabel = method === "hybrid" ? "RAG (Hybrid)" : method;
    setText(statText, `Method: ${methodLabel}${method==="hybrid" ? ` (alpha=${alpha}, LLM=auto)` : ""} • Source: ${sources.toUpperCase()}`);
    setText(countPill, `${Math.min(items.length, topK)} / ${total}`);
    show(countPill, true);
    show(infoBox, false);

  } catch (err) {
    setText(errBox, err.message || "Error");
    show(errBox, true);
    show(infoBox, false);
    setText(statText, "Error");
  }
});

window.addEventListener("DOMContentLoaded", () => {
  form.dispatchEvent(new Event("submit"));
});

// ---------- Export to PDF (Print) ----------
function buildPrintableHTML() {
  if (!LAST_DATA) return null;
  const { q, topK, method, alpha, sources, when } = LAST_META || {};
  const items = LAST_DATA.results || [];
  const answer = LAST_DATA.answer_markdown ? renderMarkdown(LAST_DATA.answer_markdown) : "";

  const style = `
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#111; }
    h1,h2,h3 { margin: 0 0 .5rem; }
    h1 { font-size: 20px; }
    h2 { font-size: 16px; margin-top: 1.2rem; }
    .meta { font-size: 12px; color:#555; margin-bottom: 12px; }
    .answer { border:1px solid #e5e5e5; padding:10px; border-radius:6px; margin:10px 0 16px; }
    .card { border:1px solid #e5e5e5; border-radius:8px; padding:10px; margin-bottom:10px; }
    .rowtop { display:flex; justify-content:space-between; gap:8px; }
    .badges { font-size:12px; color:#333; margin:6px 0; }
    .badge { display:inline-block; border:1px solid #ccc; border-radius:999px; padding:2px 8px; margin-right:6px; }
    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
    th { background: #f6f8fa; }
    .small { font-size: 11px; color:#666; }
  </style>`;

  const header = `
    <h1>Clause Search Export</h1>
    <div class="meta">
      <div><strong>Query:</strong> ${safe(q)}</div>
      <div><strong>Method:</strong> ${method}${method==="hybrid" ? ` (alpha=${alpha})` : ""}</div>
      <div><strong>Sources:</strong> ${safe(String(sources).toUpperCase())}</div>
      <div class="small">Exported: ${safe(when || new Date().toLocaleString())}</div>
    </div>
  `;

  const answerHtml = answer ? `<h2>RAG Answer</h2><div class="answer">${answer}</div>` : "";

  const bodyCards = items.map((c, i) => `
    <div class="card">
      <div class="rowtop">
        <strong>${i+1}. ${safe(c.source || "Source")}</strong>
        <span class="small">score ${Number(c.score ?? 0).toFixed(2)}</span>
      </div>
      <div class="badges">
        <span class="badge">${safe(c.reference || "—")}</span>
        <span class="badge">p.${safe(String(c.page ?? ""))}</span>
        <span class="badge">${safe(c.filename || "")}</span>
      </div>
      <div>${safe(c.text || "")}</div>
    </div>
  `).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Clause Search Export</title>${style}</head>
  <body>${header}${answerHtml}<h2>Results (${items.length})</h2>${bodyCards}</body></html>`;
}

function exportPDF() {
  if (!LAST_DATA) { alert("Run a search first."); return; }
  const html = buildPrintableHTML();
  const w = window.open("", "_blank");
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  // give layout a tick, then print
  setTimeout(() => w.print(), 400);
}

exportBtn?.addEventListener("click", exportPDF);
