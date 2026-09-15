export type Role = "super_admin" | "owner" | "manager" | "cashier";

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  owner: "Owner",
  manager: "Manager",
  cashier: "Kasir",
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
};
