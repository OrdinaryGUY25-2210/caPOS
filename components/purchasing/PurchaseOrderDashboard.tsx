'use client';

import React, { useState, useEffect } from 'react';
import {
  createPurchaseOrder,
  getSuppliers,
  createGoodsReceipt,
  getIngredientsForPurchasing,
} from '@/app/actions/purchasing-loyalty-actions';
import { useBranch, ALL_BRANCHES } from '@/lib/branchContext';
import Modal from '@/components/Modal';

interface POLineItem {
  ingredient_id: string;
  product_name: string;
  unit: string;
  qty_ordered: number;
  unit_price: number;
}

interface GRNLineItem {
  po_item_id: string;
  ingredient_id: string;
  product_name: string;
  unit: string;
  qty_received: number;
  unit_price: number;
}

interface Supplier {
  id: string;
  supplier_code: string;
  company_name: string;
}

interface IngredientOption {
  id: string;
  name: string;
  category: string | null;
  purchase_unit: string;
}

export function PurchaseOrderDashboard() {
  const { selectedBranchId, selectedBranch, canSwitchBranch, ownBranchId } = useBranch();
  const isConsolidated = selectedBranchId === ALL_BRANCHES;
  // Cabang yang benar-benar dipakai untuk transaksi tulis: kalau owner sedang
  // di "Laporan Konsolidasi" (ALL_BRANCHES bukan uuid asli), tidak ada cabang
  // valid untuk disimpan → PO/GRN harus diblokir sampai 1 cabang dipilih.
  const writeBranchId = isConsolidated ? ownBranchId : selectedBranchId;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [ingredients, setIngredients] = useState<IngredientOption[]>([]);
  const [showPOForm, setShowPOForm] = useState(false);
  const [showGRNForm, setShowGRNForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [poFormData, setPoFormData] = useState({
    supplier_id: '',
    expected_delivery_date: '',
    notes: '',
    items: [] as POLineItem[],
  });

  const [grnFormData, setGrnFormData] = useState({
    po_number: '',
    notes: '',
    items: [] as GRNLineItem[],
  });

  const [newLineItem, setNewLineItem] = useState<POLineItem>({
    ingredient_id: '',
    product_name: '',
    unit: '',
    qty_ordered: 0,
    unit_price: 0,
  });

  const [newGrnItem, setNewGrnItem] = useState<GRNLineItem>({
    po_item_id: '',
    ingredient_id: '',
    product_name: '',
    unit: '',
    qty_received: 0,
    unit_price: 0,
  });

  useEffect(() => {
    loadSuppliers();
    loadIngredients();
  }, []);

  const loadSuppliers = async () => {
    const result = await getSuppliers();
    if (!result.error) {
      setSuppliers(result.data || []);
    }
  };

  const loadIngredients = async () => {
    const result = await getIngredientsForPurchasing();
    if (!result.error) {
      setIngredients(result.data || []);
    }
  };

  /** Dipanggil dari dropdown "Nama Produk" (PO) — isi ingredient_id, nama, dan unit sekaligus. */
  const handlePickPOIngredient = (ingredientId: string) => {
    const ing = ingredients.find((i) => i.id === ingredientId);
    setNewLineItem((prev) => ({
      ...prev,
      ingredient_id: ingredientId,
      product_name: ing?.name || '',
      unit: ing?.purchase_unit || '',
    }));
  };

  /** Sama seperti di atas, tapi untuk dropdown "Produk" di form GRN. */
  const handlePickGrnIngredient = (ingredientId: string) => {
    const ing = ingredients.find((i) => i.id === ingredientId);
    setNewGrnItem((prev) => ({
      ...prev,
      ingredient_id: ingredientId,
      product_name: ing?.name || '',
      unit: ing?.purchase_unit || '',
    }));
  };

  // =========== PO Form Handlers ===========
  const handleAddPOItem = () => {
    if (!newLineItem.ingredient_id || newLineItem.qty_ordered <= 0 || newLineItem.unit_price <= 0) {
      setError('Pilih bahan baku dan lengkapi qty & harga terlebih dahulu');
      return;
    }

    setPoFormData((prev) => ({
      ...prev,
      items: [...prev.items, { ...newLineItem }],
    }));

    setNewLineItem({
      ingredient_id: '',
      product_name: '',
      unit: '',
      qty_ordered: 0,
      unit_price: 0,
    });
  };

  const handleRemovePOItem = (index: number) => {
    setPoFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const handleSubmitPO = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!poFormData.supplier_id) {
      setError('Pilih pemasok terlebih dahulu');
      return;
    }

    if (poFormData.items.length === 0) {
      setError('Tambahkan minimal satu item');
      return;
    }

    if (!writeBranchId) {
      setError('Pilih 1 cabang dulu di kanan atas sebelum membuat PO (tidak bisa dari mode Laporan Konsolidasi).');
      return;
    }

    try {
      const result = await createPurchaseOrder({
        supplier_id: poFormData.supplier_id,
        branch_id: writeBranchId,
        expected_delivery_date: poFormData.expected_delivery_date,
        notes: poFormData.notes,
        items: poFormData.items,
      });

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setSuccess(`PO berhasil dibuat: ${result.data.po_number}`);
        setShowPOForm(false);
        resetPOForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat PO.');
    }
  };

  const resetPOForm = () => {
    setPoFormData({
      supplier_id: '',
      expected_delivery_date: '',
      notes: '',
      items: [],
    });
    setNewLineItem({
      ingredient_id: '',
      product_name: '',
      unit: '',
      qty_ordered: 0,
      unit_price: 0,
    });
  };

  // =========== GRN Form Handlers ===========
  const handleAddGrnItem = () => {
    if (
      !newGrnItem.ingredient_id ||
      newGrnItem.qty_received <= 0 ||
      newGrnItem.unit_price <= 0
    ) {
      setError('Pilih bahan baku dan lengkapi qty & harga item GRN terlebih dahulu');
      return;
    }

    setGrnFormData((prev) => ({
      ...prev,
      items: [...prev.items, { ...newGrnItem }],
    }));

    setNewGrnItem({
      po_item_id: '',
      ingredient_id: '',
      product_name: '',
      unit: '',
      qty_received: 0,
      unit_price: 0,
    });
  };

  const handleRemoveGrnItem = (index: number) => {
    setGrnFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const handleSubmitGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!grnFormData.po_number.trim()) {
      setError('Masukkan nomor PO terlebih dahulu');
      return;
    }

    if (grnFormData.items.length === 0) {
      setError('Tambahkan minimal satu item');
      return;
    }

    try {
      const result = await createGoodsReceipt({
        po_number: grnFormData.po_number.trim(),
        notes: grnFormData.notes,
        items: grnFormData.items,
      });

      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setSuccess(`GRN berhasil dibuat: ${result.data.grn_number}`);
        setShowGRNForm(false);
        setGrnFormData({
          po_number: '',
          notes: '',
          items: [],
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan GRN.');
    }
  };

  const poSubtotal = poFormData.items.reduce(
    (sum, item) => sum + item.qty_ordered * item.unit_price,
    0
  );

  const grnSubtotal = grnFormData.items.reduce(
    (sum, item) => sum + item.qty_received * item.unit_price,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pengadaan Bahan</h1>
          <p className="text-gray-600 mt-2">Kelola Purchase Order dan Penerimaan Barang</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPOForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Buat PO
          </button>
          <button
            onClick={() => setShowGRNForm(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            + Terima Barang (GRN)
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
          {success}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg p-6 shadow">
          <div className="text-sm text-gray-600">PO Pending</div>
          <div className="text-3xl font-bold mt-2">-</div>
        </div>
        <div className="bg-white rounded-lg p-6 shadow">
          <div className="text-sm text-gray-600">Barang Diterima</div>
          <div className="text-3xl font-bold mt-2">-</div>
        </div>
        <div className="bg-white rounded-lg p-6 shadow">
          <div className="text-sm text-gray-600">Total Pembelian (30 hari)</div>
          <div className="text-3xl font-bold mt-2">Rp -</div>
        </div>
      </div>

      {/* PO Form Modal */}
      {showPOForm && (
      <Modal title="Buat Purchase Order Baru" onClose={() => setShowPOForm(false)} maxWidth="sm:max-w-4xl">
        <div className="bg-white rounded-lg p-8 max-w-4xl max-h-[90vh] overflow-y-auto">
          <h2 className="text-2xl font-bold mb-6">Buat Purchase Order Baru</h2>

          <form onSubmit={handleSubmitPO} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Pemasok *</label>
                <select
                  required
                  value={poFormData.supplier_id}
                  onChange={(e) =>
                    setPoFormData((prev) => ({ ...prev, supplier_id: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">-- Pilih Pemasok --</option>
                  {suppliers.map((sup) => (
                    <option key={sup.id} value={sup.id}>
                      {sup.company_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Tanggal Pengiriman</label>
                <input
                  type="date"
                  value={poFormData.expected_delivery_date}
                  onChange={(e) =>
                    setPoFormData((prev) => ({
                      ...prev,
                      expected_delivery_date: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>

            {/* Items Section */}
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Item PO</h3>

              {/* Item Input */}
              <div className="bg-gray-50 p-4 rounded-lg mb-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-medium">Nama Produk</label>
                    <select
                      value={newLineItem.ingredient_id}
                      onChange={(e) => handlePickPOIngredient(e.target.value)}
                      className="w-full px-2 py-2 border rounded text-sm mt-1"
                    >
                      <option value="">-- Pilih Bahan Baku --</option>
                      {ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name} ({ing.purchase_unit})
                        </option>
                      ))}
                    </select>
                    {ingredients.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        Belum ada Bahan Baku terdaftar — tambahkan dulu di menu Bahan Baku.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs font-medium">Qty</label>
                    <input
                      type="number"
                      min="1"
                      value={newLineItem.qty_ordered || ''}
                      onChange={(e) =>
                        setNewLineItem((prev) => ({
                          ...prev,
                          qty_ordered: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-full px-2 py-2 border rounded text-sm mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium">Harga Satuan</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newLineItem.unit_price || ''}
                      onChange={(e) =>
                        setNewLineItem((prev) => ({
                          ...prev,
                          unit_price: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-full px-2 py-2 border rounded text-sm mt-1"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleAddPOItem}
                      className="w-full px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      Tambah
                    </button>
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="border rounded-lg overflow-x-auto">
                {poFormData.items.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">Belum ada item</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-left">Produk</th>
                        <th className="px-4 py-2 text-center">Qty</th>
                        <th className="px-4 py-2 text-right">Harga Satuan</th>
                        <th className="px-4 py-2 text-right">Subtotal</th>
                        <th className="px-4 py-2 text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {poFormData.items.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-4 py-2">{item.product_name}</td>
                          <td className="px-4 py-2 text-center">{item.qty_ordered}</td>
                          <td className="px-4 py-2 text-right">
                            Rp {item.unit_price.toLocaleString('id-ID')}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold">
                            Rp {(item.qty_ordered * item.unit_price).toLocaleString('id-ID')}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemovePOItem(idx)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              Hapus
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-semibold">
                        <td colSpan={3} className="px-4 py-2 text-right">
                          Total:
                        </td>
                        <td className="px-4 py-2 text-right">
                          Rp {poSubtotal.toLocaleString('id-ID')}
                        </td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Catatan */}
            <div>
              <label className="block text-sm font-medium mb-2">Catatan</label>
              <textarea
                value={poFormData.notes}
                onChange={(e) =>
                  setPoFormData((prev) => ({ ...prev, notes: e.target.value }))
                }
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="Catatan khusus untuk pemasok..."
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Buat PO
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPOForm(false);
                  resetPOForm();
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
            </div>
          </form>
        </div>
      </Modal>
      )}

      {/* GRN Form Modal */}
      {showGRNForm && (
      <Modal title="Terima Barang (Goods Receipt)" onClose={() => setShowGRNForm(false)} maxWidth="sm:max-w-4xl">
        <div className="bg-white rounded-lg p-8 max-w-4xl max-h-[90vh] overflow-y-auto">
          <h2 className="text-2xl font-bold mb-6">Penerimaan Barang (GRN)</h2>

          <form onSubmit={handleSubmitGrn} className="space-y-6">
            {/* PO Selection */}
            <div>
              <label className="block text-sm font-medium mb-2">Nomor PO *</label>
              <input
                type="text"
                placeholder="Misal: PO-2026-017"
                value={grnFormData.po_number}
                onChange={(e) =>
                  setGrnFormData((prev) => ({ ...prev, po_number: e.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
              <p className="text-xs text-gray-500 mt-1">
                Salin persis nomor PO dari daftar Purchase Order (contoh: PO-2026-017).
              </p>
            </div>

            {/* Items Section */}
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Item Penerimaan</h3>

              {/* Item Input */}
              <div className="bg-gray-50 p-4 rounded-lg mb-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  <div>
                    <label className="text-xs font-medium">Produk</label>
                    <select
                      value={newGrnItem.ingredient_id}
                      onChange={(e) => handlePickGrnIngredient(e.target.value)}
                      className="w-full px-2 py-2 border rounded text-sm mt-1"
                    >
                      <option value="">-- Pilih Bahan Baku --</option>
                      {ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium">Unit</label>
                    <input
                      type="text"
                      value={newGrnItem.unit}
                      readOnly
                      placeholder="Otomatis dari Bahan Baku"
                      className="w-full px-2 py-2 border rounded text-sm mt-1 bg-gray-100 text-gray-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium">Qty Diterima</label>
                    <input
                      type="number"
                      min="1"
                      value={newGrnItem.qty_received || ''}
                      onChange={(e) =>
                        setNewGrnItem((prev) => ({
                          ...prev,
                          qty_received: parseInt(e.target.value) || 0,
                        }))
                      }
                      className="w-full px-2 py-2 border rounded text-sm mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium">Harga Satuan</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newGrnItem.unit_price || ''}
                      onChange={(e) =>
                        setNewGrnItem((prev) => ({
                          ...prev,
                          unit_price: parseFloat(e.target.value) || 0,
                        }))
                      }
                      className="w-full px-2 py-2 border rounded text-sm mt-1"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleAddGrnItem}
                      className="w-full px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                    >
                      Tambah
                    </button>
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="border rounded-lg overflow-x-auto">
                {grnFormData.items.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">Belum ada item</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-left">Produk</th>
                        <th className="px-4 py-2 text-center">Unit</th>
                        <th className="px-4 py-2 text-center">Qty</th>
                        <th className="px-4 py-2 text-right">Harga Satuan</th>
                        <th className="px-4 py-2 text-right">Total</th>
                        <th className="px-4 py-2 text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grnFormData.items.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-4 py-2">{item.product_name}</td>
                          <td className="px-4 py-2 text-center">{item.unit}</td>
                          <td className="px-4 py-2 text-center">{item.qty_received}</td>
                          <td className="px-4 py-2 text-right">
                            Rp {item.unit_price.toLocaleString('id-ID')}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold">
                            Rp {(item.qty_received * item.unit_price).toLocaleString('id-ID')}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveGrnItem(idx)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              Hapus
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-semibold">
                        <td colSpan={4} className="px-4 py-2 text-right">
                          Total Penerimaan:
                        </td>
                        <td className="px-4 py-2 text-right">
                          Rp {grnSubtotal.toLocaleString('id-ID')}
                        </td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-2">Catatan</label>
              <textarea
                value={grnFormData.notes}
                onChange={(e) =>
                  setGrnFormData((prev) => ({ ...prev, notes: e.target.value }))
                }
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="Kondisi barang, kerusakan, dll..."
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Simpan GRN & Update Stok
              </button>
              <button
                type="button"
                onClick={() => setShowGRNForm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
            </div>
          </form>
        </div>
      </Modal>
      )}
    </div>
  );
}
