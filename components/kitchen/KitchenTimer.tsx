"use client";

import { useEffect, useState } from "react";
import { cx } from "@/lib/utils";

/* --------------------------------------------------------------------
 * Module-level ticker — SATU setInterval untuk semua <KitchenTimer />
 * di halaman. Kalau tidak begini, 30 order aktif = 30 setInterval
 * terpisah, dan tiap detik semua komponen ikut re-render. Dengan
 * shared listener, hanya <KitchenTimer /> yang update.
 * ------------------------------------------------------------------ */
const listeners = new Set<(now: number) => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: (now: number) => void) {
  listeners.add(fn);
  if (intervalId === null) {
    intervalId = setInterval(() => {
      const now = Date.now();
      listeners.forEach((l) => l(now));
    }, 1000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

export type KitchenPriority = "normal" | "warning" | "urgent";

// Threshold sengaja di sini (bukan di KitchenOrderCard) supaya
// sorting di KitchenBoard bisa pakai fungsi yang sama.
export function getKitchenPriority(createdAt: string, nowMs = Date.now()): KitchenPriority {
  const elapsedMin = (nowMs - new Date(createdAt).getTime()) / 60000;
  if (elapsedMin >= 15) return "urgent";
  if (elapsedMin >= 10) return "warning";
  return "normal";
}

export function formatElapsed(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const PRIORITY_STYLES: Record<KitchenPriority, string> = {
  normal: "text-neutral-500 bg-neutral-100 border-neutral-200",
  warning: "text-amber-700 bg-amber-50 border-amber-200",
  urgent: "text-white bg-urgent border-urgent animate-pulse",
};

export default function KitchenTimer({
  createdAt,
  className,
}: {
  createdAt: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now()); // sync langsung, hindari 1 detik "00:00" palsu
    return subscribe(setNow);
  }, []);

  const elapsed = now - new Date(createdAt).getTime();
  const priority = getKitchenPriority(createdAt, now);

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-mono font-semibold tabular-nums",
        PRIORITY_STYLES[priority],
        className
      )}
      aria-label={`Waktu berjalan ${formatElapsed(elapsed)}`}
    >
      {formatElapsed(elapsed)}
    </span>
  );
}