'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';

interface DeleteAccountModalProps {
  open: boolean;
  onClose: () => void;
  businessName: string;
  /** May be async and may throw/reject with an Error(message) — the
   *  modal shows that message and stays open so the user can retry. */
  onConfirm: () => void | Promise<void>;
}

/**
 * PRIORITY 12 audit finding: onConfirm used to be called and forgotten —
 * no loading state while the (real, slow — it wipes an entire tenant)
 * delete runs, and no way to show an error if it failed. Now tracks
 * isDeleting/error so the person gets real feedback instead of a modal
 * that just silently sits there or silently closes.
 */
export function DeleteAccountModal({ open, onClose, businessName, onConfirm }: DeleteAccountModalProps) {
  const [typedName, setTypedName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (typedName !== businessName || isDeleting) return;
    setIsDeleting(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus akun. Coba lagi.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal open={open} onClose={isDeleting ? () => {} : onClose} title="Hapus Akun">
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-800">
            ⚠️ Tindakan ini tidak dapat dibatalkan. Seluruh data kafe Anda — menu, transaksi, karyawan,
            cabang, stok — akan dihapus selamanya.
          </p>
        </div>
        {error && <Alert variant="error" message={error} />}
        <p className="text-sm text-gray-700">
          Untuk mengkonfirmasi penghapusan akun, ketik nama bisnis:
        </p>
        <p className="font-semibold text-gray-900">{businessName}</p>
        <Input
          placeholder="Ketik nama bisnis Anda"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          disabled={isDeleting}
        />
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            Batal
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={typedName !== businessName || isDeleting}
          >
            {isDeleting ? 'Menghapus...' : 'Hapus Akun'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
