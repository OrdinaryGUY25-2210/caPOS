import { cx } from "@/lib/utils";

/**
 * Menu Management §6 — badge status produk (Tersedia / Habis-Nonaktif),
 * dipakai konsisten di ProductCard & MenuTable supaya warnanya tidak
 * pernah beda antara tampilan grid dan tampilan tabel.
 */
export default function ProductStatusBadge({ isAvailable }: { isAvailable: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold",
        isAvailable ? "bg-primary-light text-primary-dark" : "bg-neutral-100 text-neutral-400"
      )}
    >
      {isAvailable ? "Tersedia" : "Habis / Nonaktif"}
    </span>
  );
}
