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
