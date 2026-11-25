/**
 * ESC/POS Thermal Printer Library — Generic, Model-Agnostic
 * Works with Bluetooth (Web Bluetooth), USB (WebUSB), Network (fetch to print server)
 * Paper width configurable: 58mm / 80mm
 * Charset configurable: CP858 (Latin), GB18030 (Chinese/Extended), UTF-8 (limited)
 */

export type PaperWidth = 58 | 80;
export type Charset = 'cp858' | 'gb18030' | 'utf8';
export type ConnectionType = 'bluetooth' | 'usb' | 'network';

export interface PrinterConfig {
  id: string;
  name: string;
  connection: ConnectionType;

  // Bluetooth
  bluetoothDeviceId?: string;
  bluetoothServiceUuid?: string; // default: 000018f0-0000-1000-8000-00805f9b34fb
  bluetoothCharUuid?: string;    // default: 00002af1-0000-1000-8000-00805f9b34fb

  // USB (WebUSB)
  usbVendorId?: number;
  usbProductId?: number;
  usbInterfaceNumber?: number;   // default: 0
  usbEndpointOut?: number;       // default: 1

  // Network (print server endpoint)
  networkUrl?: string;           // e.g. http://192.168.1.100:9100/print
  networkHeaders?: Record<string, string>;

  // Common
  paperWidth: PaperWidth;        // 58 or 80
  charset: Charset;              // encoding for text
  cutAfterPrint: boolean;        // true = cut after each print job
  isDefaultReceipt: boolean;
  isDefaultKitchen: boolean;
}

export interface PrintJob {
  type: 'receipt' | 'kitchen';
  transactionId: string;
  data: Uint8Array;
  timestamp: number;
  copies: number;
}

/** Char columns per paper width & font */
export const CHAR_COLUMNS = {
  58: { fontA: 32, fontB: 42 },
  80: { fontA: 48, fontB: 64 },
} as const;

/** Default UUIDs for common thermal printers */
export const DEFAULT_BLUETOOTH_UUIDS = {
  service: '000018f0-0000-1000-8000-00805f9b34fb',
  characteristic: '00002af1-0000-1000-8000-00805f9b34fb',
} as const;

/** ESC/POS Command Bytes */
export const ESC_POS = {
  // Initialize
  INIT: new Uint8Array([0x1b, 0x40]),           // ESC @
  // Print and feed
  LF: new Uint8Array([0x0a]),                   // Line feed
  FF: new Uint8Array([0x0c]),                   // Form feed
  CUT_FULL: new Uint8Array([0x1d, 0x56, 0x00]), // GS V m=0 (full cut)
  CUT_PARTIAL: new Uint8Array([0x1d, 0x56, 0x01]), // GS V m=1 (partial cut)
  // Text formatting
  BOLD_ON: new Uint8Array([0x1b, 0x45, 0x01]),  // ESC E 1
  BOLD_OFF: new Uint8Array([0x1b, 0x45, 0x00]), // ESC E 0
  UNDERLINE_ON: new Uint8Array([0x1b, 0x2d, 0x01]), // ESC - 1
  UNDERLINE_OFF: new Uint8Array([0x1b, 0x2d, 0x00]), // ESC - 0
  // Alignment
  ALIGN_LEFT: new Uint8Array([0x1b, 0x61, 0x00]), // ESC a 0
  ALIGN_CENTER: new Uint8Array([0x1b, 0x61, 0x01]), // ESC a 1
  ALIGN_RIGHT: new Uint8Array([0x1b, 0x61, 0x02]), // ESC a 2
  // Font size (GS !)
  SIZE_NORMAL: new Uint8Array([0x1d, 0x21, 0x00]), // 1x1
  SIZE_DOUBLE_W: new Uint8Array([0x1d, 0x21, 0x10]), // 2x1
  SIZE_DOUBLE_H: new Uint8Array([0x1d, 0x21, 0x01]), // 1x2
  SIZE_DOUBLE: new Uint8Array([0x1d, 0x21, 0x11]),   // 2x2
  SIZE_3X3: new Uint8Array([0x1d, 0x21, 0x22]),      // 3x3
  // Font select (ESC M) - Font A (12x24) / Font B (9x17)
  FONT_A: new Uint8Array([0x1b, 0x4d, 0x00]),
  FONT_B: new Uint8Array([0x1b, 0x4d, 0x01]),
  // Character code table (ESC t)
  CODEPAGE_CP437: new Uint8Array([0x1b, 0x74, 0x00]),
  CODEPAGE_KATAKANA: new Uint8Array([0x1b, 0x74, 0x01]),
  CODEPAGE_CP850: new Uint8Array([0x1b, 0x74, 0x02]),
  CODEPAGE_CP858: new Uint8Array([0x1b, 0x74, 0x13]), // CP858 (Euro)
  // Chinese codepages (printer dependent)
  CODEPAGE_GB18030: new Uint8Array([0x1b, 0x74, 0x18]), // GB18030
  // QR Code (GS k)
  // QR model 2, size 1-16, error correction 0-3 (L/M/Q/H)
  // Implementation in buildQRCode()
  // Barcode (GS k) - omitted for brevity
  // Drawer kick (ESC p)
  DRAWER_KICK: new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]),
  // Beep (GS B)
  BEEP: new Uint8Array([0x1d, 0x42, 0x03, 0x0a]),
} as const;

/** Convert string to Uint8Array using charset */
export function encodeText(text: string, charset: Charset): Uint8Array {
  if (charset === 'utf8') {
    return new TextEncoder().encode(text);
  }
  // For CP858/GB18030, we'd ideally use TextEncoder with that encoding
  // But browser TextEncoder only supports UTF-8.
  // Workaround: send as UTF-8 and rely on printer's UTF-8 mode (ESC t n=0x18 for GB18030)
  // or use a polyfill. For now, assume printer accepts UTF-8 when codepage set.
  return new TextEncoder().encode(text);
}

/** Build QR Code command (GS k) */
export function buildQRCode(data: string, options: {
  model?: 1 | 2;
  size?: 1 | 2 | 3 | 4 | 5 | 6;
  eclevel?: 'L' | 'M' | 'Q' | 'H';
} = {}): Uint8Array {
  const { model = 2, size = 3, eclevel = 'M' } = options;
  const ecMap = { L: 0x30, M: 0x31, Q: 0x32, H: 0x33 };
  const encoded = new TextEncoder().encode(data);
  const payload = new Uint8Array(4 + encoded.length);
  payload[0] = 0x1d;     // GS
  payload[1] = 0x28;     // (
  payload[2] = 0x6b;     // k
  payload[3] = 0x04;     // fn=4 (store QR code data)
  payload.set(encoded, 4);
  // Full sequence: select model -> set size -> set EC -> store data -> print
  const cmds: Uint8Array[] = [
    new Uint8Array([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]), // fn=65 select model 2
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]),        // fn=67 set size
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ecMap[eclevel]]), // fn=69 set EC
    payload,                                                                    // fn=80 store data
    new Uint8Array([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),        // fn=81 print
  ];
  return concatUint8Arrays(cmds);
}

/** Concatenate Uint8Arrays */
export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/** Word wrap text to fit column width (approximate for monospace) */
export function wrapText(text: string, maxCols: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if ((current + (current ? ' ' : '') + word).length <= maxCols) {
      current += (current ? ' ' : '') + word;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/** Center text with padding */
export function centerText(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text;
}

/** Right align text */
export function rightAlign(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  return ' '.repeat(pad) + text;
}

/** Build horizontal rule */
export function buildHR(width: number, char = '-'): string {
  return char.repeat(width);
}

/** Format currency Indonesian Rupiah */
export function formatRupiah(amount: number): string {
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(amount));
}

/** Build two-column line: left + right (price) */
export function buildTwoColumn(left: string, right: string, width: number): string {
  const leftMax = width - right.length - 1;
  const leftTruncated = left.length > leftMax ? left.slice(0, leftMax - 1) + '…' : left;
  const space = width - leftTruncated.length - right.length;
  return leftTruncated + ' '.repeat(Math.max(1, space)) + right;
}

export type { PrinterConfig, PrintJob };