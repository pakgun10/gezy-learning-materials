import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
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

app.use("/api/*", cors());

cleanupExpiredSessions();

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 500);

function publicDoc(d: DocumentRow) {  return {
    id: d.id,
    title: d.title,
    description: d.description,
    category: d.category,
    grade: d.grade,
    subject: d.subject,
    originalName: d.original_name,
    ext: d.ext,
    mime: d.mime,
    kind: d.kind,
    size: d.size,
    createdAt: d.created_at,
    url: `/files/${encodeURIComponent(d.stored_name)}`,
    downloadUrl: `/api/documents/${d.id}/download`,
  };
}

// ---------- Autentikasi ----------

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
  const user = username ? getUserByUsername(username) : null;
  if (!user || !(await Bun.password.verify(password, user.password_hash))) {
    return c.json({ error: "Username atau password salah." }, 401);
  }
  const token = createSession(user.id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
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
  const rows = db.query(sql).all(...params) as DocumentRow[];
  return c.json({ documents: rows.map(publicDoc) });
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

  const ext = extname(file.name).replace(".", "").toLowerCase();
  if (!ACCEPTED_EXTS.has(ext)) {
    return c.json({ error: `Jenis file .${ext || "?"} belum didukung.` }, 415);
  }

  const grade = Number(body["grade"]);
  if (!GRADES.includes(grade as (typeof GRADES)[number])) {
    return c.json({ error: "Kelas wajib dipilih: 7, 8, atau 9." }, 400);
  }
  const categoryRaw = String(body["category"] ?? "Lainnya");
  const category = (CATEGORIES as readonly string[]).includes(categoryRaw) ? categoryRaw : "Lainnya";
  const title = String(body["title"] ?? "").trim() || file.name.replace(/\.[^.]+$/, "");
  const description = String(body["description"] ?? "").trim();
  const subject = String(body["subject"] ?? "").trim();

  const safeBase = basename(file.name, extname(file.name))
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .slice(0, 60) || "dokumen";
  const storedName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeBase}.${ext}`;
  const dest = join(UPLOAD_DIR, storedName);
  await Bun.write(dest, file);

  const info = db
    .query(
      `INSERT INTO documents (title, description, category, grade, subject, original_name, stored_name, ext, mime, kind, size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(title, description, category, grade, subject, file.name, storedName, ext, file.type || "", kindOf(ext), file.size) as DocumentRow;

  return c.json({ document: publicDoc(info) }, 201);
});

app.delete("/api/documents/:id", requireLogin, async (c) => {
  const id = Number(c.req.param("id"));
  const row = db.query("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | null;
  if (!row) return c.json({ error: "Dokumen tidak ditemukan." }, 404);
  db.query("DELETE FROM documents WHERE id = ?").run(id);
  await unlink(join(UPLOAD_DIR, row.stored_name)).catch(() => {});
  return c.json({ ok: true });
});

app.get("/api/documents/:id/download", (c) => {
  const id = Number(c.req.param("id"));
  const row = db.query("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | null;
  if (!row) return c.json({ error: "Dokumen tidak ditemukan." }, 404);
  const f = Bun.file(join(UPLOAD_DIR, row.stored_name));
  return new Response(f, {
    headers: {
      "Content-Type": row.mime || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${row.original_name.replace(/"/g, "")}"`,
    },
  });
});

// ---------- File preview (inline) ----------

app.get("/files/:name", (c) => {
  const name = basename(c.req.param("name")); // cegah path traversal
  const row = db.query("SELECT * FROM documents WHERE stored_name = ?").get(name) as DocumentRow | null;
  if (!row) return c.json({ error: "File tidak ditemukan." }, 404);
  const f = Bun.file(join(UPLOAD_DIR, name));
  return new Response(f, {
    headers: {
      "Content-Type": row.mime || "application/octet-stream",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
    },
  });
});

// ---------- Frontend ----------

app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT ?? 3020);
console.log(`Gezy Learning Materials berjalan di http://localhost:${port}`);

export default { port, fetch: app.fetch };
