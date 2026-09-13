'use client';

import React, { useState, useEffect } from 'react';
import { createSupplier, getSuppliers, updateSupplier } from '@/app/actions/purchasing-loyalty-actions';
import Modal from '@/components/Modal';

interface Supplier {
  id: string;
  supplier_code: string;
  company_name: string;
  contact_person?: string;
  phone_number?: string;
  whatsapp_number?: string;
  email?: string;
  address?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  payment_terms?: string;
  categories?: string[];
  is_active: boolean;
  created_at: string;
}

export function SupplierManagement() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    supplier_code: '',
    company_name: '',
    contact_person: '',
    phone_number: '',
    whatsapp_number: '',
    email: '',
    address: '',
    city: '',
    province: '',
    postal_code: '',
    payment_terms: '',
    categories: [] as string[],
  });

  const categories = ['Bahan Kering', 'Daging', 'Sayur', 'Buah', 'Minuman', 'Kemasan'];

  useEffect(() => {
    loadSuppliers();
  }, []);

  const loadSuppliers = async () => {
    setIsLoading(true);
    const result = await getSuppliers();
    if (result.error) {
      setError(result.error);
    } else {
      setSuppliers(result.data || []);
    }
    setIsLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      if (editingId) {
        const result = await updateSupplier(editingId, formData);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccess('Pemasok berhasil diperbarui');
          setShowForm(false);
          setEditingId(null);
          loadSuppliers();
        }
      } else {
        const result = await createSupplier(formData);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccess('Pemasok berhasil ditambahkan');
          setShowForm(false);
          loadSuppliers();
        }
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleEditSupplier = (supplier: Supplier) => {
    setFormData({
      supplier_code: supplier.supplier_code,
      company_name: supplier.company_name,
      contact_person: supplier.contact_person || '',
      phone_number: supplier.phone_number || '',
      whatsapp_number: supplier.whatsapp_number || '',
      email: supplier.email || '',
      address: supplier.address || '',
      city: supplier.city || '',
      province: supplier.province || '',
      postal_code: supplier.postal_code || '',
      payment_terms: supplier.payment_terms || '',
      categories: supplier.categories || [],
    });
    setEditingId(supplier.id);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({
      supplier_code: '',
      company_name: '',
      contact_person: '',
      phone_number: '',
      whatsapp_number: '',
      email: '',
      address: '',
      city: '',
      province: '',
      postal_code: '',
      payment_terms: '',
      categories: [],
    });
  };

  const toggleCategory = (category: string) => {
    setFormData((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((c) => c !== category)
        : [...prev.categories, category],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Manajemen Pemasok</h1>
          <p className="text-gray-600 mt-2">Kelola data supplier dan kategori bahan</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary"
        >
          + Tambah Pemasok
        </button>
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

      {/* Suppliers Table */}
      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center text-neutral-500">
            Memuat data pemasok...
          </div>
        ) : suppliers.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">
            Belum ada pemasok. Tambahkan pemasok baru untuk memulai.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-neutral-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Kode</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Nama Perusahaan</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Kontak</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Kategori</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Kota</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id} className="border-b hover:bg-neutral-50">
                    <td className="px-6 py-3 text-sm font-mono">{supplier.supplier_code}</td>
                    <td className="px-6 py-3 text-sm font-semibold">{supplier.company_name}</td>
                    <td className="px-6 py-3 text-sm">
                      {supplier.whatsapp_number && (
                        <a
                          href={`https://wa.me/${supplier.whatsapp_number}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-600 hover:underline"
                        >
                          {supplier.whatsapp_number}
                        </a>
                      )}
                    </td>
                    <td className="px-6 py-3 text-sm">
                      <div className="flex flex-wrap gap-1">
                        {supplier.categories?.map((cat) => (
                          <span
                            key={cat}
                            className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-sm">{supplier.city}</td>
                    <td className="px-6 py-3 text-sm">
                      <button
                        onClick={() => handleEditSupplier(supplier)}
                        className="text-blue-600 hover:underline mr-4"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
      <Modal title={editingId ? 'Edit Pemasok' : 'Tambah Pemasok Baru'} onClose={handleCloseForm} maxWidth="sm:max-w-2xl">
        <div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Grid 2 Kolom */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Kode Pemasok *</label>
                <input
                  type="text"
                  required
                  value={formData.supplier_code}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, supplier_code: e.target.value }))
                  }
                  className="input-field"
                  placeholder="SUP-001"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Nama Perusahaan *</label>
                <input
                  type="text"
                  required
                  value={formData.company_name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, company_name: e.target.value }))
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Kontak Pihak</label>
                <input
                  type="text"
                  value={formData.contact_person}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, contact_person: e.target.value }))
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">No. HP</label>
                <input
                  type="tel"
                  value={formData.phone_number}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, phone_number: e.target.value }))
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">WhatsApp</label>
                <input
                  type="tel"
                  value={formData.whatsapp_number}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, whatsapp_number: e.target.value }))
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, email: e.target.value }))
                  }
                  className="input-field"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium mb-2">Alamat</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, address: e.target.value }))
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Kota</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, city: e.target.value }))
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Provinsi</label>
                <input
                  type="text"
                  value={formData.province}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, province: e.target.value }))
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Kode Pos</label>
                <input
                  type="text"
                  value={formData.postal_code}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, postal_code: e.target.value }))
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Syarat Pembayaran</label>
                <input
                  type="text"
                  value={formData.payment_terms}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, payment_terms: e.target.value }))
                  }
                  className="input-field"
                  placeholder="NET 30, COD"
                />
              </div>
            </div>

            {/* Categories */}
            <div>
              <label className="block text-sm font-medium mb-3">Kategori Bahan yang Disuplai</label>
              <div className="grid grid-cols-2 gap-3">
                {categories.map((cat) => (
                  <label key={cat} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.categories.includes(cat)}
                      onChange={() => toggleCategory(cat)}
                      className="w-4 h-4 mr-2"
                    />
                    <span className="text-sm">{cat}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              <button
                type="submit"
                className="flex-1 btn-primary text-center"
              >
                {editingId ? 'Simpan Perubahan' : 'Tambah Pemasok'}
              </button>
              <button
                type="button"
                onClick={handleCloseForm}
                className="flex-1 btn-outline"
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
