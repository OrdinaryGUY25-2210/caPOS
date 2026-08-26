"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown, MessageCircle, ShoppingCart, Coffee, Users,
  CreditCard, BarChart3, Settings, Zap, ArrowRight,
} from "lucide-react";
import { whatsappLink, cx } from "@/lib/utils";

const FEATURE_GUIDE = [
  {
    icon: ShoppingCart,
    title: "Kasir (POS)",
    href: "/pos",
    desc: "Layar utama untuk melayani pelanggan: cari & pilih menu, atur jumlah pesanan, masukkan kode member untuk diskon, lalu Bayar. Struk bisa langsung dicetak (thermal 58mm/80mm). Tetap bisa dipakai walau internet mati — transaksi tersimpan otomatis dan sync begitu online lagi.",
  },
  {
    icon: BarChart3,
    title: "Laporan & Omzet",
    href: "/dashboard",
    desc: "Ringkasan penjualan: total omzet, jumlah transaksi, grafik harian. Paket Trial/Bulanan dapat Laporan Dasar; paket Tahunan dapat tambahan Jam Ramai, Menu Terlaris, dan export ke Excel/PDF.",
  },
  {
    icon: Coffee,
    title: "Kelola Menu & Stok",
    href: "/dashboard/menu",
    desc: "Tambah menu baru, upload foto, atur harga & kategori, dan tandai menu \"Habis/Nonaktif\" saat stok kosong supaya tidak muncul di layar kasir.",
  },
  {
    icon: Users,
    title: "Manajemen Kasir",
    href: "/dashboard/cashiers",
    desc: "Buat akun untuk staf kasir Anda (email + password sementara). Akun kasir cuma bisa akses halaman Kasir, tidak bisa lihat laporan/menu/pengaturan. Bisa dinonaktifkan sementara tanpa dihapus.",
  },
  {
    icon: CreditCard,
    title: "Membership",
    href: "/dashboard/membership",
    desc: "Kelola kartu member pelanggan tetap dengan diskon khusus. Kode member dimasukkan kasir saat checkout untuk potong harga otomatis. Fitur ini terhubung dengan paket Website Custom.",
  },
  {
    icon: Settings,
    title: "Pengaturan Kafe",
    href: "/dashboard/settings",
    desc: "Ubah nama, alamat, dan nomor telepon kafe yang tercetak di struk. Di sini juga tempat mengaktifkan & mengisi SSID/password WiFi yang ditampilkan di bagian bawah struk.",
  },
  {
    icon: Zap,
    title: "Status Langganan",
    href: "/dashboard/subscription",
    desc: "Cek sisa hari trial atau masa aktif langganan, dan perpanjang lewat pembayaran Midtrans (QRIS, kartu, transfer bank, dll). Paket Tahunan membuka fitur Laporan Lengkap.",
  },
];

const FAQS = [
  { q: "Bagaimana cara mencetak struk transaksi?", a: "Setelah pembayaran selesai di halaman /pos, klik tombol \"Cetak Struk\" — ini memanggil dialog print browser (window.print()), jadi printer thermal Anda HARUS sudah terpasang sebagai printer di sistem operasi (lewat driver USB/kabel/jaringan). Ukuran struk otomatis menyesuaikan 58mm/80mm lewat pengaturan CSS cetak. Printer thermal yang HANYA bisa connect via Bluetooth langsung (tanpa driver OS) belum didukung di versi ini." },
  { q: "Bagaimana cara menampilkan WiFi kafe di struk?", a: "Buka Pengaturan Kafe, aktifkan toggle \"Tampilkan WiFi di Struk\", lalu isi SSID dan password WiFi kafe Anda. Informasi ini akan otomatis dicetak di bagian bawah struk." },
  { q: "Apakah caPOS bisa dipakai saat internet mati?", a: "Bisa. Kasir tetap dapat memproses transaksi dalam mode Offline berkat penyimpanan lokal (IndexedDB). Transaksi akan otomatis tersinkron ke server begitu koneksi kembali online." },
  { q: "Bagaimana cara kerja diskon member?", a: "Di halaman kasir, masukkan Kode Member atau scan QR pelanggan pada kolom \"Kode Member / Scan QR Code\". Diskon akan otomatis terpotong dari subtotal transaksi." },
  { q: "Berapa lama masa trial caPOS?", a: "Masa trial berlaku 28 hari sejak pendaftaran. Anda dapat memperpanjang langganan melalui menu Status Langganan sebelum masa trial berakhir." },
  { q: "Apa bedanya Laporan Dasar dan Laporan Lengkap?", a: "Laporan Dasar (Trial & paket Bulanan) berisi grafik omzet harian dan total transaksi. Laporan Lengkap (paket Tahunan) menambahkan analisis Jam Ramai, Menu Terlaris, dan kemampuan export ke Excel/PDF." },
  { q: "Kenapa akun kasir tidak bisa buka halaman Dashboard?", a: "Ini memang disengaja untuk keamanan — akun kasir hanya diberi akses ke halaman Kasir (/pos). Kalau perlu lihat laporan, gunakan akun Owner." },
];

export default function FaqPage() {
  const [tab, setTab] = useState<"guide" | "faq">("guide");
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Panduan & Bantuan</h1>
        <p className="text-sm text-neutral-500">Pelajari tiap fitur caPOS atau cari jawaban cepat</p>
      </div>

      <div className="flex gap-1 bg-neutral-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab("guide")}
          className={cx("px-4 py-1.5 rounded-lg text-sm font-medium", tab === "guide" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500")}
        >
          Panduan Fitur
        </button>
        <button
          onClick={() => setTab("faq")}
          className={cx("px-4 py-1.5 rounded-lg text-sm font-medium", tab === "faq" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500")}
        >
          FAQ
        </button>
      </div>

      {tab === "guide" ? (
        <div className="space-y-3">
          {FEATURE_GUIDE.map((f) => {
            const Icon = f.icon;
            return (
              <Link
                key={f.title}
                href={f.href}
                className="card p-4 flex items-start gap-3 hover:border-primary transition-colors group"
              >
                <div className="w-10 h-10 rounded-xl bg-primary-light text-primary-dark flex items-center justify-center shrink-0">
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-neutral-900 text-sm">{f.title}</p>
                  <p className="text-sm text-neutral-500 mt-0.5 leading-relaxed">{f.desc}</p>
                </div>
                <ArrowRight size={16} className="text-neutral-300 group-hover:text-primary shrink-0 mt-2 transition-colors" />
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100">
          {FAQS.map((faq, i) => (
            <div key={i}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between p-4 text-left"
              >
                <span className="text-sm font-medium text-neutral-900">{faq.q}</span>
                <ChevronDown size={16} className={cx("text-neutral-400 transition-transform shrink-0 ml-3", open === i && "rotate-180")} />
              </button>
              {open === i && <p className="px-4 pb-4 text-sm text-neutral-500 leading-relaxed">{faq.a}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="card p-5 flex items-center justify-between">
        <div>
          <p className="font-semibold text-neutral-900 text-sm">Masih butuh bantuan?</p>
          <p className="text-xs text-neutral-500">Chat langsung dengan tim Studio D13</p>
        </div>
        <a
          href={whatsappLink("Halo Studio D13, saya butuh bantuan terkait aplikasi caPOS.")}
          target="_blank"
          rel="noreferrer"
          className="btn-primary flex items-center gap-2 whitespace-nowrap"
        >
          <MessageCircle size={16} /> Chat WhatsApp
        </a>
      </div>
    </div>
  );
}
