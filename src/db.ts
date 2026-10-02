import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = join(import.meta.dir, "..", "data");
export const UPLOAD_DIR = join(DATA_DIR, "uploads");

mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, "gezy-materials.sqlite"), {
  create: true,
});

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL,
    grade        INTEGER NOT NULL CHECK (grade IN (7, 8, 9)),
    subject      TEXT NOT NULL DEFAULT '',
    original_name TEXT NOT NULL,
    stored_name  TEXT NOT NULL UNIQUE,
    ext          TEXT NOT NULL,
    mime         TEXT NOT NULL DEFAULT '',
    kind         TEXT NOT NULL,
    size         INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_documents_grade ON documents(grade);
  CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin',
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

export type DocumentRow = {
  id: number;
  title: string;
  description: string;
  category: string;
  grade: number;
  subject: string;
  original_name: string;
  stored_name: string;
  ext: string;
  mime: string;
  kind: string;
  size: number;
  created_at: string;
};

export const CATEGORIES = [
  "ATP",
  "RPP",
  "Modul Ajar",
  "LKPD",
  "Bahan Ajar",
  "Media",
  "Video",
  "Audio",
  "Asesmen",
  "Lainnya",
] as const;

export const GRADES = [7, 8, 9] as const;

/** Kelompokkan ekstensi file ke jenis tampilan (ikon & preview). */
export function kindOf(ext: string): string {
  const e = ext.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"].includes(e)) return "gambar";
  if (["mp4", "webm", "mov", "mkv"].includes(e)) return "video";
  if (["mp3", "wav", "m4a", "ogg", "flac"].includes(e)) return "audio";
  if (e === "pdf") return "pdf";
  if (["html", "htm"].includes(e)) return "html";
  if (["docx", "doc", "odt", "rtf", "txt", "md"].includes(e)) return "dokumen";
  if (["pptx", "ppt", "odp"].includes(e)) return "presentasi";
  if (["xlsx", "xls", "csv", "ods"].includes(e)) return "spreadsheet";
  if (["zip", "rar", "7z"].includes(e)) return "arsip";
  return "file";
}

export const ACCEPTED_EXTS = new Set([
  "docx", "doc", "pdf", "html", "htm", "txt", "md", "odt", "rtf",
  "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif",
  "mp3", "wav", "m4a", "ogg", "flac",
  "mp4", "webm", "mov", "mkv",
  "pptx", "ppt", "xlsx", "xls", "csv",
  "zip", "rar", "7z",
]);

// ---------- Pengguna & sesi ----------

export type UserRow = {
  id: number;
  username: string;
  role: string;
  password_hash: string;
  created_at: string;
};

export type SessionUser = { id: number; username: string; role: string };

export const SESSION_COOKIE = "glm_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 hari

export function getUserByUsername(username: string): UserRow | null {
  return db.query("SELECT * FROM users WHERE username = ?").get(username.trim()) as UserRow | null;
}

/** Buat / perbarui admin. Dipakai lewat skrip setup-admin.ts (password via env). */
export async function upsertAdmin(username: string, password: string): Promise<void> {
  const hash = await Bun.password.hash(password);
  const existing = getUserByUsername(username);
  if (existing) {
    db.query("UPDATE users SET password_hash = ?, role = 'admin' WHERE username = ?").run(hash, username);
  } else {
    db.query("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hash);
  }
}

export function createSession(userId: number): string {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expiresAt);
  return token;
}

export function getSessionUser(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db
    .query(
      `SELECT u.id, u.username, u.role FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > (strftime('%s','now') * 1000)`,
    )
    .get(token) as SessionUser | null;
  return row;
}

export function deleteSession(token: string): void {
  db.query("DELETE FROM sessions WHERE token = ?").run(token);
}

export function cleanupExpiredSessions(): void {
  db.query("DELETE FROM sessions WHERE expires_at <= (strftime('%s','now') * 1000)").run();
}
