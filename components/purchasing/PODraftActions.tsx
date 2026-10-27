'use client'

import { useState } from 'react'
// SESUAIKAN path ini dengan client Supabase yang dipakai di proyek Anda
// (cari file yang dipakai halaman Pemasok / Bahan Baku, mis. '@/lib/supabase/client').
import { createClient } from '@/lib/supabase/client'

type Props = {
  poId: string
  poNumber: string
  status: string // 'draft' | 'received' | ...
  onDeleted?: () => void // panggil fungsi reload daftar PO di halaman
}

/**
 * Tombol "Edit" untuk baris PO. Hanya muncul untuk PO berstatus Draft.
 * Membuka dialog kecil berisi tombol "Hapus PO" yang memanggil fungsi
 * delete_draft_purchase_order (lihat migration_020_hapus_po_draft.sql).
 */
export default function PODraftActions({ poId, poNumber, status, onDeleted }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status.toLowerCase() !== 'draft') return null

  async function handleDelete() {
    if (busy) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('delete_draft_purchase_order', { p_po_id: poId })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setOpen(false)
    onDeleted?.()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-blue-600 hover:underline"
      >
        Edit
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900">Edit {poNumber}</h3>
            <p className="mt-2 text-sm text-gray-600">
              PO ini masih berstatus Draft, jadi boleh dihapus. PO yang sudah
              diterima (GRN) tidak bisa dihapus.
            </p>

            {error && (
              <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Menghapus…' : 'Hapus PO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
