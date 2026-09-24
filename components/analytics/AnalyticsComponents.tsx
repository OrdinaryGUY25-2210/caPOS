'use client';

import React, { useState, useEffect } from 'react';
import {
  getProductProfitability,
  getPeakHoursAnalytics,
  getWasteLossReport,
  recordWasteLoss,
} from '@/app/actions/purchasing-loyalty-actions';

// =========================================================
// PRODUCT PROFITABILITY ANALYTICS
// =========================================================

export function ProductProfitabilityAnalytics() {
  const [profitData, setProfitData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'profit' | 'revenue' | 'margin'>('profit');

  useEffect(() => {
    loadProfitabilityData();
  }, [sortBy]);

  const loadProfitabilityData = async () => {
    setIsLoading(true);
    const result = await getProductProfitability(undefined, 20);
    if (!result.error) {
      let data = result.data || [];
      // Sort based on selected option
      switch (sortBy) {
        case 'revenue':
          data = [...data].sort((a, b) => b.total_revenue - a.total_revenue);
          break;
        case 'margin':
          data = [...data].sort((a, b) => b.profit_margin_pct - a.profit_margin_pct);
          break;
        default:
          data = [...data].sort((a, b) => b.gross_profit - a.gross_profit);
      }
      setProfitData(data);
    }
    setIsLoading(false);
  };

  const totalRevenue = profitData.reduce((sum, item) => sum + (item.total_revenue || 0), 0);
  const totalCOGS = profitData.reduce((sum, item) => sum + (item.total_cogs || 0), 0);
  const totalGrossProfit = profitData.reduce((sum, item) => sum + (item.gross_profit || 0), 0);
  const avgProfitMargin =
    totalRevenue > 0 ? ((totalGrossProfit / totalRevenue) * 100).toFixed(2) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Profitabilitas Produk</h2>
          <p className="text-gray-600 mt-1">Analisis mendalam per menu item</p>
        </div>
        <div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-4 py-2 border border-gray-300 rounded-lg"
          >
            <option value="profit">Urutkan: Profit Terbesar</option>
            <option value="revenue">Urutkan: Revenue Terbesar</option>
            <option value="margin">Urutkan: Margin Terbesar</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-6 shadow">
          <div className="text-sm text-gray-600">Total Revenue</div>
          <div className="text-2xl font-bold mt-2">
            Rp {totalRevenue.toLocaleString('id-ID')}
          </div>
          <div className="text-xs text-gray-500 mt-1">{profitData.length} produk</div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow">
          <div className="text-sm text-gray-600">Total HPP (COGS)</div>
          <div className="text-2xl font-bold mt-2">
            Rp {totalCOGS.toLocaleString('id-ID')}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {((totalCOGS / totalRevenue) * 100).toFixed(1)}% dari revenue
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow">
          <div className="text-sm text-gray-600">Gross Profit</div>
          <div className="text-2xl font-bold text-green-600 mt-2">
            Rp {totalGrossProfit.toLocaleString('id-ID')}
          </div>
          <div className="text-xs text-gray-500 mt-1">Laba kotor</div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow">
          <div className="text-sm text-gray-600">Avg Margin</div>
          <div className="text-2xl font-bold text-blue-600 mt-2">{avgProfitMargin}%</div>
          <div className="text-xs text-gray-500 mt-1">Rata-rata margin</div>
        </div>
      </div>

      {/* Profitability Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Memuat data...</div>
        ) : profitData.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Belum ada data penjualan</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Produk</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold">Terjual (pcs)</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold">Revenue</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold">HPP</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold">Profit</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold">Margin</th>
                </tr>
              </thead>
              <tbody>
                {profitData.map((item) => (
                  <tr key={item.id} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <div className="font-semibold">{item.product_name}</div>
                      <div className="text-xs text-gray-600">{item.category_name}</div>
                    </td>
                    <td className="px-6 py-3 text-center">{item.total_qty_sold}</td>
                    <td className="px-6 py-3 text-right">
                      Rp {item.total_revenue?.toLocaleString('id-ID')}
                    </td>
                    <td className="px-6 py-3 text-right">
                      Rp {item.total_cogs?.toLocaleString('id-ID')}
                    </td>
                    <td className="px-6 py-3 text-right font-semibold text-green-600">
                      Rp {item.gross_profit?.toLocaleString('id-ID')}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold">
                        {item.profit_margin_pct?.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================
// PEAK HOURS ANALYTICS
// =========================================================

export function PeakHoursAnalytics() {
  const [peakData, setPeakData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadPeakHoursData();
  }, []);

  const loadPeakHoursData = async () => {
    setIsLoading(true);
    const result = await getPeakHoursAnalytics();
    if (!result.error) {
      setPeakData(result.data || []);
    }
    setIsLoading(false);
  };

  const maxTransactions = Math.max(...(peakData.map((d) => d.transaction_count) || [0]));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Analisis Jam Sibuk (Peak Hours)</h2>
        <p className="text-gray-600 mt-1">Distribusi transaksi per jam dalam 30 hari terakhir</p>
      </div>

      {/* Heatmap Visualization */}
      <div className="bg-white rounded-lg p-6 shadow">
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Memuat data...</div>
          ) : peakData.length === 0 ? (
            <div className="text-center py-8 text-gray-500">Belum ada data transaksi</div>
          ) : (
            <>
              {Array.from({ length: 24 }, (_, i) => {
                const hourData = peakData.find((d) => d.hour_of_day === i);
                const txCount = hourData?.transaction_count || 0;
                const percentage = maxTransactions > 0 ? (txCount / maxTransactions) * 100 : 0;

                return (
                  <div key={i} className="flex items-center gap-4">
                    <div className="w-12 font-mono text-sm font-semibold text-right">
                      {String(i).padStart(2, '0')}:00
                    </div>

                    <div className="flex-1">
                      <div
                        className="bg-gradient-to-r from-blue-400 to-blue-600 rounded-lg h-8 flex items-center px-3 text-white font-semibold text-sm transition-all"
                        style={{
                          width: `${Math.max(percentage, 5)}%`,
                          opacity: 0.7 + (percentage / 100) * 0.3,
                        }}
                      >
                        {txCount > 0 && txCount}
                      </div>
                    </div>

                    <div className="w-24 text-right">
                      <div className="text-sm font-semibold">{txCount} transaksi</div>
                      {hourData && (
                        <div className="text-xs text-gray-600">
                          Rp {hourData.total_revenue?.toLocaleString('id-ID')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Peak Hours Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(() => {
          const sortedByTx = [...peakData].sort((a, b) => b.transaction_count - a.transaction_count);
          const sortedByRevenue = [...peakData].sort((a, b) => b.total_revenue - a.total_revenue);

          return (
            <>
              <div className="bg-white rounded-lg p-6 shadow">
                <div className="text-sm text-gray-600">Jam Puncak (Transaksi)</div>
                {sortedByTx.length > 0 && (
                  <div className="mt-2">
                    <div className="text-2xl font-bold">
                      {String(sortedByTx[0].hour_of_day).padStart(2, '0')}:00
                    </div>
                    <div className="text-sm text-gray-600">
                      {sortedByTx[0].transaction_count} transaksi
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-lg p-6 shadow">
                <div className="text-sm text-gray-600">Jam Puncak (Revenue)</div>
                {sortedByRevenue.length > 0 && (
                  <div className="mt-2">
                    <div className="text-2xl font-bold">
                      {String(sortedByRevenue[0].hour_of_day).padStart(2, '0')}:00
                    </div>
                    <div className="text-sm text-gray-600">
                      Rp {sortedByRevenue[0].total_revenue?.toLocaleString('id-ID')}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-lg p-6 shadow">
                <div className="text-sm text-gray-600">Total Jam Aktif</div>
                <div className="mt-2">
                  <div className="text-2xl font-bold">{peakData.length} jam</div>
                  <div className="text-sm text-gray-600">Dengan penjualan</div>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Insights */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="font-semibold text-blue-900 mb-2">💡 Insights</div>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Identifikasi jam sibuk untuk perencanaan staf dan persediaan</li>
          <li>• Persiapkan barista/chef dengan jumlah lebih saat peak hours</li>
          <li>• Optimalkan menu dan promosi berdasarkan preferensi per jam</li>
        </ul>
      </div>
    </div>
  );
}

// =========================================================
// WASTE LOSS REPORT
// =========================================================

export function WasteLossReport() {
  const [wasteLogs, setWasteLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    product_id: '',
    product_name: '',
    waste_type: 'EXPIRED' as const,
    qty_wasted: 0,
    cost_price: 0,
    notes: '',
  });

  useEffect(() => {
    loadWasteLogs();
  }, []);

  const loadWasteLogs = async () => {
    setIsLoading(true);
    const result = await getWasteLossReport(undefined, 30);
    if (!result.error) {
      setWasteLogs(result.data?.items || []);
    }
    setIsLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const result = await recordWasteLoss(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setShowForm(false);
        loadWasteLogs();
        setFormData({
          product_id: '',
          product_name: '',
          waste_type: 'EXPIRED',
          qty_wasted: 0,
          cost_price: 0,
          notes: '',
        });
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const totalLoss = wasteLogs.reduce((sum, item) => sum + (item.total_loss_amount || 0), 0);
  const byType = wasteLogs.reduce(
    (acc, item) => {
      acc[item.waste_type] = (acc[item.waste_type] || 0) + item.total_loss_amount;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Laporan Kerugian (Waste Loss)</h2>
          <p className="text-gray-600 mt-1">Tracking kerugian dari barang kadaluarsa/rusak</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          + Catat Kerugian
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-red-50 rounded-lg p-6 border border-red-200">
          <div className="text-sm text-red-600 font-medium">Total Kerugian (30 hari)</div>
          <div className="text-3xl font-bold text-red-700 mt-2">
            Rp {totalLoss.toLocaleString('id-ID')}
          </div>
          <div className="text-xs text-red-600 mt-1">{wasteLogs.length} item</div>
        </div>

        {Object.entries(byType).map(([type, amount]) => (
          <div key={type} className="bg-white rounded-lg p-6 shadow">
            <div className="text-sm text-gray-600">{type}</div>
            <div className="text-2xl font-bold mt-2 text-red-600">
              Rp {(amount as number).toLocaleString('id-ID')}
            </div>
          </div>
        ))}
      </div>

      {/* Waste Logs Table */}
      <div className="bg-white rounded-lg shadow">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Memuat data...</div>
        ) : wasteLogs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Belum ada pencatatan kerugian</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold">Produk</th>
                  <th className="px-6 py-3 text-center font-semibold">Jenis</th>
                  <th className="px-6 py-3 text-center font-semibold">Qty</th>
                  <th className="px-6 py-3 text-right font-semibold">Harga Satuan</th>
                  <th className="px-6 py-3 text-right font-semibold">Total Rugi</th>
                  <th className="px-6 py-3 text-left font-semibold">Catatan</th>
                  <th className="px-6 py-3 text-left font-semibold">Tanggal</th>
                </tr>
              </thead>
              <tbody>
                {wasteLogs.map((log) => (
                  <tr key={log.id} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-3 font-semibold">{log.product_name}</td>
                    <td className="px-6 py-3 text-center">
                      <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs">
                        {log.waste_type}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-center">{log.qty_wasted}</td>
                    <td className="px-6 py-3 text-right">
                      Rp {log.cost_price?.toLocaleString('id-ID')}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-red-600">
                      Rp {log.total_loss_amount?.toLocaleString('id-ID')}
                    </td>
                    <td className="px-6 py-3 text-xs text-gray-600">{log.notes}</td>
                    <td className="px-6 py-3 text-xs">
                      {new Date(log.created_at).toLocaleDateString('id-ID')}
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold mb-4">Catat Kerugian Barang</h2>

            {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm mb-4">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Nama Produk *</label>
                <input
                  type="text"
                  required
                  value={formData.product_name}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      product_name: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Jenis Kerugian *</label>
                <select
                  value={formData.waste_type}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      waste_type: e.target.value as any,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="EXPIRED">Kadaluarsa</option>
                  <option value="DAMAGED">Rusak</option>
                  <option value="SPOILED">Basi</option>
                  <option value="LOSS">Hilang/Lainnya</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-2">Qty *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={formData.qty_wasted || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        qty_wasted: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Harga Satuan *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={formData.cost_price || ''}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        cost_price: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Catatan</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      notes: e.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Simpan
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
