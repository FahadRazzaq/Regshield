// ====== CONFIG ======
const API_URL   = "http://127.0.0.1:5001"; // <-- Flask proxy for /search
const LOGIN_PAGE = "login.html";

// ====== DOM ======
const form = document.getElementById("searchForm");
const qInput = document.getElementById("q");
const topKInput = document.getElementById("topK");
const methodSel = document.getElementById("method");
const alphaInput = document.getElementById("alpha");
const alphaHint = document.getElementById("alphaHint");
const statText = document.getElementById("statText");
const countPill = document.getElementById("countPill");
const errBox = document.getElementById("err");
const infoBox = document.getElementById("info");
const resultsBox = document.getElementById("results");

// ====== utils ======
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

// alpha enable/disable
function updateAlphaState(){
  const on = methodSel.value === "hybrid";
  alphaInput.disabled = !on;
  alphaHint.textContent = on ? "active" : "disabled";
  alphaHint.style.color = on ? "#0a5f2b" : "#a1a1a1";
}
methodSel.addEventListener("change", updateAlphaState);
updateAlphaState();

// ====== search submit ======
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  show(errBox, false);
  show(infoBox, true);
  setText(infoBox, "Searching…");
  setText(statText, "Searching…");
  show(countPill, false);
  resultsBox.innerHTML = "";

  const q = qInput.value.trim();
  const topK = Math.max(5, Math.min(100, Number(topKInput.value) || 20));
  const method = methodSel.value;
  const alpha = Number(alphaInput.value);

  try {
    const url = new URL(`${API_URL}/search`);
    url.searchParams.set("query", q);
    url.searchParams.set("top_k", String(topK));
    url.searchParams.set("method", method);
    if (method === "hybrid") url.searchParams.set("alpha", String(alpha));

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

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
          <button class="btn" type="button">Copy citation</button>
        </div>
      `;
      card.querySelector(".btn").addEventListener("click", () => copy(citation));
      frag.appendChild(card);
    });
    resultsBox.appendChild(frag);

    setText(statText, `Method: ${method}${method==="hybrid" ? ` (alpha=${alpha})` : ""}`);
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

// auto-run once
window.addEventListener("DOMContentLoaded", () => {
  form.dispatchEvent(new Event("submit"));
});
