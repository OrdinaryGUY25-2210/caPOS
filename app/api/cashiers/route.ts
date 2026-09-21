import { NextResponse } from "next/server";

/**
 * DEPRECATED (evaluasi audit) — endpoint ini sebelumnya dipakai untuk
 * membuat/menghapus akun kasir, tapi sejak migration_16 (Manajemen
 * Karyawan terpusat), /dashboard/cashiers sudah diubah jadi HALAMAN
 * MONITORING SAJA (lihat catatan di components/DashboardSidebar.tsx) —
 * satu-satunya jalur resmi untuk membuat/menghapus akun karyawan sekarang
 * adalah /api/employees (dipakai oleh /dashboard/employees).
 *
 * Route ini tidak lagi dipanggil dari UI mana pun (sudah dicek: tidak ada
 * `fetch("/api/cashiers"` di app/dashboard/cashiers/page.tsx atau file
 * lain), tapi filenya masih ada dan masih bisa diakses siapa pun yang
 * tahu URL-nya — permukaan serangan yang tidak perlu, dan pesan error-nya
 * dulu menyesatkan (mengklaim ON DELETE CASCADE padahal transactions/
 * shifts.cashier_id TIDAK cascade, lihat evaluasi bug sebelumnya).
 *
 * Dibiarkan sebagai file (bukan dihapus langsung) supaya build tidak
 * gagal kalau ternyata masih ada referensi yang belum ketemu saat
 * evaluasi ini — tapi aman DIHAPUS SEPENUHNYA kalau kamu sudah yakin
 * tidak dipakai di mana pun (rekomendasi: hapus filenya di commit
 * berikutnya setelah dipastikan aman).
 */
function gone() {
  return NextResponse.json(
    { message: "Endpoint ini sudah tidak dipakai. Gunakan /dashboard/employees untuk mengelola akun karyawan." },
    { status: 410 }
  );
}

export async function POST() {
  return gone();
}

export async function DELETE() {
  return gone();
}
