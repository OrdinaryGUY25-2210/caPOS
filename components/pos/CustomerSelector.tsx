"use client";

import { UserRound, X as XIcon } from "lucide-react";
import type { SelectedCustomer } from "./types";

export default function CustomerSelector({
  customer,
  onOpen,
  onClear,
}: {
  customer: SelectedCustomer | null;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      type="button"
      className="w-full flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2.5 text-sm hover:bg-neutral-50 transition-colors touch-manipulation"
    >
      <span className="flex items-center gap-2 text-neutral-700 min-w-0">
        <UserRound size={15} className="shrink-0" />
        <span className="truncate">
          {customer ? customer.customer_name : "Pelanggan / Poin Loyalitas"}
        </span>
      </span>
      {customer ? (
        <span
          role="button"
          aria-label="Hapus pelanggan"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="text-neutral-400 hover:text-urgent shrink-0"
        >
          <XIcon size={14} />
        </span>
      ) : (
        <span className="text-primary text-xs font-medium shrink-0">Pilih</span>
      )}
    </button>
  );
}