# Gezy Learning Materials 📚

Aplikasi web untuk **menyimpan dan mengelola dokumen pembelajaran SMP** — ATP, RPP,
Modul Ajar, LKPD, bahan ajar, media, video, audio, dan asesmen — terpisah rapi per
**Kelas 7, 8, dan 9**.

Dibangun dengan **Bun + Hono + bun:sqlite** (tanpa database server terpisah).

## Fitur

- 📤 Unggah file: `docx, doc, pdf, html, jpg/jpeg/png, gif, webp, svg, mp3, wav, m4a, mp4, webm, mov, pptx, xlsx, csv, zip, rar` (batas ukuran bisa diatur, bawaan 500 MB)
- 🗂️ Filter per **kelas (7/8/9)**, per **kategori** (ATP, RPP, Modul Ajar, LKPD, Bahan Ajar, Media, Video, Audio, Asesmen, Lainnya), dan **pencarian** (judul, mapel, nama file)
- 👁️ Pratinjau langsung di browser: gambar, PDF, HTML, video, dan audio
- ⬇️ Unduh & 🗑️ hapus dokumen
- 📊 Statistik: jumlah dokumen per kelas dan total ukuran
- 💾 Metadata tersimpan di SQLite (`data/gezy-materials.sqlite`), file tersimpan di `data/uploads/` — kedua folder ini **tidak** ikut ter-commit ke Git (lihat `.gitignore`)

## Menjalankan

```bash
bun install
bun run dev        # mode pengembangan (auto-reload)
# atau
bun run start      # mode biasa
```

Buka http://localhost:3020 — port bisa diganti dengan variabel `PORT`,
batas unggah dengan `MAX_UPLOAD_MB`.

## API ringkas

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/meta` | Daftar kategori, kelas, batas unggah |
| GET | `/api/stats` | Statistik dokumen |
| GET | `/api/documents?grade=&category=&kind=&q=` | Daftar dokumen (dengan filter) |
| POST | `/api/documents` | Unggah (multipart, field: `file, title, description, category, grade, subject`) |
| GET | `/api/documents/:id/download` | Unduh file |
| DELETE | `/api/documents/:id` | Hapus dokumen + file |
| GET | `/files/:stored_name` | File inline untuk pratinjau |

## Catatan soal “online lewat GitHub”

Yang sering dimaksud adalah **GitHub Pages**. Pages hanya bisa menyajikan situs
**statis** (HTML/CSS/JS) — ia **tidak bisa menjalankan server** Bun/Hono dan tidak
bisa memakai SQLite. Jadi aplikasi ini tidak bisa di-host di GitHub Pages.

GitHub di sini berfungsi sebagai **tempat menyimpan kode** (dan backup-nya).
Untuk online sungguhan, jalankan aplikasi ini di salah satu dari:

1. **VPS/server sendiri** (pola yang sama seperti GezyLMS: Bun sebagai service + Nginx sebagai reverse proxy + domain sendiri, mis. `materi.gezytech.web.id`)
2. **Platform yang mendukung Bun/Node**: Railway, Render, Fly.io, Hugging Face Spaces, dsb.

## Pengembangan berikutnya (ide)

- 🔐 Login admin/guru (agar tidak semua orang bisa mengunggah/menghapus)
- 🏷️ Tag & filter mata pelajaran
- 📁 Tampilan folder per mapel
- ☁️ Backup otomatis folder `data/`

---

Gezy Learning Materials © 2026
