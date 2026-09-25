"use client";

import React, { useEffect, useState } from "react";
import { Printer, Settings2 } from "lucide-react";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Button } from "@/components/ui/Button";
import HardwareWizardModal from "@/components/settings/hardware-wizard-modal";
import Receipt from "@/components/Receipt";
import { buildSampleReceiptData } from "@/lib/sampleReceipt";
import { printReceipt } from "@/lib/utils";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { createClient } from "@/lib/supabase/client";

/**
 * "Tes Cetak Struk" di bawah ini sebelumnya (di dalam
 * HardwareWizardModal step 2) cuma setTimeout(1500ms) yang berpura-pura
 * mencetak — tidak ada isi struk apa pun, tidak benar-benar memanggil
 * window.print(). Sekarang beneran mencetak struk contoh (item belanja
 * kafe asli) lewat komponen <Receipt/> yang sama dipakai di kasir
 * (app/pos/page.tsx), memakai printReceipt() yang sama juga — supaya
 * owner bisa mengecek hasil cetak SEBELUM ada transaksi sungguhan,
 * termasuk mengecek setelan lebar kertas & header/footer dari
 * /dashboard/settings/receipt.
 */
export default function HardwareSettingsPage() {
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">("80mm");
  const [showPreview, setShowPreview] = useState(false);
  // buildSampleReceiptData() memakai new Date() (invoiceNumber, createdAt)
  // — kalau dipanggil langsung di body komponen, nilainya beda antara
  // render server (SSR) dan render pertama di client (hydration), yang
  // ujungnya bikin React error "Text content does not match
  // server-rendered HTML". Ditunda sampai sesudah mount (sama seperti
  // pola fetch tenant di bawah) supaya SSR tidak pernah menyentuh tanggal
  // sama sekali.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Ambil pengaturan struk asli tenant (nama, lebar kertas, header/footer)
  // supaya struk percobaan mencerminkan setelan sungguhan, bukan cuma
  // data contoh generik yang tidak nyambung dengan kafe user.
  const [tenantOverrides, setTenantOverrides] = useState<{
    cafeName?: string;
    cafeAddress?: string;
    headerText?: string | null;
    footerText?: string | null;
  }>({});

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) return;
      const supabase = createClient();
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, address, receipt_paper_width, receipt_header_text, receipt_footer_text")
        .eq("id", profile.tenant_id)
        .single();
      if (tenant) {
        setPaperWidth((tenant.receipt_paper_width as "58mm" | "80mm") ?? "80mm");
        setTenantOverrides({
          cafeName: tenant.name || undefined,
          cafeAddress: tenant.address || undefined,
          headerText: tenant.receipt_header_text,
          footerText: tenant.receipt_footer_text,
        });
      }
    })();
  }, []);

  const sampleData = mounted ? buildSampleReceiptData({ width: paperWidth, ...tenantOverrides }) : null;

  function handlePrintTest() {
    printReceipt(paperWidth);
  }

  return (
    <div className="space-y-6">
      <SettingsHeader
        backHref="/dashboard/settings"
        title="Pengaturan Hardware & Printer"
        description="Kelola perangkat printer thermal dan periferal kasir caPOS"
      />

      <SettingsCard title="Printer Struk & Dapur" description="Setup koneksi printer Bluetooth / USB secara langsung">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-neutral-500 flex items-center gap-2">
            <Settings2 size={15} className="text-neutral-400" />
            Pandu koneksi printer langkah demi langkah
          </p>
          <Button variant="primary" onClick={() => setIsWizardOpen(true)}>
            Mulai Setup Wizard
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Tes Cetak Struk"
        description="Cetak struk contoh untuk mengecek printer & tampilan kwitansi sebelum dipakai transaksi asli"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-neutral-500 flex items-center gap-2">
              <Printer size={15} className="text-neutral-400" />
              Memakai lebar kertas <span className="font-medium text-neutral-700">{paperWidth}</span> dari{" "}
              <a href="/dashboard/settings/receipt" className="text-primary hover:underline">
                Pengaturan Kwitansi
              </a>
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? "Sembunyikan Pratinjau" : "Pratinjau Struk"}
              </Button>
              <Button variant="primary" size="sm" onClick={handlePrintTest}>
                Cetak Struk Percobaan
              </Button>
            </div>
          </div>

          {showPreview && !isWizardOpen && sampleData && (
            <div className="border border-dashed border-neutral-300 rounded-xl bg-neutral-50 p-4 flex justify-center overflow-x-auto">
              <div className="shadow-sm">
                <Receipt data={sampleData} />
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Persis SATU <Receipt id="receipt-print"/> yang boleh ter-mount
          dari halaman ini kapan pun — dua sekaligus (mis. saat pratinjau
          dibuka lalu wizard juga dibuka) berarti dua elemen id sama di
          DOM, invalid & bikin window.print() mencetak dobel/tumpang
          tindih. Kalau wizard modal terbuka, DIA yang mengurus
          off-screen-nya sendiri (lihat hardware-wizard-modal.tsx) — di
          sini dilewati sepenuhnya. Kalau tidak, tampilkan versi terlihat
          saat showPreview aktif, atau versi off-screen (posisi di luar
          layar, BUKAN display:none, supaya aturan @media print di
          globals.css — yang cuma mengubah `visibility` — tetap bisa
          memunculkannya) supaya tombol "Cetak Struk Percobaan" tetap
          bekerja walau pratinjau sedang disembunyikan. */}
      {!isWizardOpen && !showPreview && sampleData && (
        <div style={{ position: "fixed", top: 0, left: "-9999px" }} aria-hidden="true">
          <Receipt data={sampleData} />
        </div>
      )}

      <HardwareWizardModal isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
    </div>
  );
}
