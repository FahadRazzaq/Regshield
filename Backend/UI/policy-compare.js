// ui/policy-compare.js
// Works with policy-compare.html / policy-compare.css and Flask route /compare/policy

const API = window.BACKEND_URL || "http://127.0.0.1:5001";
const $ = (s) => document.querySelector(s);

function getToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token");
}
function show(el, on = true) {
  el.style.display = on ? "" : "none";
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- Minimal Markdown renderer (safe, supports tables, lists, headings, quotes, bold/italic/code) ----------
function renderMarkdown(md) {
  if (!md) return "";
  const lines = String(md).replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;

  const inline = (txt) =>
    esc(txt)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>");

  while (i < lines.length) {
    let line = lines[i];

    // Code block ```
    if (/^```/.test(line)) {
      const fence = line.trim();
      let code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      // skip closing ```
      if (i < lines.length) i++;
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }

    // Table: header |---|---| followed by rows with pipes
    const isTableHeader =
      /\|/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]);

    if (isTableHeader) {
      const headerRow = line;
      const sepRow = lines[i + 1];
      const rows = [];
      i += 2;
      while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      const splitRow = (r) =>
        r
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => inline(c.trim()));
      const heads = splitRow(headerRow);
      const body = rows.map(splitRow);

      let tbl = `<table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>`;
      for (const r of body) {
        // pad to header length
        const cells = r.length < heads.length ? r.concat(Array(heads.length - r.length).fill("")) : r;
        tbl += `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
      }
      tbl += `</tbody></table>`;
      out.push(tbl);
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const block = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        block.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(block.join("\n"))}</blockquote>`);
      continue;
    }

    // Headings
    if (/^#{1,6}\s+/.test(line)) {
      const level = (line.match(/^#+/) || ["#"])[0].length;
      const text = line.replace(/^#{1,6}\s+/, "");
      i++;
      out.push(`<h${level}>${inline(text)}</h${level}>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`);
      continue;
    }

    // Paragraph / blank
    if (!/^\s*$/.test(line)) {
      const para = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      out.push(`<p>${inline(para.join(" "))}</p>`);
      continue;
    }

    // blank
    i++;
  }
  return out.join("\n");
}

// ---------- DOM ----------
const form = $("#uploadForm");
const fileEl = $("#file");
const method = $("#method");
const topk = $("#topk");
const statusBox = $("#status");
const errBox = $("#error");
const results = $("#results");

function setStatus(msg) {
  statusBox.textContent = msg || "";
}
function setError(msg) {
  errBox.textContent = msg || "";
  show(errBox, !!msg);
}
// Keep only the first Markdown table; if none, return original
function keepFirstTable(md) {
  if (!md) return "";
  const lines = String(md).replace(/\r/g, "").split("\n");
  let i = 0;
  // find header + separator
  while (i < lines.length) {
    const header = /^\s*\|.*\|\s*$/.test(lines[i]);
    const sep = i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]);
    if (header && sep) break;
    i++;
  }
  if (i >= lines.length) return md; // no table found

  const out = [lines[i], lines[i + 1]];
  i += 2;
  while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}


// ---------- Render ----------
function renderResults(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  results.innerHTML = "";

  if (!items.length) {
    results.innerHTML = `<div class="card">No sections detected in the uploaded policy.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  for (const it of items) {
    const card = document.createElement("article");
    card.className = "card";

    const title = it.title ? esc(it.title) : `Section ${it.section_id}`;
    const policy = esc(it.policy_excerpt || "");

    // Build matches
    const matches = (it.matches || []).map((m) => {
      const refBits = [
        m.source ? esc(m.source) : "-",
        m.reference ? esc(m.reference) : "-",
        `p.${esc(String(m.page ?? ""))}`,
      ].join(" • ");
      const snippet = esc(String(m.text || "").slice(0, 1200)) + (m.text && m.text.length > 1200 ? "…" : "");
      return `
        <div>
          <div class="badge">${refBits}</div>
          <div class="text">${snippet}</div>
        </div>
      `;
    }).join("");

    // AI comparison (Markdown → HTML)
    const mdOnlyTable = keepFirstTable(it.ai_comparison_markdown || "");
    const mdHtml = renderMarkdown(mdOnlyTable || "_No AI comparison was generated._");

    card.innerHTML = `
      <h3>${title}</h3>
      <div class="meta">Top matches: ${it.matches?.length || 0}</div>

      <div class="grid">
        <div class="col">
          <h4>Policy Section</h4>
          <div class="text">${policy}</div>
        </div>
        <div class="col">
          <h4>Relevant Clauses</h4>
          <div class="matches">${matches || "<em>No matches</em>"}</div>
        </div>
      </div>

      <div class="markdown">${mdHtml}</div>
    `;

    frag.appendChild(card);
  }

  results.appendChild(frag);
}

// ---------- Submit ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");
  setStatus("Uploading and comparing…");
  results.innerHTML = "";

  const f = fileEl.files?.[0];
  if (!f) {
    setError("Please choose a file (.pdf, .docx, .txt).");
    setStatus("");
    return;
  }

  const fd = new FormData();
  fd.append("file", f, f.name);
  fd.append("method", method.value);
  fd.append("top_k", String(Math.max(1, Math.min(8, Number(topk.value) || 3))));

  try {
    const res = await fetch(`${API}/compare/policy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd,
    });

    // Handle auth failure gracefully
    if (res.status === 401) {
      // send user to login with redirect back
      const loc = new URL(window.location.href);
      window.location.assign(`login.html?from=${encodeURIComponent(loc.pathname.replace(/^\//, ""))}`);
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || data.error || `HTTP ${res.status}`);

    renderResults(data);
    setStatus(`Compared ${data.sections_compared} section(s) using ${data.method} (top_k=${data.top_k}).`);
  } catch (err) {
    setError(err.message || "Comparison failed.");
  } finally {
    // clear status after a moment if no error
    if (!errBox.textContent) setTimeout(() => setStatus(""), 600);
  }
});

// Optional: warn if user selects an unsupported file
fileEl.addEventListener("change", () => {
  setError("");
  const f = fileEl.files?.[0];
  if (!f) return;
  if (!/\.(pdf|docx|txt)$/i.test(f.name)) {
    setError("Unsupported file type. Allowed: .pdf, .docx, .txt");
  }
});
