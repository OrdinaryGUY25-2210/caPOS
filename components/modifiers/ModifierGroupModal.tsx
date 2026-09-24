"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/Modal";
import type { ModifierGroup } from "@/lib/types";

/**
 * Variant & Modifier §5 — form grup modifier (mis. "Level Gula"), dipisah
 * dari app/dashboard/modifiers/page.tsx.
 */
export default function ModifierGroupModal({
  group,
  saving,
  onClose,
  onSave,
}: {
  group: ModifierGroup | null;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Partial<ModifierGroup> & { name: string }) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [required, setRequired] = useState(group?.is_required ?? false);
  const [minSelect, setMinSelect] = useState(String(group?.min_select ?? 0));
  const [maxSelect, setMaxSelect] = useState(String(group?.max_select ?? 1));

  return (
    <Modal
      title={group ? `Edit Grup — ${group.name}` : "Tambah Grup Modifier"}
      onClose={onClose}
      footer={
        <button
          disabled={saving || !name.trim()}
          onClick={() =>
            onSave({ id: group?.id, name: name.trim(), is_required: required, min_select: Number(minSelect || 0), max_select: Number(maxSelect || 1) })
          }
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan
        </button>
      }
    >
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Grup</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Level Gula" className="input-field" />
      </div>
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="rounded" />
        Wajib dipilih pelanggan
      </label>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Minimal Pilih</label>
          <input type="text" inputMode="numeric" value={minSelect} onChange={(e) => setMinSelect(e.target.value.replace(/[^0-9]/g, ""))} className="input-field" />
        </div>
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Maksimal Pilih</label>
          <input type="text" inputMode="numeric" value={maxSelect} onChange={(e) => setMaxSelect(e.target.value.replace(/[^0-9]/g, ""))} className="input-field" />
        </div>
      </div>
    </Modal>
  );
}
