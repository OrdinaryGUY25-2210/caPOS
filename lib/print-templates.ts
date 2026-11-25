/**
 * Print Templates — Kitchen Ticket & Customer Receipt
 * Pure functions: input transaction data → Uint8Array (ESC/POS)
 * No side effects, fully testable, model-agnostic
 */

import {
  PrinterConfig,
  PaperWidth,
  Charset,
  CHAR_COLUMNS,
  ESC_POS,
  encodeText,
  concatUint8Arrays,
  wrapText,
  centerText,
  rightAlign,
  buildHR,
  formatRupiah,
  buildTwoColumn,
  buildQRCode,
} from './printer';

export interface TransactionData {
  // Identitas
  invoiceNo: string;
  transactionId: string;
  createdAt: string;        // ISO string
  // Tenant / Kafe
  tenantName: string;
  tenantAddress?: string;
  tenantPhone?: string;
  // Kasir
  cashierName: string;
  shiftNo?: string;
  // Meja / Antrian
  tableNo?: string;         // dari qr_tables
  queueNo?: string;         // nomor antrian take-away
  // Pembayaran
  paymentMethod: 'cash' | 'qris' | 'card' | 'transfer' | 'other';
  paymentMethodLabel: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  change: number;
  // Items
  items: TransactionItem[];
  // QR Review / Link
  reviewUrl?: string;
  // Catatan
  note?: string;
}

export interface TransactionItem {
  id: string;
  name: string;
  qty: number;
  price: number;
  subtotal: number;
  category?: string;           // 'food' | 'drink' | 'dessert' | etc
  kitchenNote?: string;        // catatan khusus dapur: "tanpa cabe", "extra keju"
  modifiers?: string[];        // varian/modifier yang dipilih
  isKitchenItem?: boolean;     // true = cetak ke tiket dapur (default: category === 'food')
}

/** Options for template generation */
export interface TemplateOptions {
  paperWidth: PaperWidth;
  charset: Charset;
  includeHeader: boolean;
  includeFooter: boolean;
  includeQR: boolean;
  fontSize: 'normal' | 'large';      // kitchen: large, receipt: normal
  fontType: 'A' | 'B';               // A=12x24, B=9x17
}

/** Default options per print type */
export const DEFAULT_OPTIONS: Record<'receipt' | 'kitchen', TemplateOptions> = {
  receipt: {
    paperWidth: 58,
    charset: 'cp858',
    includeHeader: true,
    includeFooter: true,
    includeQR: true,
    fontSize: 'normal',
    fontType: 'A',
  },
  kitchen: {
    paperWidth: 58,
    charset: 'cp858',
    includeHeader: true,
    includeFooter: true,
    includeQR: false,
    fontSize: 'large',
    fontType: 'A',
  },
};

/** Get column count for current paper/font */
function getCols(paperWidth: PaperWidth, fontType: 'A' | 'B'): number {
  return CHAR_COLUMNS[paperWidth][fontType === 'A' ? 'fontA' : 'fontB'];
}

/** Build header section (tenant name, address, invoice) */
function buildHeader(tx: TransactionData, cols: number, opts: TemplateOptions): Uint8Array[] {
  const cmds: Uint8Array[] = [];
  const { tenantName, tenantAddress, tenantPhone, invoiceNo, createdAt, cashierName, shiftNo, tableNo, queueNo } = tx;

  cmds.push(ESC_POS.ALIGN_CENTER);
  if (opts.fontSize === 'large') cmds.push(ESC_POS.SIZE_DOUBLE);
  cmds.push(encodeText(tenantName.toUpperCase(), opts.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(ESC_POS.SIZE_NORMAL);

  if (tenantAddress) {
    cmds.push(ESC_POS.ALIGN_CENTER);
    for (const line of wrapText(tenantAddress, cols)) {
      cmds.push(encodeText(line, opts.charset));
      cmds.push(ESC_POS.LF);
    }
  }
  if (tenantPhone) {
    cmds.push(ESC_POS.ALIGN_CENTER);
    cmds.push(encodeText(`Telp: ${tenantPhone}`, opts.charset));
    cmds.push(ESC_POS.LF);
  }

  cmds.push(ESC_POS.ALIGN_CENTER);
  cmds.push(encodeText(buildHR(cols, '='), opts.charset));
  cmds.push(ESC_POS.LF);

  // Invoice info
  const dt = new Date(createdAt);
  const dateStr = dt.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  cmds.push(ESC_POS.ALIGN_LEFT);
  cmds.push(encodeText(`No: ${invoiceNo}`, opts.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(encodeText(`${dateStr} ${timeStr}`, opts.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(encodeText(`Kasir: ${cashierName}${shiftNo ? ` (Shift ${shiftNo})` : ''}`, opts.charset));
  cmds.push(ESC_POS.LF);

  if (tableNo) {
    cmds.push(encodeText(`Meja: ${tableNo}`, opts.charset));
    cmds.push(ESC_POS.LF);
  }
  if (queueNo) {
    cmds.push(encodeText(`Antrian: ${queueNo}`, opts.charset));
    cmds.push(ESC_POS.LF);
  }

  cmds.push(encodeText(buildHR(cols, '-'), opts.charset));
  cmds.push(ESC_POS.LF);

  return cmds;
}

/** Build kitchen ticket header (simpler, larger) */
function buildKitchenHeader(tx: TransactionData, cols: number, opts: TemplateOptions): Uint8Array[] {
  const cmds: Uint8Array[] = [];
  const { invoiceNo, createdAt, tableNo, queueNo } = tx;

  cmds.push(ESC_POS.ALIGN_CENTER);
  cmds.push(ESC_POS.SIZE_DOUBLE);
  cmds.push(ESC_POS.BOLD_ON);
  cmds.push(encodeText('TIKET DAPUR', opts.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(ESC_POS.SIZE_NORMAL);
  cmds.push(ESC_POS.BOLD_OFF);

  cmds.push(encodeText(buildHR(cols, '='), opts.charset));
  cmds.push(ESC_POS.LF);

  const dt = new Date(createdAt);
  const timeStr = dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  cmds.push(ESC_POS.ALIGN_LEFT);
  cmds.push(ESC_POS.SIZE_DOUBLE_H); // taller text for readability
  cmds.push(encodeText(`No: ${invoiceNo}`, opts.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(encodeText(`Waktu: ${timeStr}`, opts.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(ESC_POS.SIZE_NORMAL);

  if (tableNo) {
    cmds.push(ESC_POS.SIZE_DOUBLE_H);
    cmds.push(encodeText(`MEJA: ${tableNo}`, opts.charset));
    cmds.push(ESC_POS.LF);
    cmds.push(ESC_POS.SIZE_NORMAL);
  }
  if (queueNo) {
    cmds.push(ESC_POS.SIZE_DOUBLE_H);
    cmds.push(encodeText(`ANTRIAN: ${queueNo}`, opts.charset));
    cmds.push(ESC_POS.LF);
    cmds.push(ESC_POS.SIZE_NORMAL);
  }

  cmds.push(encodeText(buildHR(cols, '='), opts.charset));
  cmds.push(ESC_POS.LF);

  return cmds;
}

/** Build items section */
function buildItems(
  items: TransactionItem[],
  cols: number,
  opts: TemplateOptions,
  isKitchen: boolean
): Uint8Array[] {
  const cmds: Uint8Array[] = [];

  for (const item of items) {
    // Kitchen: only print items marked for kitchen
    if (isKitchen && !item.isKitchenItem && item.category !== 'food') continue;

    // Quantity x Name
    const qtyStr = `${item.qty}x`;
    const nameLines = wrapText(item.name, cols - qtyStr.length - 1);

    // First line: qty + name
    cmds.push(ESC_POS.ALIGN_LEFT);
    if (opts.fontSize === 'large') cmds.push(ESC_POS.SIZE_DOUBLE);
    cmds.push(encodeText(`${qtyStr} ${nameLines[0]}`, opts.charset));
    cmds.push(ESC_POS.LF);
    if (opts.fontSize === 'large') cmds.push(ESC_POS.SIZE_NORMAL);

    // Continuation lines for long names
    for (let i = 1; i < nameLines.length; i++) {
      cmds.push(encodeText(`    ${nameLines[i]}`, opts.charset)); // indent
      cmds.push(ESC_POS.LF);
    }

    // Kitchen note (highlighted)
    if (item.kitchenNote) {
      cmds.push(ESC_POS.BOLD_ON);
      cmds.push(ESC_POS.UNDERLINE_ON);
      for (const line of wrapText(`[CATATAN: ${item.kitchenNote}]`, cols)) {
        cmds.push(encodeText(`  ${line}`, opts.charset));
        cmds.push(ESC_POS.LF);
      }
      cmds.push(ESC_POS.UNDERLINE_OFF);
      cmds.push(ESC_POS.BOLD_OFF);
    }

    // Modifiers
    if (item.modifiers && item.modifiers.length) {
      for (const mod of item.modifiers) {
        for (const line of wrapText(`  + ${mod}`, cols)) {
          cmds.push(encodeText(line, opts.charset));
          cmds.push(ESC_POS.LF);
        }
      }
    }

    // Receipt: show price
    if (!isKitchen) {
      cmds.push(ESC_POS.ALIGN_RIGHT);
      cmds.push(encodeText(formatRupiah(item.subtotal), opts.charset));
      cmds.push(ESC_POS.LF);
      cmds.push(ESC_POS.ALIGN_LEFT);
    }

    // Separator between items
    cmds.push(encodeText(buildHR(cols, '.'), opts.charset));
    cmds.push(ESC_POS.LF);
  }

  return cmds;
}

/** Build payment summary (receipt only) */
function buildPaymentSummary(tx: TransactionData, cols: number, opts: TemplateOptions): Uint8Array[] {
  const cmds: Uint8Array[] = [];
  const { subtotal, discount, tax, total, paid, change, paymentMethodLabel } = tx;

  cmds.push(encodeText(buildHR(cols, '='), opts.charset));
  cmds.push(ESC_POS.LF);

  cmds.push(encodeText(buildTwoColumn('Subtotal', formatRupiah(subtotal), cols), opts.charset));
  cmds.push(ESC_POS.LF);
  if (discount > 0) {
    cmds.push(encodeText(buildTwoColumn('Diskon', `-${formatRupiah(discount)}`, cols), opts.charset));
    cmds.push(ESC_POS.LF);
  }
  if (tax > 0) {
    cmds.push(encodeText(buildTwoColumn('Pajak', formatRupiah(tax), cols), opts.charset));
    cmds.push(ESC_POS.LF);
  }

  cmds.push(encodeText(buildHR(cols, '-'), opts.charset));
  cmds.push(ESC_POS.LF);

  cmds.push(ESC_POS.BOLD_ON);
  cmds.push(ESC_POS.SIZE_DOUBLE_H);
  cmds.push(encodeText(buildTwoColumn('TOTAL', formatRupiah(total), cols), opts.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(ESC_POS.SIZE_NORMAL);
  cmds.push(ESC_POS.BOLD_OFF);

  cmds.push(encodeText(buildTwoColumn(`Bayar (${paymentMethodLabel})`, formatRupiah(paid), cols), opts.charset));
  cmds.push(ESC_POS.LF);
  if (change > 0) {
    cmds.push(encodeText(buildTwoColumn('Kembalian', formatRupiah(change), cols), opts.charset));
    cmds.push(ESC_POS.LF);
  }

  return cmds;
}

/** Build footer section */
function buildFooter(tx: TransactionData, cols: number, opts: TemplateOptions): Uint8Array[] {
  const cmds: Uint8Array[] = [];
  const { reviewUrl, note } = tx;

  cmds.push(encodeText(buildHR(cols, '='), opts.charset));
  cmds.push(ESC_POS.LF);

  cmds.push(ESC_POS.ALIGN_CENTER);
  cmds.push(encodeText('Terima kasih telah berkunjung!', opts.charset));
  cmds.push(ESC_POS.LF);

  if (reviewUrl && opts.includeQR) {
    cmds.push(encodeText('Berikan ulasan:', opts.charset));
    cmds.push(ESC_POS.LF);
    cmds.push(buildQRCode(reviewUrl, { size: opts.paperWidth === 58 ? 3 : 4 }));
    cmds.push(ESC_POS.LF);
  }

  if (note) {
    cmds.push(encodeText(buildHR(cols, '-'), opts.charset));
    cmds.push(ESC_POS.LF);
    for (const line of wrapText(note, cols)) {
      cmds.push(encodeText(line, opts.charset));
      cmds.push(ESC_POS.LF);
    }
  }

  cmds.push(ESC_POS.ALIGN_CENTER);
  cmds.push(encodeText(buildHR(cols, '='), opts.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(encodeText(`Dicetak: ${new Date().toLocaleString('id-ID')}`, opts.charset));
  cmds.push(ESC_POS.LF);

  return cmds;
}

/** Build kitchen footer */
function buildKitchenFooter(tx: TransactionData, cols: number, opts: TemplateOptions): Uint8Array[] {
  const cmds: Uint8Array[] = [];

  cmds.push(encodeText(buildHR(cols, '='), opts.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(ESC_POS.ALIGN_CENTER);
  cmds.push(ESC_POS.BOLD_ON);
  cmds.push(ESC_POS.SIZE_DOUBLE);
  cmds.push(encodeText('=== CETAK ULANG ===', opts.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(ESC_POS.SIZE_NORMAL);
  cmds.push(ESC_POS.BOLD_OFF);
  cmds.push(encodeText(`Dicetak: ${new Date().toLocaleTimeString('id-ID')}`, opts.charset));
  cmds.push(ESC_POS.LF);

  return cmds;
}

/** Main: Build Customer Receipt */
export function buildCustomerReceipt(
  tx: TransactionData,
  config: PrinterConfig,
  overrides: Partial<TemplateOptions> = {}
): Uint8Array {
  const opts = { ...DEFAULT_OPTIONS.receipt, ...overrides, paperWidth: config.paperWidth, charset: config.charset };
  const cols = getCols(opts.paperWidth, opts.fontType);
  const cmds: Uint8Array[] = [];

  cmds.push(ESC_POS.INIT);
  cmds.push(ESC_POS.CODEPAGE_CP858); // default, will be overridden by charset-specific below
  if (opts.charset === 'gb18030') cmds.push(ESC_POS.CODEPAGE_GB18030);
  else if (opts.charset === 'cp858') cmds.push(ESC_POS.CODEPAGE_CP858);
  else cmds.push(ESC_POS.CODEPAGE_CP437);

  cmds.push(ESC_POS.FONT_A); // force font A

  if (opts.includeHeader) {
    cmds.push(...buildHeader(tx, cols, opts));
  }
  cmds.push(...buildItems(tx.items, cols, opts, false));
  cmds.push(...buildPaymentSummary(tx, cols, opts));
  if (opts.includeFooter) {
    cmds.push(...buildFooter(tx, cols, opts));
  }

  // Cut
  if (config.cutAfterPrint) {
    cmds.push(ESC_POS.CUT_PARTIAL);
  }

  return concatUint8Arrays(cmds);
}

/** Main: Build Kitchen Ticket */
export function buildKitchenTicket(
  tx: TransactionData,
  config: PrinterConfig,
  overrides: Partial<TemplateOptions> = {}
): Uint8Array {
  const opts = { ...DEFAULT_OPTIONS.kitchen, ...overrides, paperWidth: config.paperWidth, charset: config.charset };
  const cols = getCols(opts.paperWidth, opts.fontType);
  const cmds: Uint8Array[] = [];

  cmds.push(ESC_POS.INIT);
  if (opts.charset === 'gb18030') cmds.push(ESC_POS.CODEPAGE_GB18030);
  else if (opts.charset === 'cp858') cmds.push(ESC_POS.CODEPAGE_CP858);
  else cmds.push(ESC_POS.CODEPAGE_CP437);

  cmds.push(ESC_POS.FONT_A);

  cmds.push(...buildKitchenHeader(tx, cols, opts));
  cmds.push(...buildItems(tx.items, cols, opts, true));
  if (opts.includeFooter) {
    cmds.push(...buildKitchenFooter(tx, cols, opts));
  }

  // Cut
  if (config.cutAfterPrint) {
    cmds.push(ESC_POS.CUT_PARTIAL);
  }

  return concatUint8Arrays(cmds);
}

/** Build Test Print */
export function buildTestPrint(config: PrinterConfig): Uint8Array {
  const cols = getCols(config.paperWidth, 'A');
  const cmds: Uint8Array[] = [];

  cmds.push(ESC_POS.INIT);
  if (config.charset === 'gb18030') cmds.push(ESC_POS.CODEPAGE_GB18030);
  else if (config.charset === 'cp858') cmds.push(ESC_POS.CODEPAGE_CP858);
  else cmds.push(ESC_POS.CODEPAGE_CP437);

  cmds.push(ESC_POS.ALIGN_CENTER);
  cmds.push(ESC_POS.SIZE_DOUBLE);
  cmds.push(encodeText('caPOS Test Print', config.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(ESC_POS.SIZE_NORMAL);
  cmds.push(encodeText(buildHR(cols, '='), config.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(ESC_POS.ALIGN_LEFT);
  cmds.push(encodeText(`Printer: ${config.name}`, config.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(encodeText(`Koneksi: ${config.connection}`, config.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(encodeText(`Kertas: ${config.paperWidth}mm`, config.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(encodeText(`Charset: ${config.charset}`, config.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(encodeText(`Waktu: ${new Date().toLocaleString('id-ID')}`, config.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(encodeText(buildHR(cols, '='), config.charset));
  cmds.push(ESC_POS.LF);
  cmds.push(ESC_POS.ALIGN_CENTER);
  cmds.push(encodeText('Jika terbaca, printer siap dipakai.', config.charset));
  cmds.push(ESC_POS.LF);

  if (config.cutAfterPrint) {
    cmds.push(ESC_POS.CUT_PARTIAL);
  }

  return concatUint8Arrays(cmds);
}

export type { TransactionData, TransactionItem, TemplateOptions };