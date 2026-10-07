import { isImageStorageConfigured, uploadImage } from "./cloudinary.js";

// Cek tipe file asli dari isi (magic bytes), bukan dari header yang dikirim client.
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

const MAX_INLINE_BYTES = 900 * 1024; // batas kalau Cloudinary belum diset (disimpan di DB)

// Simpan gambar: pakai Cloudinary kalau sudah dikonfigurasi,
// kalau belum -> simpan sebagai data-URL di database (frontend sudah mengecilkan gambar).
export async function saveImage(buffer, folder) {
  const type = sniffImageType(buffer);
  if (!type) {
    const e = new Error("File harus berupa gambar JPG, PNG, atau WebP");
    e.status = 400;
    throw e;
  }
  if (isImageStorageConfigured()) {
    return uploadImage(buffer, folder);
  }
  if (buffer.length > MAX_INLINE_BYTES) {
    const e = new Error("Gambar terlalu besar (maks ~900 KB tanpa Cloudinary). Coba kecilkan gambarnya.");
    e.status = 413;
    throw e;
  }
  return `data:${type};base64,${buffer.toString("base64")}`;
}
