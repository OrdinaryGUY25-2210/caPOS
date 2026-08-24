import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { PLANS } from "@/lib/midtransPlans";

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ message: "Anda harus login." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();

  // Hanya owner/super_admin tenant yang boleh membeli langganan — bukan kasir.
  if (!profile || (profile.role !== "owner" && profile.role !== "super_admin")) {
    return NextResponse.json({ message: "Tidak punya izin." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const planKey = body.plan as keyof typeof PLANS;
  const plan = PLANS[planKey];

  if (!plan) {
    return NextResponse.json({ message: "Paket tidak valid." }, { status: 400 });
  }

  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    return NextResponse.json(
      { message: "Midtrans belum dikonfigurasi (MIDTRANS_SERVER_KEY kosong)." },
      { status: 500 }
    );
  }

  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
  const baseUrl = isProduction
    ? "https://app.midtrans.com"
    : "https://app.sandbox.midtrans.com";

  // order_id harus unik per transaksi — dipakai lagi oleh webhook untuk
  // mencocokkan notifikasi pembayaran ke baris `payments` yang benar.
  const orderId = `CAPOS-${profile.tenant_id.slice(0, 8)}-${Date.now()}`;

  const midtransRes = await fetch(`${baseUrl}/snap/v1/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // Basic Auth Midtrans: server key sebagai username, password kosong.
      Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`,
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: orderId,
        gross_amount: plan.amount,
      },
      customer_details: {
        email: user.email,
      },
      item_details: [
        {
          id: planKey,
          price: plan.amount,
          quantity: 1,
          name: `caPOS Langganan ${plan.label}`,
        },
      ],
    }),
  });

  const midtransData = await midtransRes.json();

  if (!midtransRes.ok || !midtransData.token) {
    console.error("Midtrans create transaction failed:", midtransData);
    return NextResponse.json(
      { message: "Gagal membuat transaksi pembayaran. Coba lagi." },
      { status: 502 }
    );
  }

  // Simpan sebagai 'pending' — service role dipakai karena user biasa
  // tidak diizinkan INSERT langsung ke payments (lihat RLS di schema.sql).
  const svc = serviceClient();
  const { error: insertError } = await svc.from("payments").insert({
    tenant_id: profile.tenant_id,
    order_id: orderId,
    plan: planKey,
    amount: plan.amount,
    status: "pending",
  });

  if (insertError) {
    console.error("Failed to record pending payment:", insertError);
  }

  return NextResponse.json({ token: midtransData.token, orderId });
}
