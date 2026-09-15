"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2, QrCode, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import type { BranchTable } from "@/lib/types";
import QrTableCard from "@/components/tables/QrTableCard";
import { downloadTablesPdf } from "@/components/tables/qrPdfExport";

/**
 * Manajemen Meja & Generator QR — Owner/Manager menambah meja per cabang,
 * lalu unduh/cetak QR Code (mengarah ke /order/<slug-cabang>/<no-meja>)
 * untuk ditempel di masing-masing meja.
 */
export default function QrTablesPage() {
  const { selectedBranchId, selectedBranch, branches, loading: branchLoading } = useBranch();
  const [tables, setTables] = useState<BranchTable[]>([]);
  const [branchSlug, setBranchSlug] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [newTableNumber, setNewTableNumber] = useState("");
  const [newCapacity, setNewCapacity] = useState("4");
  const [saving, setSaving] = useState(false);
  const [siteOrigin, setSiteOrigin] = useState("https://capos.id");

  const effectiveBranchId = selectedBranchId === ALL_BRANCHES ? branches[0]?.id : selectedBranchId;

  useEffect(() => {
    if (typeof window !== "undefined") setSiteOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (branchLoading || !effectiveBranchId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBranchId, branchLoading]);

  async function load() {
    setLoading(true);
    const supabase = createClient();

    const branch = selectedBranch ?? branches.find((b) => b.id === effectiveBranchId);
    setBranchSlug((branch as any)?.slug ?? "");

    const { data } = await supabase
      .from("branch_tables")
      .select("*")
      .eq("branch_id", effectiveBranchId)
      .order("table_number", { ascending: true });

    setTables((data as BranchTable[]) ?? []);
    setLoading(false);
  }

  async function addTable() {
    if (!newTableNumber.trim() || !effectiveBranchId) return;
    setSaving(true);
    const { profile } = await getCurrentProfile();
    const supabase = createClient();
    const { error } = await supabase.from("branch_tables").insert({
      tenant_id: profile?.tenant_id,
      branch_id: effectiveBranchId,
      table_number: newTableNumber.trim(),
      capacity: Number(newCapacity) || 4,
    });
    setSaving(false);
    if (error) {
      alert("Gagal menambah meja: " + error.message);
      return;
    }
    setNewTableNumber("");
    load();
  }

  async function removeTable(id: string) {
    if (!confirm("Nonaktifkan meja ini? QR yang sudah dicetak tidak akan bisa dipakai lagi.")) return;
    const supabase = createClient();
    await supabase.from("branch_tables").update({ is_active: false }).eq("id", id);
    load();
  }

  const orderUrlFor = (tableNumber: string) => `${siteOrigin}/order/${branchSlug}/${encodeURIComponent(tableNumber)}`;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">QR Meja &amp; Pemesanan Mandiri</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Tambah meja, lalu unduh/cetak QR Code untuk ditempel di masing-masing meja.
          </p>
        </div>
        {tables.length > 0 && (
          <button
            onClick={() => downloadTablesPdf(tables.filter((t) => t.is_active), branchSlug, siteOrigin, selectedBranch?.name ?? "Cabang")}
            className="flex items-center gap-2 bg-neutral-900 text-white text-sm font-medium rounded-xl px-4 py-2.5"
          >
            <Download size={16} /> Unduh Semua QR (PDF)
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-4 mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-neutral-600">Nomor Meja</label>
          <input
            value={newTableNumber}
            onChange={(e) => setNewTableNumber(e.target.value)}
            placeholder="Mis. 12 atau A1"
            className="block mt-1 border border-neutral-200 rounded-xl px-3 py-2 text-sm w-40"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-600">Kapasitas Kursi</label>
          <input
            type="number"
            min={1}
            value={newCapacity}
            onChange={(e) => setNewCapacity(e.target.value)}
            className="block mt-1 border border-neutral-200 rounded-xl px-3 py-2 text-sm w-28"
          />
        </div>
        <button
          onClick={addTable}
          disabled={saving || !newTableNumber.trim()}
          className="flex items-center gap-2 bg-primary text-white text-sm font-medium rounded-xl px-4 py-2.5 disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Tambah Meja
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-neutral-300" size={28} />
        </div>
      ) : tables.filter((t) => t.is_active).length === 0 ? (
        <div className="text-center py-16 text-neutral-400">
          <QrCode size={32} className="mx-auto mb-2" />
          <p className="text-sm">Belum ada meja. Tambahkan meja pertama di atas.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tables
            .filter((t) => t.is_active)
            .map((table) => (
              <QrTableCard
                key={table.id}
                table={table}
                orderUrl={orderUrlFor(table.table_number)}
                onDeactivate={() => removeTable(table.id)}
              />
            ))}
        </div>
      )}
    </div>
  );
}
