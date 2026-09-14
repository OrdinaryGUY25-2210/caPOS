/**
 * Kitchen/Bar Printer Routing (Phase 2)
 * =====================================
 * Integrasi printer thermal dapur/bar via Web Bluetooth. Browser yang
 * mendukung: Chrome/Edge desktop & Android (bukan iOS Safari — Web
 * Bluetooth belum didukung Apple; untuk iOS sediakan fallback "Cetak
 * via Share Sheet / AirPrint" di UI kalau connectPrinter() melempar
 * NOT_SUPPORTED).
 *
 * Alur pemakaian:
 *   1. Kasir pasangkan printer sekali per stasiun dari /kitchen atau
 *      /dashboard/settings -> connectPrinter() -> simpan device id ke
 *      kitchen_stations.printer_name (opsional, untuk label saja;
 *      device BluetoothDevice sendiri tidak bisa disimpan lintas-sesi
 *      karena keterbatasan Web Bluetooth, jadi user perlu pasangkan
 *      ulang tiap browser/perangkat baru — ini batasan platform, bukan bug).
 *   2. Saat order dibuat di POS, kelompokkan item per station_id lalu
 *      panggil printStationTicket() untuk tiap stasiun yang punya printer
 *      terpasang di sesi ini.
 *   3. Fitur Reprint Ticket memanggil ulang printStationTicket() dengan
 *      data order yang sama.
 */

import type { OrderWithItems, OrderItem, OrderType } from "@/lib/types";
import { formatItemConfigLine } from "@/lib/utils";

// Service/characteristic UUID standar printer thermal ESC/POS Bluetooth
// (mengikuti profil "Generic Serial" yang dipakai mayoritas printer
// thermal murah 58mm/80mm yang beredar di Indonesia — mis. seri
// goojprt/EPPOS). Printer lain mungkin butuh UUID berbeda; sesuaikan di sini.
const PRINTER_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const PRINTER_CHARACTERISTIC_UUID = "00002af1-0000-1000-8000-00805f9b34fb";

// Perangkat yang sudah dipasangkan di sesi browser ini, dikunci per
// stasiun (kitchen_stations.id) supaya "cetak ke Printer Bar" dan
// "cetak ke Printer Dapur" tidak tertukar.
const connectedDevices = new Map<string, BluetoothRemoteGATTCharacteristic>();

export class PrinterNotSupportedError extends Error {
  constructor() {
    super("Web Bluetooth tidak didukung di browser/perangkat ini. Gunakan Chrome/Edge di Android atau Desktop.");
    this.name = "PrinterNotSupportedError";
  }
}

/** Cek dukungan sebelum menampilkan tombol "Sambungkan Printer" di UI. */
export function isPrinterSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

/**
 * Buka dialog pairing Bluetooth untuk sebuah stasiun dapur. Panggil dari
 * klik tombol pengguna langsung (browser mewajibkan user-gesture untuk
 * requestDevice) — jangan panggil otomatis di useEffect.
 */
export async function connectStationPrinter(stationId: string): Promise<{ deviceName: string }> {
  if (!isPrinterSupported()) throw new PrinterNotSupportedError();

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [PRINTER_SERVICE_UUID] }],
    optionalServices: [PRINTER_SERVICE_UUID],
  });

  const server = await device.gatt?.connect();
  if (!server) throw new Error("Gagal menyambungkan ke printer.");

  const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

  connectedDevices.set(stationId, characteristic);

  device.addEventListener("gattserverdisconnected", () => {
    connectedDevices.delete(stationId);
  });

  return { deviceName: device.name || "Printer Dapur" };
}

export function isStationPrinterConnected(stationId: string): boolean {
  return connectedDevices.has(stationId);
}

// --- Pembentukan tiket ESC/POS sederhana (teks + perintah dasar) --------

const ESC = 0x1b;
const GS = 0x1d;

function textEncoder() {
  return new TextEncoder();
}

/** Bungkus baris teks dengan perintah ESC/POS: bold, center, cut kertas. */
function buildTicketBytes(lines: { text: string; bold?: boolean; center?: boolean; size?: "normal" | "large" }[]): Uint8Array {
  const enc = textEncoder();
  const chunks: number[] = [ESC, 0x40]; // reset printer

  for (const line of lines) {
    chunks.push(ESC, 0x61, line.center ? 0x01 : 0x00); // align
    chunks.push(ESC, 0x45, line.bold ? 0x01 : 0x00); // bold
    chunks.push(GS, 0x21, line.size === "large" ? 0x11 : 0x00); // font size
    chunks.push(...Array.from(enc.encode(line.text + "\n")));
  }

  chunks.push(ESC, 0x64, 0x03); // feed 3 lines
  chunks.push(GS, 0x56, 0x00); // full cut
  return new Uint8Array(chunks);
}

const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  dine_in: "DINE-IN",
  takeaway: "TAKEAWAY",
  delivery: "DELIVERY",
};

/**
 * Cetak tiket dapur/bar untuk SATU stasiun dari sebuah order. Hanya item
 * dengan station_id yang cocok yang ikut tercetak — inilah mekanisme
 * "routing" otomatis (tiket minuman ke Printer Bar, tiket makanan ke
 * Printer Dapur) yang diminta di spesifikasi.
 */
export async function printStationTicket(
  order: OrderWithItems,
  stationId: string,
  stationName: string,
  cashierName: string,
  opts?: { reprint?: boolean }
): Promise<void> {
  const characteristic = connectedDevices.get(stationId);
  if (!characteristic) {
    throw new Error(`Printer untuk stasiun "${stationName}" belum disambungkan.`);
  }

  const items = order.order_items.filter((i) => i.station_id === stationId);
  if (items.length === 0) return; // tidak ada item untuk stasiun ini — tidak perlu cetak

  const lines: { text: string; bold?: boolean; center?: boolean; size?: "normal" | "large" }[] = [
    { text: stationName.toUpperCase(), bold: true, center: true, size: "large" },
    { text: opts?.reprint ? "** CETAK ULANG **" : "", center: true },
    { text: "--------------------------------" },
    { text: `${order.order_number}  |  ${ORDER_TYPE_LABEL[order.order_type]}`, bold: true, size: "large" },
    { text: order.table_number ? `Meja: ${order.table_number}` : order.customer_name ? `Nama: ${order.customer_name}` : "" },
    { text: `Kasir: ${cashierName}` },
    { text: `Jam: ${new Date(order.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` },
    { text: "--------------------------------" },
  ];

  for (const item of items) {
    lines.push({ text: `${item.qty}x ${item.product_name}`, bold: true });
    const configLine = formatItemConfigLine(item);
    if (configLine) lines.push({ text: `   -> ${configLine}` });
  }

  if (order.notes) {
    lines.push({ text: "--------------------------------" });
    lines.push({ text: `Catatan: ${order.notes}` });
  }

  const bytes = buildTicketBytes(lines.filter((l) => l.text !== ""));

  // Kirim per potongan kecil (MTU Bluetooth Classic biasanya terbatas
  // ~180-512 byte) supaya tidak terpotong di printer murah.
  const CHUNK = 180;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    await characteristic.writeValueWithoutResponse(bytes.slice(offset, offset + CHUNK));
  }
}

/**
 * Cetak SEMUA tiket stasiun yang relevan untuk sebuah order sekaligus
 * (dipanggil sekali saat order baru dibuat di POS). Stasiun yang
 * printernya belum tersambung di-skip dengan pesan, bukan melempar
 * error yang menghentikan seluruh alur checkout.
 */
export async function printAllStationTickets(
  order: OrderWithItems,
  stations: { id: string; name: string }[],
  cashierName: string
): Promise<{ printed: string[]; skipped: string[] }> {
  const printed: string[] = [];
  const skipped: string[] = [];

  const stationIdsInOrder = new Set(order.order_items.map((i) => i.station_id).filter(Boolean) as string[]);

  for (const station of stations) {
    if (!stationIdsInOrder.has(station.id)) continue;
    if (!isStationPrinterConnected(station.id)) {
      skipped.push(station.name);
      continue;
    }
    try {
      await printStationTicket(order, station.id, station.name, cashierName);
      printed.push(station.name);
    } catch {
      skipped.push(station.name);
    }
  }

  return { printed, skipped };
}
