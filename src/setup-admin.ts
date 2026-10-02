/**
 * Membuat / memperbarui akun admin Gezy Learning Materials.
 *
 * Cara pakai (password JANGAN ditulis di dalam kode atau commit ke Git!):
 *   ADMIN_USERNAME=pakgun ADMIN_PASSWORD=<password-10-karakter> bun run setup-admin
 *
 * Kalau dijalankan ulang dengan username yang sama, password diperbarui.
 */
import { upsertAdmin } from "./db";

const username = (process.env.ADMIN_USERNAME ?? "pakgun").trim();
const password = process.env.ADMIN_PASSWORD ?? "";

if (!username) {
  console.error("ADMIN_USERNAME tidak boleh kosong.");
  process.exit(1);
}
if (!password) {
  console.error("ADMIN_PASSWORD belum diisi.");
  console.error("Contoh: ADMIN_USERNAME=pakgun ADMIN_PASSWORD=rahasia10 bun run setup-admin");
  process.exit(1);
}
if (password.length < 10) {
  console.error("Password harus minimal 10 karakter.");
  process.exit(1);
}

await upsertAdmin(username, password);
console.log(`Akun admin "${username}" berhasil dibuat/diperbarui.`);
console.log("Jalankan ulang perintah ini kapan saja untuk mengganti password.");
