/**
 * Kompresi gambar di BROWSER (pakai Canvas API bawaan, tanpa library
 * tambahan) sebelum di-upload ke Supabase Storage. Foto menu dari HP
 * modern sering 3-8MB — tanpa kompresi ini, upload lambat dan boros
 * kuota Storage.
 *
 * Dua mode:
 * 1. Mode lama (tanpa `maxSizeKB`) — satu kali render JPEG kualitas
 *    tetap, sisi terpanjang dibatasi `maxDimension`. Dipakai apa
 *    adanya oleh pemanggil yang sudah ada (mis. foto shift kasir).
 * 2. Mode target ukuran (`maxSizeKB` diisi, biasanya dipakai bareng
 *    `format: "webp"`) — kualitas diturunkan bertahap (lalu dimensi
 *    kalau kualitas rendah masih belum cukup) sampai hasil ≤ `maxSizeKB`,
 *    maksimal 8 percobaan. Kalau browser tidak bisa meng-encode WebP
 *    (Safari lama), otomatis fallback ke JPEG.
 */
export async function compressImage(
  file: File,
  options: {
    maxDimension?: number;
    quality?: number;
    format?: "jpeg" | "webp";
    /** Kalau diisi, kualitas/dimensi diturunkan bertahap sampai file ≤ batas ini. */
    maxSizeKB?: number;
  } = {}
): Promise<File> {
  const { maxDimension = 1200, quality = 0.8, format = "jpeg", maxSizeKB } = options;

  // Kalau file bukan gambar (jarang terjadi karena <input accept="image/*">
  // sudah membatasi, tapi tetap dijaga), kembalikan apa adanya.
  if (!file.type.startsWith("image/")) return file;

  const imageBitmap = await createImageBitmap(file);

  let width = imageBitmap.width;
  let height = imageBitmap.height;
  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  let mimeType = format === "webp" ? "image/webp" : "image/jpeg";
  let ext = format === "webp" ? "webp" : "jpg";

  async function render(w: number, h: number, q: number, mime: string): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(imageBitmap, 0, 0, w, h);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, q));
  }

  let blob = await render(width, height, quality, mimeType);

  // Browser tidak bisa encode WebP (mis. Safari versi lama) — canvas.toBlob
  // mengembalikan null atau diam-diam balik ke PNG. Deteksi & fallback ke JPEG.
  if (format === "webp" && (!blob || blob.type !== "image/webp")) {
    mimeType = "image/jpeg";
    ext = "jpg";
    blob = await render(width, height, quality, mimeType);
  }

  if (!blob) return file;

  if (maxSizeKB) {
    const maxBytes = maxSizeKB * 1024;
    let q = quality;
    let w = width;
    let h = height;
    let attempts = 0;

    while (blob && blob.size > maxBytes && attempts < 8) {
      attempts++;
      if (q > 0.4) {
        q = Math.max(0.4, q - 0.1);
      } else {
        w = Math.round(w * 0.85);
        h = Math.round(h * 0.85);
      }
      blob = await render(w, h, q, mimeType);
    }

    if (!blob) return file;
  } else if (blob.size >= file.size) {
    // Mode lama: kalau hasil kompresi ternyata malah lebih besar dari asli
    // (bisa terjadi untuk gambar yang sudah kecil/simpel), pakai yang asli saja.
    return file;
  }

  const newName = file.name.replace(/\.[^.]+$/, "") + "." + ext;
  return new File([blob], newName, { type: mimeType });
}
