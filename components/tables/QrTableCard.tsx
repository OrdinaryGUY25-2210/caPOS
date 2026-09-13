"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Trash2, Users } from "lucide-react";
import QRCode from "qrcode";
import type { BranchTable } from "@/lib/types";

/**
 * Render QR Code per meja (lib `qrcode`, client-side, tidak butuh koneksi
 * eksternal ke generator pihak ketiga). Setiap kode mengarah ke
 * `orderUrl` = capos.id/order/<slug-cabang>/<no-meja> sesuai spesifikasi.
 */
export default function QrTableCard({
  table,
  orderUrl,
  onDeactivate,
}: {
  table: BranchTable;
  orderUrl: string;
  onDeactivate: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string>("");

  useEffect(() => {
    QRCode.toDataURL(orderUrl, { width: 400, margin: 1, color: { dark: "#0F172A", light: "#FFFFFF" } }).then(setDataUrl);
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, orderUrl, { width: 220, margin: 1 });
    }
  }, [orderUrl]);

  function downloadPng() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `qr-meja-${table.table_number}.png`;
    a.click();
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 flex flex-col items-center">
      <canvas ref={canvasRef} className="rounded-lg" />
      <p className="font-bold text-neutral-900 mt-3">Meja {table.table_number}</p>
      <p className="text-xs text-neutral-500 flex items-center gap-1 mt-0.5">
        <Users size={12} /> {table.capacity} kursi
      </p>
      <p className="text-[10px] text-neutral-400 mt-1 break-all text-center px-2">{orderUrl}</p>
      <div className="flex gap-2 mt-3 w-full">
        <button
          onClick={downloadPng}
          className="flex-1 flex items-center justify-center gap-1.5 bg-neutral-900 text-white text-xs font-medium rounded-lg py-2"
        >
          <Download size={13} /> PNG
        </button>
        <button
          onClick={onDeactivate}
          className="flex items-center justify-center gap-1.5 bg-urgent-light text-urgent text-xs font-medium rounded-lg py-2 px-3"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
