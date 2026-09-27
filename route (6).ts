import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerProfile } from "@/lib/getServerProfile";

/**
 * PRD §4A/§4C — dipakai oleh /dashboard/settings/payment.
 *
 * Kenapa lewat API route, bukan langsung `supabase.from("branches")` dari
 * client seperti halaman-halaman settings lain (business, payment,
 * receipt)? Karena migration_022 SENGAJA mencabut GRANT SELECT kolom
 * `midtrans_server_key` dari authenticated — kalau halaman langsung
 * SELECT * FROM branches, kolom itu akan selalu kosong/error, dan yang
 * lebih penting: kalaupun kolom lain yang dibaca (bukan server_key),
 * client TETAP tidak boleh pernah menerima nilai server_key yang
 * sesungguhnya meski GRANT dibuka — API route ini yang jadi satu-satunya
 * jalur, dan sengaja HANYA mengirim `has_server_key` (boolean), tidak
 * pernah nilai aslinya, ke browser sama sekali.
 */

function serviceClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function authorize(branchId: string) {
  const { profile } = await getServerProfile();
  if (!profile) return { error: NextResponse.json({ message: "Anda harus login." }, { status: 401 }) };

  const isOwnerLike = profile.role === "owner" || profile.role === "manager" || profile.role === "super_admin";
  if (!isOwnerLike) {
    return { error: NextResponse.json({ message: "Hanya Owner/Supervisor yang boleh mengubah pengaturan ini." }, { status: 403 }) };
  }

  const svc = serviceClient();
  const { data: branch } = await svc.from("branches").select("id, tenant_id").eq("id", branchId).single();
  if (!branch || branch.tenant_id !== profile.tenant_id) {
    return { error: NextResponse.json({ message: "Cabang tidak ditemukan." }, { status: 404 }) };
  }
  return { profile, svc, branch };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if (auth.error) return auth.error;

  const { data, error } = await auth.svc
    .from("branches")
    .select(
      "qris_mode, midtrans_client_key, midtrans_is_production, static_qris_image_url, sound_enabled, sound_tone, sound_volume, midtrans_server_key"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ message: "Gagal memuat pengaturan." }, { status: 500 });
  }

  // has_server_key TERPISAH dari nilai aslinya — midtrans_server_key
  // dibaca di atas (service role, bypass RLS/grant) HANYA untuk dicek
  // ada/tidaknya, lalu langsung dibuang, tidak pernah ikut di-return.
  const { midtrans_server_key, ...safe } = data;
  return NextResponse.json({ ...safe, has_server_key: !!midtrans_server_key });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ message: "Body request tidak valid." }, { status: 400 });

  const update: Record<string, unknown> = {};

  if (body.qris_mode !== undefined) {
    if (body.qris_mode !== "DYNAMIC" && body.qris_mode !== "STATIC") {
      return NextResponse.json({ message: "qris_mode harus DYNAMIC atau STATIC." }, { status: 400 });
    }
    update.qris_mode = body.qris_mode;
  }
  if (body.midtrans_client_key !== undefined) update.midtrans_client_key = body.midtrans_client_key || null;
  if (body.midtrans_is_production !== undefined) update.midtrans_is_production = !!body.midtrans_is_production;
  if (body.static_qris_image_url !== undefined) update.static_qris_image_url = body.static_qris_image_url || null;
  if (body.sound_enabled !== undefined) update.sound_enabled = !!body.sound_enabled;
  if (body.sound_tone !== undefined) update.sound_tone = String(body.sound_tone);
  if (body.sound_volume !== undefined) {
    const vol = Number(body.sound_volume);
    if (!Number.isFinite(vol) || vol < 0 || vol > 1) {
      return NextResponse.json({ message: "sound_volume harus angka 0-1." }, { status: 400 });
    }
    update.sound_volume = vol;
  }

  // Pola "kosongkan untuk tetap pakai yang lama": field ini HANYA ditulis
  // kalau dikirim berisi string non-kosong. Form di client selalu
  // mengirim input kosong (bukan nilai asli — nilai asli memang tidak
  // pernah dikirim balik ke client sama sekali, lihat GET di atas), jadi
  // "tidak diubah" berarti field-nya kosong saat submit, BUKAN berarti
  // ada nilai lama yang sengaja dikirim ulang.
  if (typeof body.midtrans_server_key === "string" && body.midtrans_server_key.trim() !== "") {
    update.midtrans_server_key = body.midtrans_server_key.trim();
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ message: "Tidak ada perubahan." }, { status: 400 });
  }

  const { error } = await auth.svc!.from("branches").update(update).eq("id", id);
  if (error) {
    return NextResponse.json({ message: "Gagal menyimpan: " + error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
