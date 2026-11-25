/**
 * POS Print Integration — Connect checkout_transaction to printing
 * Server-side: RPC returns transaction data
 * Client-side: usePrinter hook prints kitchen + receipt
 */

import { createClient } from '@/lib/supabase/client';
import { TransactionData, TransactionItem } from '@/lib/print-templates';

/** Fetch full transaction data for printing */
export async function fetchTransactionForPrint(
  transactionId: string
): Promise<TransactionData | null> {
  const supabase = createClient();

  // 1. Get transaction header
  const { data: tx, error: txError } = await supabase
    .from('transactions')
    .select(`
      id,
      invoice_no,
      created_at,
      subtotal,
      discount_amount,
      tax_amount,
      total_amount,
      paid_amount,
      change_amount,
      payment_method,
      note,
      table_id,
      queue_number,
      shift_id,
      cashier_id,
      tenant_id
    `)
    .eq('id', transactionId)
    .single();

  if (txError || !tx) return null;

  // 2. Get tenant info
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, address, phone')
    .eq('id', tx.tenant_id)
    .single();

  // 3. Get cashier name
  const { data: cashier } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', tx.cashier_id)
    .single();

  // 4. Get shift number
  const { data: shift } = await supabase
    .from('cashier_shifts')
    .select('shift_number')
    .eq('id', tx.shift_id)
    .single();

  // 5. Get table name
  let tableNo: string | undefined;
  if (tx.table_id) {
    const { data: table } = await supabase
      .from('qr_tables')
      .select('table_number, name')
      .eq('id', tx.table_id)
      .single();
    tableNo = table?.table_number?.toString() || table?.name;
  }

  // 6. Get items with kitchen notes
  const { data: items } = await supabase
    .from('transaction_items')
    .select(`
      id,
      product_id,
      qty,
      unit_price,
      subtotal,
      kitchen_note,
      product:products!inner(name, category)
    `)
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: true });

  // 7. Get modifiers for each item
  const itemsWithModifiers: TransactionItem[] = [];
  if (items) {
    for (const item of items) {
      const { data: mods } = await supabase
        .from('transaction_item_modifiers')
        .select('modifier:modifiers(name)')
        .eq('transaction_item_id', item.id);

      const modifierNames = mods?.map(m => m.modifier?.name).filter(Boolean) || [];

      itemsWithModifiers.push({
        id: item.id,
        name: item.product?.name || 'Produk tidak diketahui',
        qty: item.qty,
        price: item.unit_price,
        subtotal: item.subtotal,
        category: item.product?.category,
        kitchenNote: item.kitchen_note,
        modifiers: modifierNames,
        isKitchenItem: item.product?.category === 'food' || !!item.kitchen_note,
      });
    }
  }

  // 8. Build payment method label
  const paymentLabels: Record<string, string> = {
    cash: 'Tunai',
    qris: 'QRIS',
    card: 'Kartu',
    transfer: 'Transfer',
    other: 'Lainnya',
  };

  return {
    invoiceNo: tx.invoice_no,
    transactionId: tx.id,
    createdAt: tx.created_at,
    tenantName: tenant?.name || 'caPOS',
    tenantAddress: tenant?.address,
    tenantPhone: tenant?.phone,
    cashierName: cashier?.full_name || 'Kasir',
    shiftNo: shift?.shift_number?.toString(),
    tableNo,
    queueNo: tx.queue_number?.toString(),
    paymentMethod: tx.payment_method as any,
    paymentMethodLabel: paymentLabels[tx.payment_method] || tx.payment_method,
    subtotal: tx.subtotal,
    discount: tx.discount_amount,
    tax: tx.tax_amount,
    total: tx.total_amount,
    paid: tx.paid_amount,
    change: tx.change_amount,
    items: itemsWithModifiers,
    note: tx.note,
    // reviewUrl: `${process.env.NEXT_PUBLIC_APP_URL}/review/${tx.id}`, // optional
  };
}

/** Print both kitchen ticket and receipt after successful checkout */
export async function printAfterCheckout(
  transactionId: string,
  printFn: (tx: TransactionData) => Promise<{ kitchen: boolean; receipt: boolean }>
): Promise<{ success: boolean; error?: string }> {
  try {
    const txData = await fetchTransactionForPrint(transactionId);
    if (!txData) {
      return { success: false, error: 'Transaksi tidak ditemukan' };
    }

    const result = await printFn(txData);
    return {
      success: result.kitchen && result.receipt,
      error: !result.kitchen ? 'Gagal cetak tiket dapur' : !result.receipt ? 'Gagal cetak struk' : undefined,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Cetak gagal' };
  }
}

/** Get default printer configs for tenant (for POS to use) */
export async function getDefaultPrinterConfigs(tenantId: string) {
  const supabase = createClient();

  const { data: receiptPrinter } = await supabase
    .rpc('get_default_receipt_printer', { p_tenant_id: tenantId });

  const { data: kitchenPrinter } = await supabase
    .rpc('get_default_kitchen_printer', { p_tenant_id: tenantId });

  return { receiptPrinter, kitchenPrinter };
}

export type { TransactionData, TransactionItem };