import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Pindah 1 order dine-in aktif ke meja lain. Membungkus RPC
 * `move_table_order` (migration_015) supaya kasir/manager punya jalur
 * HTTP standar (dipakai TableStatusBoard.tsx / OpenBillPanel.tsx) selain
 * pemanggilan RPC langsung dari client. Memakai server client berbasis
 * cookie session (bukan service role) — RLS & pengecekan tenant/cabang
 * tetap ditegakkan penuh oleh `move_table_order` sendiri, endpoint ini
 * TIDAK menambah hak akses apa pun di atas yang sudah dimiliki user
 * yang login.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const orderId = body?.order_id as string | undefined;
  const newTableId = body?.new_table_id as string | undefined;
  const reason = (body?.reason as string | undefined) ?? null;

  if (!orderId || !newTableId) {
    return NextResponse.json({ message: "order_id dan new_table_id wajib diisi." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: "Sesi tidak valid, silakan login ulang." }, { status: 401 });
  }

  const { error } = await supabase.rpc("move_table_order", {
    p_order_id: orderId,
    p_new_table_id: newTableId,
    p_reason: reason,
  });

  if (error) {
    const status = error.message.includes("TABLE_OCCUPIED") || error.message.includes("TABLE_CLEANING") ? 409 : 400;
    return NextResponse.json({ message: error.message }, { status });
  }

  return NextResponse.json({ ok: true });
}
