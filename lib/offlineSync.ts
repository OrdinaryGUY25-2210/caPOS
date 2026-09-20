"use client";

import { createClient } from "@/lib/supabase/client";
import { db, syncPendingTransactions, syncPendingProductOps } from "@/lib/dexie";

/**
 * Nama custom event yang di-dispatch ke `window` setiap kali
 * runBackgroundSync() selesai jalan (berhasil ataupun tidak ada yang perlu
 * disinkron). Halaman seperti /dashboard/menu bisa dengar event ini untuk
 * me-refresh tampilannya begitu perubahan offline-nya sudah benar-benar
 * tersimpan di server (id sementara "local-..." sudah jadi id asli, dst).
 */
export const SYNC_COMPLETE_EVENT = "capos:sync-complete";

let syncInFlight = false;

/**
 * BUG FIX — sebelumnya syncPendingTransactions() (di lib/dexie.ts) sudah
 * ada tapi TIDAK PERNAH dipanggil di mana pun: transaksi yang dibuat kasir
 * waktu offline akan selamanya nyangkut di IndexedDB device itu, tidak
 * pernah benar-benar terkirim ke server walau sudah online kembali. Fungsi
 * ini menjalankan sinkronisasi tersebut (transaksi POS + perubahan menu
 * dari /dashboard/menu yang dibuat offline), dan dipasang lewat
 * useBackgroundSync() di bawah supaya jalan otomatis setiap device
 * transisi dari offline -> online, di mana pun pengguna sedang berada
 * (POS atau dashboard).
 */
export async function runBackgroundSync() {
  if (syncInFlight || !navigator.onLine) return;
  syncInFlight = true;
  try {
    const supabase = createClient();

    // 1. Transaksi kasir yang tertunda.
    await syncPendingTransactions(async (tx) => {
      const { error } = await supabase.rpc("checkout_transaction", {
        p_tenant_id: tx.tenant_id,
        p_cashier_id: tx.cashier_id,
        p_invoice_number: tx.invoice_number,
        p_payment_method: tx.payment_method,
        // Voucher/poin loyalitas sengaja TIDAK diikutkan untuk transaksi
        // yang tadinya dibuat offline (lihat catatan di app/pos/page.tsx —
        // butuh validasi server real-time yang tidak tersedia saat offline).
        p_member_code: null,
        p_items: tx.items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
        p_branch_id: tx.branch_id ?? null,
        p_customer_id: null,
        p_voucher_code: null,
      });
      if (error) {
        console.error("Sync transaksi offline gagal (akan dicoba lagi nanti):", tx.invoice_number, error.message);
        return false;
      }
      return true;
    }).catch((e) => console.error("syncPendingTransactions error:", e));

    // 2. Perubahan menu (tambah/edit/toggle) yang tertunda dari /dashboard/menu.
    const { idMap } = await syncPendingProductOps({
      upload: async (blob, tenantId) => {
        const ext = blob.type === "image/webp" ? "webp" : "jpg";
        const path = `${tenantId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage
          .from("menu-images")
          .upload(path, blob, { upsert: true, contentType: blob.type });
        if (error) {
          console.error("Sync upload foto menu gagal (akan dicoba lagi nanti):", error.message);
          return null;
        }
        const { data } = supabase.storage.from("menu-images").getPublicUrl(path);
        return data.publicUrl;
      },
      insert: async (payload) => {
        const { data, error } = await supabase
          .from("products")
          .insert({
            tenant_id: payload.tenant_id,
            name: payload.name,
            price: payload.price,
            category: payload.category,
            image_url: payload.image_url ?? null,
            is_available: payload.is_available ?? true,
          })
          .select("id")
          .single();
        if (error) {
          console.error("Sync tambah menu offline gagal (akan dicoba lagi nanti):", error.message);
          return null;
        }
        return data.id as string;
      },
      update: async (productId, payload) => {
        const { error } = await supabase.from("products").update(payload).eq("id", productId);
        if (error) {
          console.error("Sync edit menu offline gagal (akan dicoba lagi nanti):", productId, error.message);
          return false;
        }
        return true;
      },
    }).catch((e) => {
      console.error("syncPendingProductOps error:", e);
      return { idMap: new Map<string, string>() };
    });

    // Reconcile id sementara ("local-...") jadi id asli di cache produk
    // (dipakai /pos juga) supaya tidak ada baris "hantu" dengan id palsu
    // tersisa begitu sudah benar-benar tersimpan di server.
    if (idMap.size > 0) {
      for (const [tempId, realId] of idMap) {
        const row = await db.products.get(tempId);
        if (row) {
          await db.products.delete(tempId);
          await db.products.put({ ...row, id: realId });
        }
      }
    }

    window.dispatchEvent(new CustomEvent(SYNC_COMPLETE_EVENT));
  } finally {
    syncInFlight = false;
  }
}

/**
 * Panggil sekali di komponen client tingkat atas yang membungkus /pos DAN
 * /dashboard (lihat components/SubscriptionCutoffGate.tsx) — memasang
 * listener `online` sekali untuk seluruh aplikasi, plus satu percobaan
 * sinkron langsung saat mount kalau kebetulan device memang sudah online
 * (menangkap kasus "sempat offline sebelum reload, sekarang sudah online
 * lagi tapi event 'online' tidak sempat ter-trigger ulang").
 */
export function startBackgroundSyncListener() {
  runBackgroundSync();
  window.addEventListener("online", runBackgroundSync);
  return () => window.removeEventListener("online", runBackgroundSync);
}
