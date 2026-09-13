import jsPDF from "jspdf";
import QRCode from "qrcode";
import type { BranchTable } from "@/lib/types";

/**
 * Bangun satu PDF berisi grid QR Code siap cetak & gunting — 6 kartu per
 * halaman (2 kolom x 3 baris), masing-masing berlabel nomor meja dan nama
 * cabang, supaya Owner/Manager tidak perlu unduh & susun satu-satu.
 */
export async function downloadTablesPdf(
  tables: BranchTable[],
  branchSlug: string,
  siteOrigin: string,
  branchName: string
) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const cols = 2;
  const rows = 3;
  const marginX = 15;
  const marginY = 15;
  const cardW = (pageWidth - marginX * 2) / cols;
  const cardH = (pageHeight - marginY * 2) / rows;
  const qrSize = Math.min(cardW, cardH) * 0.55;

  let col = 0;
  let row = 0;

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const orderUrl = `${siteOrigin}/order/${branchSlug}/${encodeURIComponent(table.table_number)}`;
    const qrDataUrl = await QRCode.toDataURL(orderUrl, { width: 400, margin: 1 });

    const x = marginX + col * cardW;
    const y = marginY + row * cardH;

    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(x + 3, y + 3, cardW - 6, cardH - 6, 3, 3);

    const qrX = x + (cardW - qrSize) / 2;
    doc.addImage(qrDataUrl, "PNG", qrX, y + 8, qrSize, qrSize);

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`Meja ${table.table_number}`, x + cardW / 2, y + qrSize + 16, { align: "center" });

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(branchName, x + cardW / 2, y + qrSize + 22, { align: "center" });
    doc.text("Scan untuk pesan & lihat menu", x + cardW / 2, y + qrSize + 27, { align: "center" });

    col++;
    if (col >= cols) {
      col = 0;
      row++;
    }
    if (row >= rows && i < tables.length - 1) {
      doc.addPage();
      row = 0;
      col = 0;
    }
  }

  doc.save(`qr-meja-${branchSlug || "cabang"}.pdf`);
}
