export function formatRupiah(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

export function generateInvoiceNumber() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `INV-${stamp}-${rand}`;
}

export function daysRemaining(dateString: string) {
  const diff = new Date(dateString).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function whatsappLink(message: string) {
  const number = process.env.NEXT_PUBLIC_STUDIO_D13_WHATSAPP || "6281234567890";
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/**
 * Format string angka mentah (mis. "20000") jadi "20.000" untuk ditampilkan
 * di input field harga/HPP — supaya nominal besar gampang dibaca sekilas
 * saat diketik, tanpa mengubah value asli yang tersimpan (tetap digit saja).
 */
export function formatNumberWithDots(value: string | number) {
  const digits = String(value).replace(/[^0-9]/g, "");
  if (!digits) return "";
  return new Intl.NumberFormat("id-ID").format(Number(digits));
}

/** Ambil digit mentah dari input yang sudah diberi titik ribuan, mis. "20.000" -> "20000". */
export function stripNumberDots(value: string) {
  return value.replace(/[^0-9]/g, "");
}

/**
 * BARU (Phase 2A.3) — satu baris ringkas konfigurasi item (varian + modifier
 * terstruktur), dipakai KDS/struk/tiket dapur/Meja & Bill Terbuka supaya
 * semuanya menampilkan format yang sama. Fallback ke `variant_notes` bebas
 * teks lama kalau item belum punya konfigurasi terstruktur (order lama).
 */
export function formatItemConfigLine(item: {
  variant_name?: string | null;
  modifier_selections?: { name: string }[] | null;
  variant_notes?: string | null;
}): string | null {
  const parts: string[] = [];
  if (item.variant_name) parts.push(item.variant_name);
  if (item.modifier_selections && item.modifier_selections.length > 0) {
    parts.push(item.modifier_selections.map((m) => m.name).join(", "));
  }
  if (parts.length > 0) return parts.join(" · ");
  return item.variant_notes || null;
}

/**
 * Cetak struk thermal (58mm/80mm) — FIX bug lama: window.print() polos
 * membuat browser membuka dialog print dengan ukuran kertas default OS
 * (biasanya A4/Letter Portrait), bukan otomatis ke ukuran roll thermal,
 * sehingga konten struk terpotong di kanan/bawah walau printer POS-58/
 * POS-80 sudah dipilih manual. @page tidak bisa di-scope per elemen lewat
 * class biasa, jadi kita suntik <style> dengan ukuran yang sesuai TEPAT
 * sebelum window.print() dipanggil, lalu bersihkan lagi setelahnya.
 * Dipakai oleh semua tempat yang mencetak <Receipt/> (id="receipt-print"):
 * app/pos/page.tsx, components/pos/OpenBillPanel.tsx,
 * components/tables/TableStatusBoard.tsx.
 */
export function printReceipt(width: "58mm" | "80mm" = "80mm") {
  const styleId = "dynamic-receipt-page-size";
  let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = styleId;
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = `@media print { @page { size: ${width} auto; margin: 0; } }`;
  window.print();
}
