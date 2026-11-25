'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrinter } from '@/hooks/usePrinter';
import { fetchTransactionForPrint, printAfterCheckout, getDefaultPrinterConfigs } from '@/lib/pos-print';
import { createClient } from '@/lib/supabase/client';

interface CartItem {
  product_id: string;
  qty: number;
}

export default function CheckoutPage() {
  const router = useRouter();
  const {
    state,
    connect,
    disconnect,
    printBoth,
    printReceipt,
    printKitchen,
    capabilities,
  } = usePrinter();

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [lastResult, setLastResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, role')
        .single();

      if (profile?.tenant_id) {
        setTenantId(profile.tenant_id);
      }
    })();
  }, []);

  useEffect(() => {
    if (tenantId) {
      getDefaultPrinterConfigs(tenantId);
    }
  }, [tenantId]);

  const handleCheckout = async (cartItems: CartItem[]) => {
    setPrinting(true);
    try {
      const supabase = createClient();
      const { data: transaction, error: txError } = await supabase
        .rpc('checkout_transaction', {
          p_items: cartItems.map(i => ({ product_id: i.product_id, qty: i.qty })),
        });

      if (txError || !transaction?.id) {
        alert('Checkout gagal: ' + (txError?.message || 'Transaksi tidak valid'));
        return;
      }

      const result = await printAfterCheckout(transaction.id, printBoth);
      setLastResult(result);

      if (result.success) {
        console.log('✅ Checkout berhasil: tiket dapur + struk pelanggan tercetak');
        setMessage({ type: 'success', text: 'Checkout berhasil! Struk & tiket dapur sudah dicetak.' });
        router.push(`/checkout-success/${transaction.id}`);
      } else {
        const errorMsg = result.error || 'Cetak gagal';
        console.warn('⚠️ Checkout sukses tapi cetak gagal:', errorMsg);
        setMessage({ type: 'warning', text: `Checkout berhasil, tetapi ${errorMsg}. Silakan cetak ulang jika perlu.` });
        router.push(`/checkout-success/${transaction.id}`);
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert(`Checkout gagal: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setPrinting(false);
    }
  };

  const handleReprintKitchen = async (transactionId: string) => {
    const txData = await fetchTransactionForPrint(transactionId);
    if (txData) {
      const ok = await printKitchen(txData);
      if (ok) setMessage({ type: 'success', text: 'Tiket dapur berhasil dicetak ulang' });
      else setMessage({ type: 'error', text: 'Gagal cetak tiket dapur' });
    }
  };

  const handleReprintReceipt = async (transactionId: string) => {
    const txData = await fetchTransactionForPrint(transactionId);
    if (txData) {
      const ok = await printReceipt(txData);
      if (ok) setMessage({ type: 'success', text: 'Struk berhasil dicetak ulang' });
      else setMessage({ type: 'error', text: 'Gagal cetak struk' });
    }
  };

  const mockItems: CartItem[] = [
    { product_id: 'prod-1', qty: 2 },
    { product_id: 'prod-2', qty: 1 },
    { product_id: 'prod-3', qty: 1 },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      <h1 className="text-2xl font-bold text-neutral-900 mb-6">Checkout</h1>

      <div className="card p-4 mb-6">
        <h3 className="font-medium mb-3">Status Printer</h3>
        <div className="flex items-center gap-4 text-sm">
          <span className={
            state.status === 'connected' && 'text-green-600'
            || state.status === 'connecting' && 'text-yellow-600'
            || state.status === 'error' && 'text-red-600'
            || 'text-muted-foreground'
          }>
            {state.status === 'connected' && '🟢'}
            {state.status === 'connecting' && '🟡'}
            {state.status === 'error' && '🔴'}
            {state.status === 'disconnected' && '⚪'}
          </span>
          {state.config && (
            <span className="text-muted-foreground">
              {state.config.name} ({state.config.paperWidth}mm · {state.config.charset})
            </span>
          )}
          {state.error && (
            <span className="text-red-600">Error: {state.error}</span>
          )}
        </div>
        {state.isPrinting && <div className="mt-2 text-sm text-blue-600">🖨️ Sedang mencetak...</div>}
      </div>

      {capabilities.bluetooth && (
        <div className="card p-4 mb-6">
          <h3 className="font-medium mb-3">Test Print</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Pastikan printer sudah terhubung di Pengaturan > Printer terlebih dahulu.
          </p>
          <button
            onClick={() => {
              connect ? connect({} as any) : false;
              if (connect()) printTest();
            }}
            disabled={state.status === 'connected' || state.isPrinting}
            className="btn btn-primary"
          >
            {state.status === 'connected' && 'Terhubung' }
            {state.status !== 'connected' && 'Hubungkan dulu'}
          </button>
        </div>
      )}

      <details className="card p-4">
        <summary className="font-medium cursor-pointer">Cara Integrasi ke POS</summary>
        <div className="mt-3 text-sm space-y-2">
          <pre className="bg-muted p-3 rounded overflow-x-auto text-xs"><code>{`// 1. Di checkout handler, setelah checkout_transaction sukses:
// const { data: transaction } = await supabase.rpc('checkout_transaction', {
//   p_items: cartItems.map(i => ({ product_id: i.id, qty: i.qty }))
// });

// if (transaction?.id) {
//   await printAfterCheckout(transaction.id, printBoth);
// }

// 2. Atau pakai fetchTransactionForPrint langsung:
// const txData = await fetchTransactionForPrint(transactionId);
// await printBoth(txData);`}</code></pre>
        </div>
      </details>

      <div className="card p-6 max-w-2xl mx-auto">
        <h2 className="font-medium mb-4">Keranjang Belanja</h2>

        {printing && (
          <div className="alert alert-success mb-4">
            <p>Sedang memproses checkout...</p>
            <p className="text-sm mt-2">Mencetak tiket dapur + struk setelah berhasil...</p>
          </div>
        )}

        <div className="space-y-4">
          {mockItems.map((item, idx) => (
            <div key={idx} className="p-3 bg-muted rounded">
              <span className="font-medium">Produk {item.product_id}</span> × {item.qty}
            </div>
          ))}

          <p className="text-muted-foreground text-sm">Item di atas adalah demo. Integrasikan dengan stok produk aktual.</p>
        </div>

        <button
          onClick={() => handleCheckout(mockItems)}
          disabled={printing}
          className="btn btn-primary w-full"
        >
          {printing ? 'Mencetak dan Checkout...' : 'Checkout & Cetak'}
        </button>
      </div>

      {message && (
        <div className={
          message.type === 'success' ? 'alert alert-success mb-4'
          : message.type === 'error' ? 'alert alert-error mb-4'
          : 'alert alert-warning mb-4'
        }>
          {message.text}
        </div>
      )}

      {lastResult && lastResult.success && (
        <div className="card p-4 mt-6">
          <h3 className="font-medium mb-3">Cetak Ulang</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <button
              onClick={() => handleReprintKitchen(lastResult.error ? '' : '')}
              className="btn btn-outline">
              Cetak Tiket Dapur Ulang
            </button>
            <button
              onClick={() => handleReprintReceipt(lastResult.error ? '')}
              className="btn btn-outline">
              Cetak Struk Ulang
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            (Jika transaksi sebelumnya berhasil dicetak)
          </p>
        </div>
      )}
    </div>
  );
}
