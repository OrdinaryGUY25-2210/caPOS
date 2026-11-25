/**
 * Example: Integrating Printing into POS Checkout Flow
 * Copy relevant parts into your actual POS component
 */

'use client';

import { useState } from 'react';
import { usePrinter } from '@/hooks/usePrinter';
import { fetchTransactionForPrint, printAfterCheckout } from '@/lib/pos-print';
import { TransactionData } from '@/lib/print-templates';
import { createClient } from '@/lib/supabase/client';

interface POSPrintExampleProps {
  tenantId: string;
}

export default function POSPrintExample({ tenantId }: POSPrintExampleProps) {
  const {
    state,
    connect,
    printBoth,
    printReceipt,
    printKitchen,
  } = usePrinter();

  const [printing, setPrinting] = useState(false);
  const [lastResult, setLastResult] = useState<{ kitchen: boolean; receipt: boolean } | null>(null);

  /** Simulate checkout completion */
  const handleCheckout = async (transactionId: string) => {
    setPrinting(true);
    try {
      // 1. Fetch transaction data for printing
      const txData = await fetchTransactionForPrint(transactionId);
      if (!txData) {
        alert('Gagal memuat data transaksi untuk cetak');
        return;
      }

      // 2. Ensure printer connected (use default receipt printer config)
      // In real app, load printer config from tenant settings on POS mount
      const printerConnected = state.status === 'connected';
      if (!printerConnected) {
        // You'd load the saved printer config here
        // For now, assume it's already connected via Settings
        alert('Printer belum terhubung. Buka Pengaturan > Printer terlebih dahulu.');
        return;
      }

      // 3. Print both: kitchen first, then receipt
      const result = await printBoth(txData);
      setLastResult(result);

      if (result.kitchen && result.receipt) {
        console.log('✅ Cetak berhasil: tiket dapur + struk pelanggan');
      } else {
        console.warn('⚠️ Cetak parsial:', result);
      }
    } catch (err) {
      console.error('Print error:', err);
      alert(`Cetak gagal: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setPrinting(false);
    }
  };

  /** Manual reprint buttons */
  const handleReprintKitchen = async (transactionId: string) => {
    const txData = await fetchTransactionForPrint(transactionId);
    if (txData) await printKitchen(txData);
  };

  const handleReprintReceipt = async (transactionId: string) => {
    const txData = await fetchTransactionForPrint(transactionId);
    if (txData) await printReceipt(txData);
  };

  return (
    <div className="space-y-4">
      {/* Printer Status */}
      <div className="card p-4">
        <h3 className="font-medium mb-3">Status Printer</h3>
        <div className="flex items-center gap-4 text-sm">
          <span className={`flex items-center gap-1 ${
            state.status === 'connected' ? 'text-green-600' :
            state.status === 'connecting' ? 'text-yellow-600' :
            state.status === 'error' ? 'text-red-600' : 'text-muted-foreground'
          }`}>
            {state.status === 'connected' && '🟢'}
            {state.status === 'connecting' && '🟡'}
            {state.status === 'error' && '🔴'}
            {state.status === 'disconnected' && '⚪'}
            {state.status}
          </span>
          {state.config && (
            <span className="text-muted-foreground">
              {state.config.name} ({state.config.paperWidth}mm)
            </span>
          )}
          {state.error && (
            <span className="text-red-600">Error: {state.error}</span>
          )}
        </div>
        {state.isPrinting && <div className="mt-2 text-sm text-blue-600">🖨️ Sedang mencetak...</div>}
      </div>

      {/* Test Checkout Print */}
      <div className="card p-4">
        <h3 className="font-medium mb-3">Test Cetak Setelah Checkout</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Masukkan Transaction ID untuk simulasi cetak tiket dapur + struk pelanggan
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Transaction ID (UUID)"
            className="input flex-1"
            id="tx-id-input"
          />
          <button
            onClick={() => {
              const input = document.getElementById('tx-id-input') as HTMLInputElement;
              if (input.value) handleCheckout(input.value);
            }}
            disabled={printing || state.isPrinting}
            className="btn btn-primary"
          >
            {printing ? 'Mencetak...' : 'Cetak Tiket Dapur + Struk'}
          </button>
        </div>
        {lastResult && (
          <div className="mt-3 p-3 text-sm bg-muted rounded">
            Hasil:{' '}
            <span className={lastResult.kitchen ? 'text-green-600' : 'text-red-600'}>
              {lastResult.kitchen ? '✅ Dapur' : '❌ Dapur'}
            </span>{' '}
            <span className={lastResult.receipt ? 'text-green-600' : 'text-red-600'}>
              {lastResult.receipt ? '✅ Struk' : '❌ Struk'}
            </span>
          </div>
        )}
      </div>

      {/* Manual Reprint */}
      <div className="card p-4">
        <h3 className="font-medium mb-3">Cetak Ulang Manual</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Transaction ID"
            className="input flex-1"
            id="reprint-tx-id"
          />
          <button
            onClick={() => {
              const input = document.getElementById('reprint-tx-id') as HTMLInputElement;
              if (input.value) handleReprintKitchen(input.value);
            }}
            className="btn btn-outline"
          >
            🖨️ Cetak Ulang Dapur
          </button>
          <button
            onClick={() => {
              const input = document.getElementById('reprint-tx-id') as HTMLInputElement;
              if (input.value) handleReprintReceipt(input.value);
            }}
            className="btn btn-outline"
          >
            🧾 Cetak Ulang Struk
          </button>
        </div>
      </div>

      {/* Integration Guide */}
      <details className="card p-4">
        <summary className="font-medium cursor-pointer">Cara Integrasi ke POS Asli</summary>
        <div className="mt-3 text-sm space-y-2">
          <pre className="bg-muted p-3 rounded overflow-x-auto text-xs"><code>{`// 1. Di POS component, load printer config on mount:
useEffect(() => {
  const loadPrinter = async () => {
    const { data } = await supabase
      .rpc('get_default_receipt_printer', { p_tenant_id: tenantId });
    if (data) await connect(data); // auto-connect
  };
  loadPrinter();
}, [tenantId]);

// 2. Setelah checkout_transaction RPC sukses:
const handleCheckout = async (cartItems) => {
  const { data: transaction } = await supabase.rpc('checkout_transaction', {
    p_items: cartItems.map(i => ({ product_id: i.id, qty: i.qty }))
  });
  
  if (transaction?.id) {
    // Print kitchen + receipt
    await printAfterCheckout(transaction.id, printBoth);
  }
};

// 3. Atau pakai fetchTransactionForPrint langsung:
const txData = await fetchTransactionForPrint(transactionId);
await printBoth(txData);`}</code></pre>
        </div>
      </details>
    </div>
  );
}