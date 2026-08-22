"use client";

import { useState } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { whatsappLink, cx } from "@/lib/utils";

const FAQS = [
  { q: "Bagaimana cara mencetak struk transaksi?", a: "Setelah pembayaran selesai di halaman /pos, klik tombol \"Cetak Struk\" pada jendela struk. caPOS mendukung printer thermal 58mm dan 80mm melalui window.print() atau koneksi Web Bluetooth." },
  { q: "Bagaimana cara menampilkan WiFi kafe di struk?", a: "Buka Pengaturan Kafe, aktifkan toggle \"Tampilkan WiFi di Struk\", lalu isi SSID dan password WiFi kafe Anda. Informasi ini akan otomatis dicetak di bagian bawah struk." },
  { q: "Apakah caPOS bisa dipakai saat internet mati?", a: "Bisa. Kasir tetap dapat memproses transaksi dalam mode Offline berkat penyimpanan lokal (IndexedDB). Transaksi akan otomatis tersinkron ke server begitu koneksi kembali online." },
  { q: "Bagaimana cara kerja diskon member?", a: "Di halaman kasir, masukkan Kode Member atau scan QR pelanggan pada kolom \"Kode Member / Scan QR Code\". Diskon akan otomatis terpotong dari subtotal transaksi." },
  { q: "Berapa lama masa trial caPOS?", a: "Masa trial berlaku 28 hari sejak pendaftaran. Anda dapat memperpanjang langganan melalui menu Status Langganan sebelum masa trial berakhir." },
];

export default function FaqPage() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">FAQ & Helpdesk</h1>
        <p className="text-sm text-neutral-500">Pertanyaan umum seputar sistem kasir caPOS</p>
      </div>

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
