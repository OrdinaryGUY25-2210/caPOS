"use client";

import { useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Download, Printer, TrendingUp } from "lucide-react";
import { formatRupiah } from "@/lib/utils";

const OMZET_DATA = [
  { day: "Sen", omzet: 1250000 },
  { day: "Sel", omzet: 1480000 },
  { day: "Rab", omzet: 980000 },
  { day: "Kam", omzet: 1620000 },
  { day: "Jum", omzet: 2100000 },
  { day: "Sab", omzet: 2850000 },
  { day: "Min", omzet: 2400000 },
];

const PEAK_HOURS = [
  { hour: "08:00", orders: 4 }, { hour: "10:00", orders: 9 }, { hour: "12:00", orders: 22 },
  { hour: "14:00", orders: 15 }, { hour: "16:00", orders: 18 }, { hour: "18:00", orders: 28 },
  { hour: "20:00", orders: 20 }, { hour: "22:00", orders: 8 },
];

const BEST_SELLER = [
  { name: "Kopi Susu Gula Aren", value: 142 },
  { name: "Cappuccino", value: 98 },
  { name: "Nasi Goreng Kafe", value: 76 },
  { name: "Matcha Latte", value: 54 },
  { name: "Lainnya", value: 60 },
];
const PIE_COLORS = ["#10B981", "#059669", "#34D399", "#6EE7B7", "#94A3B8"];

export default function ReportsPage() {
  const [chartModel, setChartModel] = useState<"bar" | "line">("bar");
  const totalOmzet = OMZET_DATA.reduce((s, d) => s + d.omzet, 0);
  const totalOrders = PEAK_HOURS.reduce((s, d) => s + d.orders, 0);

  function exportExcel() {
    // UTF-8 BOM prefix ensures Excel renders "Rp" and Indonesian characters correctly
    const header = "Hari,Omzet\n";
    const rows = OMZET_DATA.map((d) => `${d.day},${d.omzet}`).join("\n");
    const csv = "\uFEFF" + header + rows;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "laporan-omzet-capos.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Laporan & Omzet</h1>
          <p className="text-sm text-neutral-500">Ringkasan performa penjualan kafe Anda</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className="input-field w-auto text-sm" defaultValue="2026-08-15" />
          <span className="text-neutral-400 text-sm">—</span>
          <input type="date" className="input-field w-auto text-sm" defaultValue="2026-08-21" />
          <button onClick={exportExcel} className="btn-outline flex items-center gap-1.5 text-sm">
            <Download size={14} /> Excel
          </button>
          <button onClick={() => window.print()} className="btn-outline flex items-center gap-1.5 text-sm">
            <Printer size={14} /> PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Total Omzet (7 hari)</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{formatRupiah(totalOmzet)}</p>
          <span className="badge-active mt-2"><TrendingUp size={12} /> +12.4%</span>
        </div>
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Total Transaksi</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{totalOrders}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-neutral-500">Rata-rata / Transaksi</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{formatRupiah(Math.round(totalOmzet / totalOrders))}</p>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-neutral-900">Grafik Omzet Harian</h2>
          <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
            <button
              onClick={() => setChartModel("bar")}
              className={chartModel === "bar" ? "px-3 py-1 rounded-md bg-white shadow-sm text-sm font-medium" : "px-3 py-1 text-sm text-neutral-500"}
            >
              Bar
            </button>
            <button
              onClick={() => setChartModel("line")}
              className={chartModel === "line" ? "px-3 py-1 rounded-md bg-white shadow-sm text-sm font-medium" : "px-3 py-1 text-sm text-neutral-500"}
            >
              Garis
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          {chartModel === "bar" ? (
            <BarChart data={OMZET_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" stroke="#64748B" fontSize={12} />
              <YAxis stroke="#64748B" fontSize={12} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip formatter={(v: number) => formatRupiah(v)} />
              <Bar dataKey="omzet" fill="#10B981" radius={[6, 6, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={OMZET_DATA}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" stroke="#64748B" fontSize={12} />
              <YAxis stroke="#64748B" fontSize={12} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip formatter={(v: number) => formatRupiah(v)} />
              <Line type="monotone" dataKey="omzet" stroke="#10B981" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-semibold text-neutral-900 mb-4">Jam Ramai (Peak Hours)</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={PEAK_HOURS}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="hour" stroke="#64748B" fontSize={11} />
              <YAxis stroke="#64748B" fontSize={12} />
              <Tooltip />
              <Line type="monotone" dataKey="orders" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-neutral-900 mb-4">Menu Terlaris</h2>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={BEST_SELLER} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {BEST_SELLER.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
