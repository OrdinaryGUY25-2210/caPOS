"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldAlert, X } from "lucide-react";

const PATH_LABEL: Record<string, string> = {
  "/admin": "Panel Super Admin",
  "/dashboard": "Dashboard Pemilik Kafe",
};

function labelFor(path: string) {
  const match = Object.keys(PATH_LABEL).find((p) => path.startsWith(p));
  return match ? PATH_LABEL[match] : path;
}

/**
 * Menampilkan alasan kenapa user tiba-tiba dibelokkan ke halaman ini —
 * dipicu oleh query param `?access_denied=<path>` yang ditambahkan
 * middleware.ts saat memblokir akses lintas-role (mis. kasir mengubah URL
 * jadi /dashboard secara manual). Tanpa ini, user cuma "terlempar" balik
 * tanpa penjelasan, yang terasa membingungkan/seperti bug padahal itu
 * proteksi yang bekerja dengan benar.
 *
 * URL dibersihkan lagi (query param dihapus) setelah notifikasi tampil,
 * supaya tidak menempel permanen kalau halaman di-refresh/dibagikan.
 */
export default function AccessDeniedNotice() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deniedPath = searchParams.get("access_denied");
  const [visible, setVisible] = useState(!!deniedPath);

  useEffect(() => {
    if (!deniedPath) return;
    setVisible(true);

    // Bersihkan query param dari address bar tanpa reload halaman.
    const url = new URL(window.location.href);
    url.searchParams.delete("access_denied");
    router.replace(url.pathname + url.search, { scroll: false });

    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deniedPath]);

  if (!deniedPath || !visible) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md">
      <div className="bg-neutral-900 text-white rounded-2xl shadow-xl px-4 py-3 flex items-start gap-3">
        <ShieldAlert size={18} className="text-warning shrink-0 mt-0.5" />
        <div className="flex-1 text-sm">
          <p className="font-medium">Akses ditolak</p>
          <p className="text-neutral-300 text-xs mt-0.5">
            Akun Anda tidak punya izin membuka <span className="font-medium text-white">{labelFor(deniedPath)}</span>.
            Anda dialihkan ke halaman yang sesuai dengan peran akun Anda.
          </p>
        </div>
        <button
          onClick={() => setVisible(false)}
          aria-label="Tutup notifikasi"
          className="text-neutral-400 hover:text-white shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
