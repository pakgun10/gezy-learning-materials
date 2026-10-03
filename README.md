# Gezy Learning Materials 📚

Aplikasi web untuk **menyimpan dan mengelola dokumen pembelajaran SMP** — ATP, RPP,
Modul Ajar, LKPD, bahan ajar, media, video, audio, dan asesmen — terpisah rapi per
**Kelas 7, 8, 9, dan Umum** (misalnya buku referensi, pelajaran, pendamping, atau panduan).

Dibangun dengan **Bun + Hono + bun:sqlite** (tanpa database server terpisah).

## Fitur

- 🔑 **Login admin** (username + password, hash scrypt, sesi cookie HttpOnly 30 hari, rate-limit anti brute-force)
- 📤 Unggah file (admin saja): `docx, doc, pdf, html, jpg/jpeg/png, gif, webp, svg, mp3, wav, m4a, mp4, webm, mov, pptx, xlsx, csv, zip, rar` (batas ukuran bisa diatur, bawaan 500 MB)
- ✏️ Edit metadata dokumen (judul, mapel, kelas, kategori, keterangan) tanpa upload ulang
- 🗂️ Filter per **kelas (7/8/9)**, per **kategori** (ATP, RPP, Modul Ajar, LKPD, Bahan Ajar, Media, Video, Audio, Asesmen, Lainnya), dan **pencarian** (judul, mapel, nama file), dengan paginasi "Muat lebih banyak"
- 👁️ Pratinjau langsung di browser: gambar, PDF, HTML, video, dan audio (HTML/SVG disandbox agar aman)
- ⬇️ Unduh & 🗑️ hapus dokumen
- 📊 Statistik: jumlah dokumen per kelas dan total ukuran
- 💾 Metadata tersimpan di SQLite (`data/gezy-materials.sqlite`), file tersimpan di `data/uploads/` — kedua folder ini **tidak** ikut ter-commit ke Git (lihat `.gitignore`)
- 🛡️ Siap production: file deploy `deploy/` (systemd, nginx, skrip backup harian, panduan `DEPLOY.md`)

## Menjalankan

```bash
bun install
bun run dev        # mode pengembangan (auto-reload)
# atau
bun run start      # mode biasa
```

Buka http://localhost:3020 — port bisa diganti dengan variabel `PORT`,
batas unggah dengan `MAX_UPLOAD_MB`, folder data dengan `DATA_DIR`
(lihat `.env.example` untuk daftar lengkap).

## Akun admin

Baca (daftar dokumen, pratinjau, unduh) terbuka untuk umum, tetapi
**mengunggah dan menghapus hanya bisa dilakukan setelah login**.

Buat akun admin dengan (password minimal 10 karakter):

```bash
ADMIN_USERNAME=pakgun ADMIN_PASSWORD=<password-10-karakter> bun run setup-admin
```

Jalankan ulang perintah yang sama untuk mengganti password kapan saja.
Password tidak pernah disimpan di kode maupun di Git — hanya hash-nya yang
tersimpan di `data/gezy-materials.sqlite`.

## API ringkas

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/login` | Login (`{"username","password"}`) |
| POST | `/api/logout` | Keluar |
| GET | `/api/me` | Info sesi saat ini |
| GET | `/api/meta` | Daftar kategori, kelas, batas unggah |
| GET | `/api/stats` | Statistik dokumen |
| GET | `/api/health` | Cek hidup (untuk monitoring) |
| GET | `/api/documents?grade=&category=&kind=&q=&page=&limit=` | Daftar dokumen (dengan filter + paginasi) |
| POST | `/api/documents` | Unggah (multipart, field: `file, title, description, category, grade, subject`; `grade=0` berarti Umum) |
| PATCH | `/api/documents/:id` | Edit metadata (JSON: `title, description, category, grade, subject`) |
| GET | `/api/documents/:id/download` | Unduh file |
| DELETE | `/api/documents/:id` | Hapus dokumen + file |
| GET | `/files/:stored_name` | File inline untuk pratinjau |

## Catatan soal “online lewat GitHub”

Yang sering dimaksud adalah **GitHub Pages**. Pages hanya bisa menyajikan situs
**statis** (HTML/CSS/JS) — ia **tidak bisa menjalankan server** Bun/Hono dan tidak
bisa memakai SQLite. Jadi aplikasi ini tidak bisa di-host di GitHub Pages.

GitHub di sini berfungsi sebagai **tempat menyimpan kode** (dan backup-nya).
Untuk online sungguhan, jalankan aplikasi ini di salah satu dari:

1. **VPS/server sendiri** (pola yang sama seperti GezyLMS: Bun sebagai service + Nginx sebagai reverse proxy + domain sendiri, mis. `materials.gezytech.web.id`)
2. **Platform yang mendukung Bun/Node**: Railway, Render, Fly.io, Hugging Face Spaces, dsb.

## Pengembangan berikutnya (ide)

- 🏷️ Tag & filter mata pelajaran
- 📁 Tampilan folder per mapel

## Deploy ke VPS

Lihat `deploy/DEPLOY.md` — panduan lengkap: systemd service, nginx reverse
proxy + HTTPS, backup otomatis harian, dan cara update.

---

Gezy Learning Materials © 2026
