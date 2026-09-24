/**
 * Recipe/BOM §8 — "Version/status": badge kecil "Resep aktif v2" / "Belum
 * ada resep aktif", dipakai di halaman Resep (dan bisa dipakai ulang di
 * ProductConfigModal Menu kalau nanti mau ditampilkan versi resepnya juga,
 * bukan cuma ada/tidaknya).
 */
export default function RecipeVersionBadge({ version, isActive }: { version: number | null; isActive: boolean }) {
  if (!isActive || version === null) {
    return <span className="text-xs text-neutral-400">Belum ada resep aktif</span>;
  }
  return <span className="badge-active">Resep aktif v{version}</span>;
}
