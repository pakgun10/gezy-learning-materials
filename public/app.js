const state = { grade: "", category: "", q: "" };

const KIND_ICON = {
  pdf: "📕", gambar: "🖼️", video: "🎬", audio: "🎧", dokumen: "📄",
  presentasi: "📊", spreadsheet: "📈", html: "🌐", arsip: "🗜️", file: "📁",
};

const $ = (s) => document.querySelector(s);

function fmtSize(bytes) {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
function fmtDate(s) {
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d) ? s : d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 2600);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadMeta() {
  const meta = await (await fetch("/api/meta")).json();
  $("#fCategory").innerHTML = meta.categories.map((c) => `<option>${esc(c)}</option>`).join("");
  $("#maxSizeLabel").textContent = meta.maxUploadMb;
  window._categories = meta.categories;
}

async function loadStats() {
  const s = await (await fetch("/api/stats")).json();
  $("#statTotal").textContent = s.total;
  $("#stat7").textContent = s.perGrade[7] ?? 0;
  $("#stat8").textContent = s.perGrade[8] ?? 0;
  $("#stat9").textContent = s.perGrade[9] ?? 0;
  $("#statSize").textContent = fmtSize(s.totalBytes);
  // chip kategori + jumlah
  const counts = Object.fromEntries(s.perCategory.map((r) => [r.category, r.n]));
  const chips = ["", ...(window._categories ?? [])];
  $("#categoryChips").innerHTML = chips
    .map((c) => {
      const label = c === "" ? "Semua Kategori" : c;
      const n = c === "" ? s.total : counts[c] ?? 0;
      return `<button class="chip ${state.category === c ? "active" : ""}" data-cat="${esc(c)}">${esc(label)}<span class="n">${n}</span></button>`;
    })
    .join("");
  document.querySelectorAll(".chip").forEach((ch) =>
    ch.addEventListener("click", () => { state.category = ch.dataset.cat; loadAll(); }),
  );
}

async function loadDocs() {
  const p = new URLSearchParams();
  if (state.grade) p.set("grade", state.grade);
  if (state.category) p.set("category", state.category);
  if (state.q) p.set("q", state.q);
  const { documents } = await (await fetch(`/api/documents?${p}`)).json();
  const grid = $("#grid");
  $("#emptyState").hidden = documents.length > 0;
  grid.innerHTML = documents
    .map((d) => `
    <article class="doc-card">
      <div class="doc-top">
        <div class="doc-icon kind-${esc(d.kind)}">${KIND_ICON[d.kind] ?? "📁"}</div>
        <span class="grade-badge">Kelas ${d.grade}</span>
      </div>
      <h3 class="doc-title">${esc(d.title)}</h3>
      ${d.description ? `<p class="doc-desc">${esc(d.description)}</p>` : ""}
      <div class="doc-meta">
        <span class="meta-pill cat">${esc(d.category)}</span>
        ${d.subject ? `<span class="meta-pill">${esc(d.subject)}</span>` : ""}
        <span class="meta-pill">.${esc(d.ext)} • ${fmtSize(d.size)}</span>
        <span class="meta-pill">${fmtDate(d.createdAt)}</span>
      </div>
      <div class="doc-actions">
        <button class="act" data-preview="${d.id}">👁 Lihat</button>
        <a class="act" href="${d.downloadUrl}">⬇ Unduh</a>
        <button class="act danger" data-del="${d.id}">🗑 Hapus</button>
      </div>
    </article>`)
    .join("");
  window._docs = Object.fromEntries(documents.map((d) => [d.id, d]));
  grid.querySelectorAll("[data-preview]").forEach((b) => b.addEventListener("click", () => openPreview(window._docs[b.dataset.preview])));
  grid.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => delDoc(window._docs[b.dataset.del])));
}

async function loadAll() { await loadStats(); await loadDocs(); }

function openPreview(d) {
  if (!d) return;
  $("#previewTitle").textContent = d.title;
  $("#previewDownload").href = d.downloadUrl;
  const body = $("#previewBody");
  const url = d.url;
  if (d.kind === "gambar") body.innerHTML = `<img src="${url}" alt="${esc(d.title)}" />`;
  else if (d.kind === "video") body.innerHTML = `<video src="${url}" controls autoplay playsinline></video>`;
  else if (d.kind === "audio") body.innerHTML = `<audio src="${url}" controls autoplay></audio>`;
  else if (d.kind === "pdf" || d.kind === "html") body.innerHTML = `<iframe src="${url}" title="${esc(d.title)}"></iframe>`;
  else body.innerHTML = `<div class="preview-fallback"><span class="big">${KIND_ICON[d.kind] ?? "📁"}</span>Pratinjau tidak tersedia untuk file .${esc(d.ext)}.<br/>Silakan unduh untuk membukanya.</div>`;
  $("#previewModal").hidden = false;
}

async function delDoc(d) {
  if (!d || !confirm(`Hapus dokumen "${d.title}"? File akan dihapus permanen.`)) return;
  const r = await fetch(`/api/documents/${d.id}`, { method: "DELETE" });
  if (r.ok) { toast("Dokumen dihapus."); loadAll(); }
  else toast("Gagal menghapus dokumen.");
}

// ---------- Filter events ----------
document.querySelectorAll("#gradeTabs .tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll("#gradeTabs .tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    state.grade = t.dataset.grade;
    loadAll();
  }),
);
document.querySelectorAll(".stat.clickable").forEach((s) =>
  s.addEventListener("click", () => {
    const g = s.dataset.grade;
    document.querySelector(`#gradeTabs .tab[data-grade="${g}"]`)?.click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }),
);
let searchTimer;
$("#searchInput").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadDocs(); }, 250);
});

// ---------- Upload ----------
const modal = $("#uploadModal");
$("#btnOpenUpload").addEventListener("click", () => (modal.hidden = false));
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => {
    document.getElementById(b.dataset.close).hidden = true;
    if (b.dataset.close === "previewModal") $("#previewBody").innerHTML = "";
  }),
);
document.querySelectorAll(".modal").forEach((m) =>
  m.addEventListener("click", (e) => { if (e.target === m) { m.hidden = true; if (m.id === "previewModal") $("#previewBody").innerHTML = ""; } }),
);

const dz = $("#dropzone"), fi = $("#fileInput");
dz.addEventListener("click", () => fi.click());
["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) { const dt = new DataTransfer(); dt.items.add(f); fi.files = dt.files; showFileName(); }
});
fi.addEventListener("change", showFileName);
function showFileName() {
  const f = fi.files[0];
  const el = $("#dzFileName");
  if (f) { el.hidden = false; el.textContent = `📎 ${f.name} (${fmtSize(f.size)})`; if (!$("#fTitle").value) $("#fTitle").placeholder = f.name.replace(/\.[^.]+$/, ""); }
  else el.hidden = true;
}

$("#uploadForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = fi.files[0];
  const err = $("#uploadError");
  err.hidden = true;
  if (!f) { err.textContent = "Pilih file terlebih dahulu."; err.hidden = false; return; }
  const fd = new FormData();
  fd.append("file", f);
  fd.append("title", $("#fTitle").value);
  fd.append("subject", $("#fSubject").value);
  fd.append("grade", $("#fGrade").value);
  fd.append("category", $("#fCategory").value);
  fd.append("description", $("#fDesc").value);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/documents");
  $("#uploadProgress").hidden = false;
  xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) $("#uploadBar").style.width = `${Math.round((ev.loaded / ev.total) * 100)}%`; };
  xhr.onload = () => {
    $("#uploadProgress").hidden = true;
    $("#uploadBar").style.width = "0%";
    if (xhr.status >= 200 && xhr.status < 300) {
      modal.hidden = true;
      e.target.reset();
      $("#dzFileName").hidden = true;
      toast("Dokumen berhasil diunggah 🎉");
      loadAll();
    } else {
      try { err.textContent = JSON.parse(xhr.responseText).error || "Unggah gagal."; }
      catch { err.textContent = "Unggah gagal."; }
      err.hidden = false;
    }
  };
  xhr.onerror = () => { $("#uploadProgress").hidden = true; err.textContent = "Koneksi bermasalah, unggah gagal."; err.hidden = false; };
  xhr.send(fd);
});

// ---------- Init ----------
(async () => { await loadMeta(); await loadAll(); })();
