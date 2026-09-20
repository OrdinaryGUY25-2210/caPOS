import Dexie, { type Table } from "dexie";

export interface CachedProduct {
  id: string;
  tenant_id: string;
  name: string;
  price: number;
  category: string;
  image_url: string | null;
  is_available: boolean;
  created_at: string;
  /** Ditambahkan lewat migration_011 (opsional — hanya diisi kalau produk track_stock=true). */
  track_stock?: boolean;
  /** Stok cabang tempat kasir ini bertugas, sudah digabung dari branch_stock saat fetch (lihat app/pos/page.tsx). */
  stock_qty?: number;
  low_stock_threshold?: number;
}

export interface CachedMembership {
  id: string;
  tenant_id: string;
  member_code: string;
  customer_name: string;
  discount_percentage: number;
  is_active: boolean;
}

export interface PendingTransaction {
  local_id?: number;
  tenant_id: string;
  cashier_id: string;
  /** Cabang tempat transaksi ini terjadi (migration_011) — diteruskan ke checkout_transaction() sebagai p_branch_id saat sinkron. */
  branch_id?: string | null;
  invoice_number: string;
  total_amount: number;
  payment_method: string;
  member_id: string | null;
  items: { product_id: string; qty: number; subtotal: number }[];
  is_offline_sync: boolean;
  // IndexedDB (and therefore Dexie's IndexableType) cannot index a plain
  // boolean — only string/number/Date/binary/array are indexable. Using
  // `synced: 0 | 1` instead of `synced: boolean` lets Dexie actually use
  // the index below; querying an unindexed boolean field silently falls
  // back to a full table scan (db.table.filter(...)), which gets slow once
  // a cafe has accumulated thousands of receipts offline.
  synced: 0 | 1;
  created_at: string;
}

export interface CachedProfile {
  /** Auth user id (Supabase) — key. */
  id: string;
  /** Snapshot mentah dari baris `profiles` terakhir kali berhasil diambil
   *  waktu online. Dipakai getCurrentProfile() sebagai fallback ketika
   *  `auth.getUser()` gagal karena offline — lihat lib/getCurrentProfile.ts. */
  profile: unknown;
  cachedAt: string;
}

export interface PendingProductOp {
  local_id?: number;
  tenant_id: string;
  op: "insert" | "update" | "toggle_availability";
  /**
   * ID produk asli (kalau update/toggle produk yang sudah ada), ATAU id
   * sementara berformat `local-<uuid>` untuk produk yang DIBUAT waktu
   * offline (belum tahu id asli dari Postgres sampai berhasil di-insert
   * saat sinkron). /dashboard/menu & /pos memakai id sementara ini untuk
   * menampilkan produk itu secara optimistic sebelum benar-benar tersimpan.
   */
  product_id: string;
  payload: {
    name?: string;
    price?: number;
    category?: string;
    image_url?: string | null;
    is_available?: boolean;
  };
  /**
   * Foto menu yang dipilih waktu offline (compressImage() sudah jalan di
   * browser, jadi ini blob WebP/JPEG yang sudah dikompres, BUKAN file HP
   * mentah) — disimpan di sini karena belum bisa diupload ke Supabase
   * Storage tanpa jaringan. Diupload saat sinkron, hasil URL-nya baru
   * ditulis ke `products.image_url`.
   */
  image_blob?: Blob;
  synced: 0 | 1;
  created_at: string;
}

// caPOS offline-first database: caches menu/members for the /pos screen
// and queues transactions made while the connection is down, so the
// "Online"/"Offline" badge in the cashier navbar can flip freely without
// blocking a sale.
class CaPOSDB extends Dexie {
  products!: Table<CachedProduct, string>;
  memberships!: Table<CachedMembership, string>;
  pendingTransactions!: Table<PendingTransaction, number>;
  authCache!: Table<CachedProfile, string>;
  pendingProductOps!: Table<PendingProductOp, number>;

  constructor() {
    super("caPOS_offline_db");
    this.version(1).stores({
      products: "id, tenant_id, category, is_available",
      memberships: "id, tenant_id, member_code, is_active",
      pendingTransactions: "++local_id, tenant_id, synced, created_at",
    });
    // v2 — tambah tabel authCache (BUG FIX: /pos gagal total saat offline
    // karena getCurrentProfile() memakai auth.getUser() yang wajib jaringan;
    // lihat lib/getCurrentProfile.ts). Dexie akan otomatis migrasi database
    // yang sudah ada di browser pengguna lama ke versi ini tanpa menghapus
    // data products/memberships/pendingTransactions yang sudah tersimpan.
    this.version(2).stores({
      products: "id, tenant_id, category, is_available",
      memberships: "id, tenant_id, member_code, is_active",
      pendingTransactions: "++local_id, tenant_id, synced, created_at",
      authCache: "id",
    });
    // v3 — tambah tabel pendingProductOps: antrian perubahan menu
    // (tambah/edit/toggle ketersediaan) yang dibuat lewat /dashboard/menu
    // waktu offline, dipakai lib/offlineSync.ts untuk sinkron begitu
    // online lagi. Lihat app/dashboard/menu/page.tsx.
    this.version(3).stores({
      products: "id, tenant_id, category, is_available",
      memberships: "id, tenant_id, member_code, is_active",
      pendingTransactions: "++local_id, tenant_id, synced, created_at",
      authCache: "id",
      pendingProductOps: "++local_id, tenant_id, synced, created_at",
    });
  }
}

export const db = new CaPOSDB();

/**
 * Push all queued offline transactions to Supabase once back online.
 *
 * `insertFn` should call the `checkout_transaction` RPC (server recomputes
 * the total from current product prices) rather than inserting the queued
 * `total_amount` directly — otherwise a transaction created while offline
 * could later be replayed with a client-controlled total.
 */
export async function syncPendingTransactions(
  insertFn: (tx: PendingTransaction) => Promise<boolean>
) {
  // Indexed lookup (uses the `synced` index) instead of scanning + filtering
  // every row in the table.
  const pending = await db.pendingTransactions.where("synced").equals(0).toArray();
  for (const tx of pending) {
    const ok = await insertFn(tx);
    if (ok && tx.local_id) {
      await db.pendingTransactions.update(tx.local_id, { synced: 1 });
    }
  }
}

/**
 * Push all queued offline menu changes (tambah/edit/toggle ketersediaan
 * produk dari /dashboard/menu) to Supabase once back online.
 *
 * `handlers.upload` uploads a queued image blob and returns its public URL
 * (or null on failure — sync for that op is skipped and retried next time).
 * `handlers.insert`/`update` should return the REAL row id from Postgres on
 * success (for insert) so callers can reconcile the temporary `local-...`
 * id used while offline, or `null`/`false`-ish on failure so the op stays
 * queued for the next sync attempt instead of being silently dropped.
 */
export async function syncPendingProductOps(handlers: {
  upload: (blob: Blob, tenantId: string) => Promise<string | null>;
  insert: (payload: PendingProductOp["payload"] & { tenant_id: string }) => Promise<string | null>;
  update: (productId: string, payload: PendingProductOp["payload"]) => Promise<boolean>;
}): Promise<{ idMap: Map<string, string> }> {
  const pending = await db.pendingProductOps.where("synced").equals(0).sortBy("created_at");
  // Map dari id sementara ("local-...") -> id asli Postgres, dikembalikan
  // ke pemanggil supaya UI (menu state + cache) bisa menimpa referensi
  // lama begitu produk yang dibuat offline benar-benar tersimpan.
  const idMap = new Map<string, string>();

  for (const op of pending) {
    // Kalau produk ini sebelumnya dibuat offline juga (id masih "local-..."
    // di op INI) tapi op INSERT-nya sendiri belum sempat sync (mis. upload
    // foto gagal di percobaan sebelumnya), realId belum ada — proses op
    // insert-nya sendiri dulu di bawah, idMap akan terisi setelah itu.
    let realProductId = op.product_id.startsWith("local-")
      ? idMap.get(op.product_id) ?? op.product_id
      : op.product_id;

    let payload = { ...op.payload };
    if (op.image_blob) {
      const url = await handlers.upload(op.image_blob, op.tenant_id);
      if (!url) continue; // upload masih gagal (mis. masih offline) — coba lagi lain kali, JANGAN tandai synced.
      payload.image_url = url;
    }

    if (op.op === "insert") {
      const newId = await handlers.insert({ ...payload, tenant_id: op.tenant_id });
      if (!newId) continue; // insert gagal — tetap di antrian, dicoba lagi nanti.
      idMap.set(op.product_id, newId);
      realProductId = newId;
    } else {
      // update / toggle_availability sama-sama UPDATE baris yang sudah ada.
      // Kalau realProductId masih "local-..." (op insert pasangannya belum
      // pernah berhasil sync sampai sekarang), lewati dulu — akan otomatis
      // ter-apply lewat `payload` gabungan begitu op insert-nya sendiri
      // berhasil di percobaan sync berikutnya (lihat catatan desain di
      // app/dashboard/menu/page.tsx: op update untuk produk yang masih
      // "local-..." digabung ke payload insert-nya, bukan dikirim terpisah).
      if (realProductId.startsWith("local-")) continue;
      const ok = await handlers.update(realProductId, payload);
      if (!ok) continue;
    }

    if (op.local_id) await db.pendingProductOps.update(op.local_id, { synced: 1 });
  }

  return { idMap };
}
