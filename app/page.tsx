import { redirect } from "next/navigation";

// Middleware (lihat middleware.ts) sudah menangani redirect "/" -> home
// sesuai role UNTUK USER YANG SUDAH LOGIN (super_admin -> /admin,
// owner/manager -> /dashboard, cashier -> /pos, kitchen -> /kitchen).
// "/" sengaja dikecualikan dari guard auth di middleware supaya request
// ke root tidak nyangkut sebelum sempat dicek. Kalau kode sampai di
// sini artinya user BELUM login — lempar ke /login.
export default function RootPage() {
  redirect("/login");
}
