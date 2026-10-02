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
