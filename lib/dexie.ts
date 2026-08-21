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

// caPOS offline-first database: caches menu/members for the /pos screen
// and queues transactions made while the connection is down, so the
// "Online"/"Offline" badge in the cashier navbar can flip freely without
// blocking a sale.
class CaPOSDB extends Dexie {
  products!: Table<CachedProduct, string>;
  memberships!: Table<CachedMembership, string>;
  pendingTransactions!: Table<PendingTransaction, number>;

  constructor() {
    super("caPOS_offline_db");
    this.version(1).stores({
      products: "id, tenant_id, category, is_available",
      memberships: "id, tenant_id, member_code, is_active",
      pendingTransactions: "++local_id, tenant_id, synced, created_at",
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
