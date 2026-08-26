/**
 * Kompresi gambar di BROWSER (pakai Canvas API bawaan, tanpa library
 * tambahan) sebelum di-upload ke Supabase Storage. Foto menu dari HP
 * modern sering 3-8MB — tanpa kompresi ini, upload lambat dan boros
 * kuota Storage. Hasil dikompres ke JPEG kualitas 80% dengan sisi
 * terpanjang dibatasi 1200px, biasanya menyusut 80-95% dari ukuran asli
 * tanpa terlihat bedanya di layar kasir/menu.
 */
export async function compressImage(
  file: File,
  options: { maxDimension?: number; quality?: number } = {}
): Promise<File> {
  const { maxDimension = 1200, quality = 0.8 } = options;

  // Kalau file bukan gambar (jarang terjadi karena <input accept="image/*">
  // sudah membatasi, tapi tetap dijaga), kembalikan apa adanya.
  if (!file.type.startsWith("image/")) return file;

  const imageBitmap = await createImageBitmap(file);

  let { width, height } = imageBitmap;
  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file; // fallback: kalau canvas gagal, upload asli saja

  ctx.drawImage(imageBitmap, 0, 0, width, height);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );

  if (!blob) return file;

  // Kalau hasil kompresi ternyata malah lebih besar dari asli (bisa
  // terjadi untuk gambar yang sudah kecil/simpel), pakai yang asli saja.
  if (blob.size >= file.size) return file;

  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg" });
}
