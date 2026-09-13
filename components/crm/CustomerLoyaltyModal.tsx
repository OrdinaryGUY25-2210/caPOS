'use client';

import React, { useState } from 'react';
import {
  searchCustomers,
  getCustomerProfile,
  createCustomer,
  createPromotion,
  recordLoyaltyEarn,
} from '@/app/actions/purchasing-loyalty-actions';
import Modal from '@/components/Modal';

interface Customer {
  id: string;
  customer_code: string;
  customer_name: string;
  phone_number?: string;
  lifetime_spend: number;
  loyaltyBalance?: number;
  recentTransactions?: any[];
}

interface CustomerLoyaltyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCustomer: (customer: Customer) => void;
  transactionAmount?: number;
}

export function CustomerLoyaltyModal({
  isOpen,
  onClose,
  onSelectCustomer,
  transactionAmount = 0,
}: CustomerLoyaltyModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerProfile, setCustomerProfile] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [newCustomerData, setNewCustomerData] = useState({
    customer_code: '',
    customer_name: '',
    phone_number: '',
    whatsapp_number: '',
    email: '',
  });

  const handleSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const result = await searchCustomers(query);
    if (!result.error) {
      setSearchResults(result.data || []);
    }
    setIsSearching(false);
  };

  const handleSelectCustomer = async (customer: Customer) => {
    setIsLoading(true);
    setSelectedCustomer(customer);

    const result = await getCustomerProfile(customer.id);
    if (!result.error) {
      setCustomerProfile(result.data);
    }
    setIsLoading(false);
  };

  const handleConfirmSelection = () => {
    if (selectedCustomer) {
      onSelectCustomer({
        ...selectedCustomer,
        loyaltyBalance: customerProfile?.loyaltyBalance || 0,
      });
      handleClose();
    }
  };

  const handleCreateNewCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const result = await createCustomer(newCustomerData);
      if (result.error || !result.data) {
        setError(result.error || 'Gagal membuat pelanggan baru.');
      } else {
        const newCustomer = {
          id: result.data.id,
          customer_code: result.data.customer_code,
          customer_name: newCustomerData.customer_name,
          phone_number: newCustomerData.phone_number,
          lifetime_spend: 0,
          loyaltyBalance: 0,
        };
        onSelectCustomer(newCustomer);
        handleClose();
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleClose = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedCustomer(null);
    setCustomerProfile(null);
    setShowNewCustomerForm(false);
    setError(null);
    setNewCustomerData({
      customer_code: '',
      customer_name: '',
      phone_number: '',
      whatsapp_number: '',
      email: '',
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal title="Pelanggan & Loyalitas" onClose={handleClose} maxWidth="sm:max-w-2xl">
      <div>
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm mb-4">
            {error}
          </div>
        )}

        {!selectedCustomer ? (
          <>
            {/* Search Section */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Cari Pelanggan</label>
                <input
                  type="text"
                  placeholder="Nama, kode, atau nomor telepon..."
                  value={searchQuery}
                  onChange={handleSearch}
                  className="input-field"
                />
              </div>

              {/* Search Results */}
              <div className="border rounded-lg max-h-64 overflow-y-auto">
                {isSearching ? (
                  <div className="p-4 text-center text-neutral-500">Mencari...</div>
                ) : searchResults.length === 0 ? (
                  <div className="p-4 text-center text-neutral-500">
                    {searchQuery.length < 2
                      ? 'Mulai ketik untuk mencari pelanggan'
                      : 'Pelanggan tidak ditemukan'}
                  </div>
                ) : (
                  <div>
                    {searchResults.map((customer) => (
                      <button
                        key={customer.id}
                        onClick={() => handleSelectCustomer(customer)}
                        className="w-full p-3 text-left hover:bg-blue-50 border-b last:border-b-0 transition"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-semibold">{customer.customer_name}</div>
                            <div className="text-xs text-gray-600">
                              {customer.customer_code}
                              {customer.phone_number && ` • ${customer.phone_number}`}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold">
                              Rp {customer.lifetime_spend?.toLocaleString('id-ID')}
                            </div>
                            <div className="text-xs text-gray-600">Belanja total</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* New Customer Button */}
              <button
                onClick={() => setShowNewCustomerForm(true)}
                className="w-full px-4 py-2 border-2 border-dashed border-neutral-300 rounded-lg text-neutral-600 hover:border-primary hover:text-primary-dark transition"
              >
                + Tambah Pelanggan Baru
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Customer Profile */}
            {isLoading ? (
              <div className="text-center py-8">Memuat profil pelanggan...</div>
            ) : (
              customerProfile && (
                <div className="space-y-6">
                  {/* Header */}
                  <div className="flex items-center justify-between pb-4 border-b">
                    <div>
                      <h3 className="text-xl font-bold">{customerProfile.customer_name}</h3>
                      <p className="text-sm text-gray-600">{customerProfile.customer_code}</p>
                    </div>
                    <button
                      onClick={() => setSelectedCustomer(null)}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      Ubah Pelanggan
                    </button>
                  </div>

                  {/* Info Grid */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <div className="text-xs text-gray-600 mb-1">Poin Loyalitas</div>
                      <div className="text-2xl font-bold text-blue-600">
                        {customerProfile.loyaltyBalance || 0}
                      </div>
                      <div className="text-xs text-neutral-500 mt-1">Poin tersedia</div>
                    </div>

                    <div className="bg-green-50 p-4 rounded-lg">
                      <div className="text-xs text-gray-600 mb-1">Total Belanja</div>
                      <div className="text-xl font-bold text-green-600">
                        Rp {customerProfile.lifetime_spend?.toLocaleString('id-ID')}
                      </div>
                      <div className="text-xs text-neutral-500 mt-1">Sepanjang waktu</div>
                    </div>

                    <div className="bg-purple-50 p-4 rounded-lg">
                      <div className="text-xs text-gray-600 mb-1">Tier Member</div>
                      <div className="text-xl font-bold text-purple-600">
                        {customerProfile.tier_id ? 'Gold' : 'Silver'}
                      </div>
                      <div className="text-xs text-neutral-500 mt-1">Tingkat keanggotaan</div>
                    </div>
                  </div>

                  {/* Loyalty Points Info */}
                  {transactionAmount > 0 && (
                    <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded">
                      <div className="text-sm font-medium text-amber-900">
                        Poin dari transaksi ini:
                      </div>
                      <div className="text-2xl font-bold text-amber-600 mt-1">
                        +{Math.floor(transactionAmount / 10000)} poin
                      </div>
                      <div className="text-xs text-amber-700 mt-2">
                        Setiap Rp 10.000 = 1 poin
                      </div>
                    </div>
                  )}

                  {/* Recent Transactions */}
                  {customerProfile.recentTransactions?.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm">Transaksi Terakhir</h4>
                      <div className="space-y-2">
                        {customerProfile.recentTransactions.map((tx: any) => (
                          <div
                            key={tx.id}
                            className="flex items-center justify-between p-2 bg-neutral-50 rounded"
                          >
                            <div className="text-sm">
                              <div className="font-medium">{tx.invoice_number}</div>
                              <div className="text-xs text-gray-600">
                                {new Date(tx.created_at).toLocaleDateString('id-ID')}
                              </div>
                            </div>
                            <div className="text-sm font-semibold">
                              Rp {tx.total_amount?.toLocaleString('id-ID')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-4 border-t">
                    <button
                      onClick={handleConfirmSelection}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Pilih Pelanggan Ini
                    </button>
                    <button
                      onClick={handleClose}
                      className="flex-1 btn-outline"
                    >
                      Tutup
                    </button>
                  </div>
                </div>
              )
            )}
          </>
        )}

        {/* New Customer Form Modal */}
        {showNewCustomerForm && (
          <form onSubmit={handleCreateNewCustomer} className="space-y-4 mt-6 pt-6 border-t">
            <h3 className="font-semibold text-lg">Pelanggan Baru</h3>

            <div>
              <label className="block text-sm font-medium mb-2">Nama Pelanggan *</label>
              <input
                type="text"
                required
                value={newCustomerData.customer_name}
                onChange={(e) =>
                  setNewCustomerData((prev) => ({
                    ...prev,
                    customer_name: e.target.value,
                  }))
                }
                className="input-field"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Nomor Telepon</label>
              <input
                type="tel"
                value={newCustomerData.phone_number}
                onChange={(e) =>
                  setNewCustomerData((prev) => ({
                    ...prev,
                    phone_number: e.target.value,
                  }))
                }
                className="input-field"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">WhatsApp</label>
              <input
                type="tel"
                value={newCustomerData.whatsapp_number}
                onChange={(e) =>
                  setNewCustomerData((prev) => ({
                    ...prev,
                    whatsapp_number: e.target.value,
                  }))
                }
                className="input-field"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <input
                type="email"
                value={newCustomerData.email}
                onChange={(e) =>
                  setNewCustomerData((prev) => ({
                    ...prev,
                    email: e.target.value,
                  }))
                }
                className="input-field"
              />
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Tambah & Pilih
              </button>
              <button
                type="button"
                onClick={() => setShowNewCustomerForm(false)}
                className="flex-1 btn-outline"
              >
                Batal
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

// =========================================================
// PROMOTION BUILDER COMPONENT
// =========================================================

interface PromotionBuilderProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PromotionBuilder({ isOpen, onClose }: PromotionBuilderProps) {
  const [formData, setFormData] = useState({
    promo_name: '',
    promo_type: 'PERCENTAGE' as const,
    discount_value: 0,
    description: '',
    promo_code: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    rules: [] as Array<{ rule_type: string; rule_value: string }>,
  });

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const ruleTypes = [
    { value: 'MIN_PURCHASE', label: 'Minimum Pembelian (Rp)' },
    { value: 'MAX_DISCOUNT', label: 'Maksimal Diskon (Rp)' },
    { value: 'CATEGORY', label: 'Kategori Produk' },
    { value: 'MEMBER_ONLY', label: 'Khusus Member' },
    { value: 'HAPPY_HOUR', label: 'Jam Berlaku (Happy Hour)' },
  ];

  const handleAddRule = () => {
    setFormData((prev) => ({
      ...prev,
      rules: [...prev.rules, { rule_type: '', rule_value: '' }],
    }));
  };

  const handleRemoveRule = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      rules: prev.rules.filter((_, i) => i !== index),
    }));
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!formData.promo_name.trim()) {
      setError('Nama promosi wajib diisi.');
      return;
    }

    setSubmitting(true);
    // PERBAIKAN (merge notes): versi asli hanya menampilkan pesan sukses
    // palsu tanpa benar-benar menyimpan apa pun (TODO belum dikerjakan).
    // Sekarang benar-benar memanggil createPromotion (Server Action).
    const res = await createPromotion({
      promo_name: formData.promo_name,
      promo_type: formData.promo_type,
      description: formData.description || undefined,
      promo_code: formData.promo_code || undefined,
      start_date: formData.start_date,
      end_date: formData.end_date || undefined,
      rules: formData.rules.filter((r) => r.rule_type && r.rule_value),
    });
    setSubmitting(false);

    if (res.error) {
      setError(res.error);
      return;
    }
    setSuccess('Promosi berhasil dibuat!');
    setTimeout(() => onClose(), 1200);
  };

  if (!isOpen) return null;

  return (
    <Modal
      title="Buat Promosi Baru"
      onClose={onClose}
      maxWidth="sm:max-w-2xl"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-neutral-300 text-sm font-semibold"
          >
            Batal
          </button>
          <button
            type="submit"
            form="promotion-builder-form"
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold"
          >
            {submitting ? 'Menyimpan...' : 'Simpan Promosi'}
          </button>
        </div>
      }
    >
      <div>
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm mb-4">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm mb-4">
            {success}
          </div>
        )}

        <form id="promotion-builder-form" onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div>
            <label className="block text-sm font-medium mb-2">Nama Promosi *</label>
            <input
              type="text"
              required
              value={formData.promo_name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, promo_name: e.target.value }))
              }
              className="input-field"
              placeholder="Misalnya: Diskon Kopi Hari Jumat"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Tipe Promosi *</label>
              <select
                value={formData.promo_type}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    promo_type: e.target.value as any,
                  }))
                }
                className="input-field"
              >
                <option value="PERCENTAGE">Diskon Persentase (%)</option>
                <option value="NOMINAL">Diskon Nominal (Rp)</option>
                <option value="BOGO">Buy 1 Get 1 (BOGO)</option>
                <option value="BUNDLE">Paket/Bundle</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {formData.promo_type === 'PERCENTAGE' ? 'Diskon (%)' : 'Diskon (Rp)'}
              </label>
              <input
                type="number"
                required
                min="0"
                value={formData.discount_value}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    discount_value: parseFloat(e.target.value),
                  }))
                }
                className="input-field"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Deskripsi</label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
              rows={3}
              className="input-field"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Kode Promo (Optional)</label>
              <input
                type="text"
                value={formData.promo_code}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, promo_code: e.target.value }))
                }
                className="input-field"
                placeholder="PROMO2026"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Tanggal Mulai *</label>
              <input
                type="date"
                required
                value={formData.start_date}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, start_date: e.target.value }))
                }
                className="input-field"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Tanggal Berakhir</label>
            <input
              type="date"
              value={formData.end_date}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, end_date: e.target.value }))
              }
              className="input-field"
            />
          </div>

          {/* Rules */}
          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Aturan Promosi (Optional)</h3>
              <button
                type="button"
                onClick={handleAddRule}
                className="text-blue-600 hover:underline text-sm"
              >
                + Tambah Aturan
              </button>
            </div>

            {formData.rules.map((rule, idx) => (
              <div key={idx} className="flex gap-2 mb-3">
                <select
                  value={rule.rule_type}
                  onChange={(e) => {
                    const newRules = [...formData.rules];
                    newRules[idx].rule_type = e.target.value;
                    setFormData((prev) => ({ ...prev, rules: newRules }));
                  }}
                  className="input-field"
                >
                  <option value="">-- Pilih Tipe Aturan --</option>
                  {ruleTypes.map((rt) => (
                    <option key={rt.value} value={rt.value}>
                      {rt.label}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  placeholder="Nilai aturan..."
                  value={rule.rule_value}
                  onChange={(e) => {
                    const newRules = [...formData.rules];
                    newRules[idx].rule_value = e.target.value;
                    setFormData((prev) => ({ ...prev, rules: newRules }));
                  }}
                  className="input-field"
                />

                <button
                  type="button"
                  onClick={() => handleRemoveRule(idx)}
                  className="px-3 py-2 text-red-600 hover:bg-red-50 rounded"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </form>
      </div>
    </Modal>
  );
}
