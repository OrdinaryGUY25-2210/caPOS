import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerProfile } from "@/lib/getServerProfile";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { createMidtransCoreApi, POS_QRIS_ORDER_PREFIX } from "@/lib/midtransCore";

/**
 * Dipanggil dari app/pos/page.tsx (generateDynamicQris()) saat kasir
 * menekan "Buat Kode QRIS Dinamis". File ini SEBELUMNYA TIDAK ADA SAMA
 * SEKALI — tombolnya sudah lama ada di UI (dan app/api/pos/qris-status
 * yang MEMBACA hasilnya juga sudah ada), tapi endpoint yang membuat
 * kodenya sendiri belum pernah dibuat, jadi tombol itu pasti gagal
 * dengan 404 kalau diklik. Dibuat sekarang sebagai bagian dari
 * migration_022 (lihat catatan di file migrasi itu).
 *
 * Beda dari app/api/orders/qris-charge (dipakai pelanggan di
 * /order/[branch]/[table]): endpoint itu memakai MIDTRANS_SERVER_KEY
 * PLATFORM (env var caPOS sendiri). Endpoint ini SELALU memakai
 * `branches.midtrans_server_key` milik CABANG kasir yang login (BYOK) —
 * sesuai desain lib/midtransCore.ts & webhook notifikasi yang sudah ada,
 * dan sesuai PRD (owner mengisi Server/Client Key sendiri di
 * /dashboard/settings/payment).
 */
function serviceClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(request: Request) {
  const limited = rateLimitOrNull(request, "pos-qris-charge", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const { profile } = await getServerProfile();
  if (!profile) {
    return NextResponse.json({ message: "Anda harus login." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const branchId = body?.branch_id;
  const grossAmount = Number(body?.gross_amount);

  if (!branchId || !Number.isFinite(grossAmount) || grossAmount <= 0) {
    return NextResponse.json({ message: "branch_id dan gross_amount (angka > 0) wajib diisi." }, { status: 400 });
  }

  // Kasir/manager hanya boleh membuat QRIS untuk cabang penugasannya
  // sendiri; owner/super_admin boleh untuk cabang mana pun DI TENANT
  // YANG SAMA (tidak boleh lintas tenant meski dia owner tenant lain).
  const isOwnerLike = profile.role === "owner" || profile.role === "super_admin";
  if (!isOwnerLike && profile.branch_id !== branchId) {
    return NextResponse.json({ message: "Anda tidak bertugas di cabang ini." }, { status: 403 });
  }

  const svc = serviceClient();

  const { data: branch } = await svc
    .from("branches")
    .select("id, tenant_id, midtrans_server_key, midtrans_is_production, qris_mode")
    .eq("id", branchId)
    .single();

  if (!branch || branch.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ message: "Cabang tidak ditemukan." }, { status: 404 });
  }
  if (!branch.midtrans_server_key) {
    return NextResponse.json(
      { message: "Cabang ini belum dikonfigurasi untuk QRIS Dinamis. Atur di Pengaturan > Metode Pembayaran." },
      { status: 400 }
    );
  }
  if (branch.qris_mode !== "DYNAMIC") {
    return NextResponse.json(
      { message: "Cabang ini sedang memakai mode QRIS Statis, bukan Dinamis. Ubah dulu di Pengaturan > Metode Pembayaran." },
      { status: 400 }
    );
  }

  const orderId = `${POS_QRIS_ORDER_PREFIX}${crypto.randomUUID()}`;
  const core = createMidtransCoreApi({
    serverKey: branch.midtrans_server_key,
    isProduction: !!branch.midtrans_is_production,
  });

  const charge = await core.chargeQris({ orderId, grossAmount });

  if (!charge.ok || !charge.qrUrl) {
    console.error("Midtrans QRIS charge (POS) gagal:", charge.raw);
    return NextResponse.json({ message: "Gagal membuat kode QRIS. Silakan coba lagi atau pakai metode lain." }, { status: 502 });
  }

  const { error: insertError } = await svc.from("pos_qris_payments").insert({
    tenant_id: branch.tenant_id,
    branch_id: branch.id,
    order_id: orderId,
    gross_amount: grossAmount,
    status: "pending",
    raw_response: charge.raw,
  });

  if (insertError) {
    console.error("Gagal menyimpan pos_qris_payments:", insertError.message);
    return NextResponse.json({ message: "Kode QRIS dibuat tapi gagal disimpan. Coba lagi." }, { status: 500 });
  }

  return NextResponse.json({ order_id: orderId, qr_url: charge.qrUrl });
}
