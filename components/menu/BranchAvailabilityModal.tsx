"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useBranch } from "@/lib/branchContext";
import { cx } from "@/lib/utils";
import Modal from "@/components/Modal";

/**
 * "Dijual di cabang" — atur menu mana yang dijual di cabang mana.
 *
 *  - Dicentang  = dijual di cabang itu (perilaku normal / default).
 *  - Tidak dicentang = menu disembunyikan di cabang itu (tidak tampil di kasir & QR Self-Order).
 *
 * Disimpan di tabel branch_product_availability (migration_026): menu disembunyikan = ada baris
 * is_available=false; dijual kembali = baris dihapus. Owner bisa mengatur semua cabang, manager
 * hanya cabangnya sendiri (juga ditegakkan oleh RLS di database).
 */
export default function BranchAvailabilityModal({
  tenantId,
  product,
  onClose,
}: {
  tenantId: string;
  product: { id: string; name: string };
  onClose: () => void;
}) {
  const { branches, canSwitchBranch, ownBranchId } = useBranch();
  const activeBranches = branches.filter((b) => b.is_active);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initialSold, setInitialSold] = useState<Set<string>>(new Set());
  const [sold, setSold] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const editable = (branchId: string) => canSwitchBranch || branchId === ownBranchId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("branch_product_availability")
        .select("branch_id, is_available")
        .eq("product_id", product.id);
      if (cancelled) return;
      if (err) {
        setError(
          err.message.includes("does not exist") || err.message.includes("schema cache")
            ? "Fitur ini belum aktif di database. Jalankan migration_026_branch_product_availability.sql dulu."
            : "Gagal memuat pengaturan: " + err.message
        );
      }
      const hidden = new Set(
        ((data as { branch_id: string; is_available: boolean }[]) ?? [])
          .filter((r) => r.is_available === false)
          .map((r) => r.branch_id)
      );
      const soldNow = new Set(activeBranches.filter((b) => !hidden.has(b.id)).map((b) => b.id));
      setInitialSold(soldNow);
      setSold(new Set(soldNow));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  function toggle(branchId: string) {
    if (!editable(branchId)) return;
    setSold((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  }

  function setAll(value: boolean) {
    setSold((prev) => {
      const next = new Set(prev);
      for (const b of activeBranches) {
        if (!editable(b.id)) continue;
        if (value) next.add(b.id);
        else next.delete(b.id);
      }
      return next;
    });
  }

  const changed = activeBranches.filter((b) => editable(b.id) && sold.has(b.id) !== initialSold.has(b.id));
  const soldNowhere = activeBranches.length > 0 && activeBranches.every((b) => !sold.has(b.id));

  async function save() {
    if (saving || changed.length === 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();

    const results = await Promise.all(
      changed.map((b) =>
        sold.has(b.id)
          ? // dijual lagi → hapus baris penyembunyi
            supabase.from("branch_product_availability").delete().eq("branch_id", b.id).eq("product_id", product.id)
          : // disembunyikan → buat/perbarui baris is_available=false
            supabase.from("branch_product_availability").upsert(
              {
                tenant_id: tenantId,
                branch_id: b.id,
                product_id: product.id,
                is_available: false,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "branch_id,product_id" }
            )
      )
    );
    setSaving(false);

    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError("Gagal menyimpan: " + failed.error.message);
      return;
    }
    onClose();
  }

  const footer = (
    <div className="flex gap-2 w-full">
      <button type="button" onClick={onClose} disabled={saving} className="btn-outline flex-1">
        Batal
      </button>
      <button
        type="button"
        onClick={save}
        disabled={saving || loading || changed.length === 0}
        className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving && <Loader2 className="animate-spin" size={16} />}
        Simpan
      </button>
    </div>
  );

  return (
    <Modal title={`Dijual di cabang — ${product.name || "Tanpa nama"}`} onClose={onClose} footer={footer}>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-400">
          <Loader2 className="animate-spin" size={16} /> Memuat cabang...
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Centang cabang yang <strong>menjual</strong> menu ini. Cabang yang tidak dicentang tidak akan menampilkan menu ini
            di kasir dan QR Self-Order. Harga dan resep tetap sama untuk semua cabang.
          </p>

          {canSwitchBranch && activeBranches.length > 1 && (
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={() => setAll(true)} className="text-primary hover:underline">
                Pilih semua
              </button>
              <button type="button" onClick={() => setAll(false)} className="text-neutral-500 hover:underline">
                Kosongkan
              </button>
            </div>
          )}

          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {activeBranches.map((b) => {
              const can = editable(b.id);
              return (
                <li key={b.id}>
                  <label
                    className={cx(
                      "flex items-center gap-3 px-3 py-2.5",
                      can ? "cursor-pointer hover:bg-neutral-50" : "cursor-not-allowed opacity-60"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={sold.has(b.id)}
                      disabled={!can}
                      onChange={() => toggle(b.id)}
                      className="h-4 w-4 rounded border-neutral-300 text-primary focus:ring-primary"
                    />
                    <span className="flex-1 text-sm text-neutral-800">
                      {b.name}
                      {b.is_main && <span className="ml-2 text-[11px] text-neutral-400">Cabang Utama</span>}
                    </span>
                    <span className={cx("text-xs", sold.has(b.id) ? "text-primary-dark" : "text-neutral-400")}>
                      {sold.has(b.id) ? "Dijual" : "Tidak dijual"}
                    </span>
                  </label>
                </li>
              );
            })}
            {activeBranches.length === 0 && (
              <li className="px-3 py-4 text-sm text-neutral-400">Belum ada cabang aktif.</li>
            )}
          </ul>

          {!canSwitchBranch && (
            <p className="text-xs text-neutral-400">Anda hanya bisa mengatur cabang Anda sendiri. Cabang lain diatur oleh owner.</p>
          )}
          {soldNowhere && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Menu ini tidak dijual di cabang mana pun, jadi tidak akan tampil di kasir maupun QR Self-Order.
            </p>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
