import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Gabungkan 2 order dine-in aktif jadi 1 tagihan (mis. 2 meja digabung
 * jadi 1 rombongan). Membungkus RPC `merge_table_orders` (migration_019)
 * — lihat komentar di sana untuk detail perilaku (order_items sumber
 * dipindah ke order tujuan, order sumber dibatalkan, meja sumber
 * dibebaskan). Order tujuan yang TETAP dipakai untuk pembayaran.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const sourceOrderId = body?.source_order_id as string | undefined;
  const targetOrderId = body?.target_order_id as string | undefined;
  const reason = (body?.reason as string | undefined) ?? null;

  if (!sourceOrderId || !targetOrderId) {
    return NextResponse.json({ message: "source_order_id dan target_order_id wajib diisi." }, { status: 400 });
  }
  if (sourceOrderId === targetOrderId) {
    return NextResponse.json({ message: "Meja sumber dan tujuan tidak boleh sama." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: "Sesi tidak valid, silakan login ulang." }, { status: 401 });
  }

  const { error } = await supabase.rpc("merge_table_orders", {
    p_source_order_id: sourceOrderId,
    p_target_order_id: targetOrderId,
    p_reason: reason,
  });

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
