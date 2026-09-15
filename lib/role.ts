export type Role = "super_admin" | "owner" | "manager" | "cashier" | "kitchen";

// migration_16: Manajemen Karyawan adalah satu-satunya Single Source of
// Truth untuk 4 peran operasional tenant — label di UI sengaja memakai
// istilah "Admin / Supervisor / Kasir / Dapur" (sesuai spesifikasi bisnis)
// walau nilai enum di database TETAP owner/manager/cashier/kitchen (tidak
// diubah supaya tidak perlu migrasi data di semua baris profiles lama).
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  owner: "Admin",
  manager: "Supervisor",
  cashier: "Kasir",
  kitchen: "Dapur",
};

export function isManagerOrOwner(role: string | null | undefined) {
  return role === "owner" || role === "manager";
}

/** Halaman tujuan setelah login, sesuai role. */
export const ROLE_HOME: Record<string, string> = {
  super_admin: "/admin",
  owner: "/dashboard",
  manager: "/dashboard",
  cashier: "/pos",
  kitchen: "/kitchen",
};
