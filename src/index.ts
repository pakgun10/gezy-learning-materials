import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { join, basename, extname } from "node:path";
import { unlink } from "node:fs/promises";
import {
  db,
  UPLOAD_DIR,
  CATEGORIES,
  GRADES,
  ACCEPTED_EXTS,
  kindOf,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  getUserByUsername,
  createSession,
  getSessionUser,
  deleteSession,
  cleanupExpiredSessions,
  type DocumentRow,
  type SessionUser,
} from "./db";

const app = new Hono<{ Variables: { user: SessionUser } }>();

// CORS tidak dipasang sengaja: API hanya dipakai frontend satu origin.
// (Kalau suatu saat butuh akses lintas origin, batasi origin-nya secara eksplisit.)

cleanupExpiredSessions();
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} harus berupa angka antara ${min} dan ${max}.`);
  }
  return value;
}

const MAX_UPLOAD_MB = envNumber("MAX_UPLOAD_MB", 500, 1, 2048);
const LOGIN_MAX_FAIL = envNumber("LOGIN_MAX_FAIL", 10, 1, 1000);
const LOGIN_WINDOW_MS = envNumber("LOGIN_WINDOW_MIN", 10, 1, 24 * 60) * 60 * 1000;

const MIME_BY_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pdf: "application/pdf",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv; charset=utf-8",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
};

const PREVIEW_KINDS = new Set(["gambar", "video", "audio", "pdf", "html"]);

function safeMime(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}

function safeFilename(name: string): string {
  const clean = basename(name.replaceAll("\\", "/"))
    .replace(/[\\\r\n"]/g, "_")
    .trim()
    .slice(0, 255);
  return clean || "download";
}

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
});

function publicDoc(d: DocumentRow) {  return {
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    grade: d.grade,
    subject: d.subject,
    originalName: d.original_name,
    ext: d.ext,
    mime: safeMime(d.ext),
    kind: d.kind,
    size: d.size,
    createdAt: d.created_at,
    url: `/files/${encodeURIComponent(d.stored_name)}`,
    downloadUrl: `/api/documents/${d.id}/download`,
  };
}

// ---------- Autentikasi ----------

// Rate limit login: batasi percobaan GAGAL per IP agar tidak bisa di-brute-force.
const loginFails = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginFails) if (now >= rec.resetAt) loginFails.delete(ip);
}, 5 * 60 * 1000);

function clientIp(c: any): string {
  // Nginx harus menimpa X-Real-IP/X-Forwarded-For, bukan meneruskan nilai client.
  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",").at(-1)?.trim() || "unknown";
  return "unknown";
}

function loginGate(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const rec = loginFails.get(ip);
  if (!rec || now >= rec.resetAt) return { ok: true };
  if (rec.count >= LOGIN_MAX_FAIL) {
    return { ok: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
  }
  return { ok: true };
}

function recordLoginFail(ip: string) {
  const now = Date.now();
  const rec = loginFails.get(ip);
  if (!rec || now >= rec.resetAt) loginFails.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else rec.count++;
}

function isHttpsRequest(c: any): boolean {
  const proto = c.req.header("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim().toLowerCase() === "https";
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

function useSecureCookie(c: any): boolean {
  // COOKIE_SECURE=1 → selalu secure; =0 → tidak pernah; selain itu otomatis ikut skema request.
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  return isHttpsRequest(c);
}

async function requireLogin(c: any, next: any) {
  const user = getSessionUser(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: "Silakan login terlebih dahulu." }, 401);
  c.set("user", user);
  await next();
}

app.post("/api/login", async (c) => {
  let body: { username?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Data tidak valid." }, 400);
  }
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const ip = clientIp(c);
  const gate = loginGate(ip);
  if (!gate.ok) {
    c.header("Retry-After", String(gate.retryAfter ?? 60));
    return c.json({ error: "Terlalu banyak percobaan login. Coba lagi beberapa menit lagi." }, 429);
  }
  const user = username ? getUserByUsername(username) : null;
  if (!user || !(await Bun.password.verify(password, user.password_hash))) {
    recordLoginFail(ip);
    return c.json({ error: "Username atau password salah." }, 401);
  }
  loginFails.delete(ip); // login sukses → hitungan gagal di-reset
  const token = createSession(user.id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: useSecureCookie(c),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return c.json({ user: { id: user.id, username: user.username, role: user.role } });
});

app.post("/api/logout", (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) deleteSession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/me", (c) => {
  const user = getSessionUser(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ user: null });
  return c.json({ user });
});

// ---------- API ----------

app.get("/api/meta", (c) =>
  c.json({ categories: CATEGORIES, grades: GRADES, maxUploadMb: MAX_UPLOAD_MB }),
);

app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.get("/api/stats", (c) => {
  const total = db.query("SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM documents").get() as {
    n: number;
    bytes: number;
  };
  const perGrade = db
    .query("SELECT grade, COUNT(*) AS n FROM documents GROUP BY grade")
    .all() as { grade: number; n: number }[];
  const perCategory = db
    .query("SELECT category, COUNT(*) AS n FROM documents GROUP BY category ORDER BY n DESC")
    .all() as { category: string; n: number }[];
  return c.json({
    total: total.n,
    totalBytes: total.bytes,
    perGrade: Object.fromEntries(perGrade.map((r) => [r.grade, r.n])),
    perCategory,
  });
});

app.get("/api/documents", (c) => {
  const grade = c.req.query("grade");
  const category = c.req.query("category");
  const kind = c.req.query("kind");
  const q = (c.req.query("q") ?? "").trim();

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (grade && GRADES.includes(Number(grade) as (typeof GRADES)[number])) {
    where.push("grade = ?");
    params.push(Number(grade));
  }
  if (category) {
    where.push("category = ?");
    params.push(category);
  }
  if (kind) {
    where.push("kind = ?");
    params.push(kind);
  }
  if (q) {
    where.push("(title LIKE ? OR description LIKE ? OR original_name LIKE ? OR subject LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const sql = `SELECT * FROM documents ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, id DESC`;
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "24", 10) || 24));
  const offset = (page - 1) * limit;
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = (
    db.query(`SELECT COUNT(*) AS n FROM documents ${whereSql}`).get(...params) as { n: number }
  ).n;
  const rows = db
    .query(`${sql} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as DocumentRow[];
  return c.json({
    documents: rows.map(publicDoc),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

app.post("/api/documents", requireLogin, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "File wajib diunggah (field: file)." }, 400);
  }
  if (file.size === 0) return c.json({ error: "File kosong." }, 400);
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return c.json({ error: `Ukuran file melebihi batas ${MAX_UPLOAD_MB} MB.` }, 413);
  }

  const originalName = safeFilename(file.name);
  const ext = extname(originalName).replace(".", "").toLowerCase();
  if (!ACCEPTED_EXTS.has(ext)) {
    return c.json({ error: `Jenis file .${ext || "?"} belum didukung.` }, 415);
  }

  const grade = Number(body["grade"]);
  if (!GRADES.includes(grade as (typeof GRADES)[number])) {
    return c.json({ error: "Kelas wajib dipilih: 7, 8, atau 9." }, 400);
  }
  const categoryRaw = String(body["category"] ?? "Lainnya");
  const category = (CATEGORIES as readonly string[]).includes(categoryRaw) ? categoryRaw : "Lainnya";
  const title = (String(body["title"] ?? "").trim() || originalName.replace(/\.[^.]+$/, "")).slice(0, 200);
  const description = String(body["description"] ?? "").trim().slice(0, 2000);
  const subject = String(body["subject"] ?? "").trim().slice(0, 100);

  const safeBase = basename(originalName, extname(originalName))
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .slice(0, 60) || "dokumen";
  const storedName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeBase}.${ext}`;
  const dest = join(UPLOAD_DIR, storedName);
  await Bun.write(dest, file);

  try {
    const info = db
      .query(
        `INSERT INTO documents (title, description, category, grade, subject, original_name, stored_name, ext, mime, kind, size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(title, description, category, grade, subject, originalName, storedName, ext, safeMime(ext), kindOf(ext), file.size) as DocumentRow;

    return c.json({ document: publicDoc(info) }, 201);
  } catch (error) {
    await unlink(dest).catch(() => {});
    throw error;
  }
});

app.delete("/api/documents/:id", requireLogin, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID tidak valid." }, 400);
  const row = db.query("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | null;
  if (!row) return c.json({ error: "Dokumen tidak ditemukan." }, 404);
  db.query("DELETE FROM documents WHERE id = ?").run(id);
  await unlink(join(UPLOAD_DIR, row.stored_name)).catch(() => {});
  return c.json({ ok: true });
});

// Edit metadata dokumen (tanpa mengganti file).
app.patch("/api/documents/:id", requireLogin, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID tidak valid." }, 400);
  const row = db.query("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | null;
  if (!row) return c.json({ error: "Dokumen tidak ditemukan." }, 404);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Data tidak valid." }, 400);
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];
  if (body.title !== undefined) {
    const title = String(body.title).trim().slice(0, 200);
    if (!title) return c.json({ error: "Judul tidak boleh kosong." }, 400);
    updates.push("title = ?");
    params.push(title);
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    params.push(String(body.description).trim().slice(0, 2000));
  }
  if (body.subject !== undefined) {
    updates.push("subject = ?");
    params.push(String(body.subject).trim().slice(0, 100));
  }
  if (body.category !== undefined) {
    const category = String(body.category);
    if (!(CATEGORIES as readonly string[]).includes(category)) {
      return c.json({ error: "Kategori tidak dikenal." }, 400);
    }
    updates.push("category = ?");
    params.push(category);
  }
  if (body.grade !== undefined) {
    const grade = Number(body.grade);
    if (!GRADES.includes(grade as (typeof GRADES)[number])) {
      return c.json({ error: "Kelas harus 7, 8, atau 9." }, 400);
    }
    updates.push("grade = ?");
    params.push(grade);
  }
  if (!updates.length) return c.json({ error: "Tidak ada perubahan." }, 400);

  params.push(id);
  const updated = db
    .query(`UPDATE documents SET ${updates.join(", ")} WHERE id = ? RETURNING *`)
    .get(...params) as DocumentRow;
  return c.json({ document: publicDoc(updated) });
});

app.get("/api/documents/:id/download", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID tidak valid." }, 400);
  const row = db.query("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | null;
  if (!row) return c.json({ error: "Dokumen tidak ditemukan." }, 404);
  const f = Bun.file(join(UPLOAD_DIR, row.stored_name));
  return new Response(f, {
    headers: {
      "Content-Type": safeMime(row.ext),
      "Content-Disposition": `attachment; filename="${safeFilename(row.original_name)}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// ---------- File preview (inline) ----------

// Tipe yang bisa mengeksekusi script bila dibuka langsung (stored XSS):
// disajikan dalam "kotak pasir" (opaque origin, script dimatikan).
const SANDBOXED_EXTS = new Set(["html", "htm", "svg"]);

app.get("/files/:name", (c) => {
  const name = basename(c.req.param("name")); // cegah path traversal
  const row = db.query("SELECT * FROM documents WHERE stored_name = ?").get(name) as DocumentRow | null;
  if (!row) return c.json({ error: "File tidak ditemukan." }, 404);
  const f = Bun.file(join(UPLOAD_DIR, name));
  const headers: Record<string, string> = {
    "Content-Type": safeMime(row.ext),
    "Content-Disposition": PREVIEW_KINDS.has(row.kind)
      ? "inline"
      : `attachment; filename="${safeFilename(row.original_name)}"`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (SANDBOXED_EXTS.has(row.ext.toLowerCase())) {
    headers["Content-Security-Policy"] = "sandbox";
  }
  return new Response(f, { headers });
});

// ---------- Frontend ----------

app.use("/*", async (c, next) => {
  if (["/", "/index.html", "/app.js"].includes(c.req.path)) {
    c.header("Cache-Control", "no-store");
  }
  await next();
});
app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT ?? 3020);
console.log(`Gezy Learning Materials berjalan di http://localhost:${port}`);

export default { hostname: "127.0.0.1", port, fetch: app.fetch };
