import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * DELETE /api/account — "Hapus Akun" milik Owner.
 *
 * Beda dengan DELETE /api/employees (yang cuma hapus 1 auth user karyawan),
 * ini menghapus SELURUH tenant: kafe, semua karyawan, menu, transaksi,
 * cabang, stok, membership, dst — sekaligus akun login Owner itu sendiri.
 * Dipakai kalau Owner benar-benar ingin berhenti pakai caPOS, bukan cuma
 * nonaktifkan langganan.
 */
export async function DELETE() {
  const server = createServerClient();
  const {
    data: { user },
  } = await (await server).auth.getUser();

  if (!user) {
    return NextResponse.json({ message: "Anda harus login untuk menghapus akun." }, { status: 401 });
  }

  const supabase = serviceClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  // Hanya Owner (pemilik tenant) yang boleh menghapus seluruh akun kafe —
  // manager/kasir tidak berhak melenyapkan data milik orang lain.
  if (!profile || profile.role !== "owner") {
    return NextResponse.json(
      { message: "Hanya Owner yang boleh menghapus akun kafe." },
      { status: 403 }
    );
  }

  const tenantId = profile.tenant_id;

  // 1. Kumpulkan dulu SEMUA id auth user yang terikat ke tenant ini (Owner +
  // seluruh karyawan). Ini wajib diambil SEBELUM tenant dihapus, karena
  // baris `profiles` (dan referensinya ke id ini) akan ikut lenyap lewat
  // cascade begitu tenant dihapus di langkah 2.
  const { data: memberProfiles, error: fetchError } = await supabase
    .from("profiles")
    .select("id")
    .eq("tenant_id", tenantId);

  if (fetchError) {
    return NextResponse.json({ message: "Gagal mengambil data akun terkait." }, { status: 500 });
  }

  const authUserIds = (memberProfiles ?? []).map((p) => p.id);

  // 2. Hapus baris tenant. Setiap tabel data (subscriptions, referrals,
  // referral_redemptions, profiles, products, memberships, shifts,
  // attendance, approval_requests, transactions -> transaction_items,
  // payments, stock_movements, monthly_targets, branches -> branch_stock,
  // stock_opname_logs) sudah didefinisikan dengan
  // `tenant_id ... REFERENCES tenants(id) ON DELETE CASCADE` di
  // schema.sql/migrations, jadi satu DELETE ini otomatis membersihkan
  // SEMUA data terkait sekaligus — tidak ada data yang nyangkut.
  const { error: tenantDeleteError } = await supabase.from("tenants").delete().eq("id", tenantId);

  if (tenantDeleteError) {
    console.error("tenant delete failed", tenantDeleteError);
    return NextResponse.json({ message: "Gagal menghapus data kafe. Silakan coba lagi." }, { status: 500 });
  }

  // 3. Hapus auth user (kredensial login) untuk Owner + tiap karyawan.
  // Cascade di langkah 2 sudah membuang baris `profiles`-nya, tapi baris
  // `auth.users` TIDAK ikut terhapus otomatis (arahnya cuma satu arah:
  // profiles -> auth.users), jadi harus dihapus manual satu per satu di
  // sini supaya tidak ada akun "hantu" yang masih bisa dipakai login.
  const failedUserDeletes: string[] = [];
  for (const id of authUserIds) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) failedUserDeletes.push(id);
  }

  if (failedUserDeletes.length > 0) {
    console.error("some auth users failed to delete after tenant wipe", failedUserDeletes);
  }

  return NextResponse.json({ success: true });
}
