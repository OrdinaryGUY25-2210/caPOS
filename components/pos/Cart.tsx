"use client";

import { Tag, ShoppingCart } from "lucide-react";
import { cx, formatRupiah } from "@/lib/utils";
import CartItem from "./CartItem";
import CustomerSelector from "./CustomerSelector";
import OrderTypeSelector from "./OrderTypeSelector";
import TableSelector from "./TableSelector";
import OrderSummary from "./OrderSummary";
import { EmptyState, PosButton } from "./ui";
import {
  computeCartTotals,
  type CartLine,
  type OrderType,
  type SelectedCustomer,
} from "./types";

export default function Cart({
  cart,
  orderType,
  onOrderTypeChange,
  tableNumber,
  onTableNumberChange,
  selectedCustomer,
  onOpenCustomer,
  onClearCustomer,
  subtotal,
  discountPct,
  voucherDiscount,
  pointsDiscount,
  servicePct,
  taxPct,
  onOpenDiscount,
  onUpdateQty,
  onSetQty,
  onRemove,
  onUpdateNotes,
  onCheckout,
  onSendToKitchen,
  quickPayDisabled,
  embedded = false,
}: {
  cart: CartLine[];
  orderType: OrderType;
  onOrderTypeChange: (v: OrderType) => void;
  tableNumber: string;
  onTableNumberChange: (v: string) => void;
  selectedCustomer: SelectedCustomer | null;
  onOpenCustomer: () => void;
  onClearCustomer: () => void;
  subtotal: number;
  discountPct: number;
  voucherDiscount: number;
  pointsDiscount: number;
  servicePct: number;
  taxPct: number;
  onOpenDiscount: () => void;
  onUpdateQty: (id: string, delta: number) => void;
  onSetQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onCheckout: () => void;
  onSendToKitchen: () => void;
  quickPayDisabled?: boolean;
  embedded?: boolean;
}) {
  const totals = computeCartTotals({
    subtotal,
    discountPct,
    voucherDiscount,
    pointsDiscount,
    servicePct,
    taxPct,
  });
  const hasAnyDiscount = totals.memberDiscount > 0 || voucherDiscount > 0 || pointsDiscount > 0;
  const totalDiscount = totals.memberDiscount + voucherDiscount + pointsDiscount;

  return (
    <>
      {!embedded && (
        <div className="p-4 border-b border-neutral-200 shrink-0 flex items-center justify-between">
          <h2 className="font-bold text-neutral-900">Keranjang ({cart.length})</h2>
          {hasAnyDiscount && <span className="text-xs font-medium text-emerald-600">Diskon aktif</span>}
        </div>
      )}

      <div className={embedded ? "space-y-3" : "flex-1 overflow-y-auto p-4 space-y-3"}>
        <OrderTypeSelector value={orderType} onChange={onOrderTypeChange} />
        {orderType === "dine-in" && <TableSelector value={tableNumber} onChange={onTableNumberChange} />}

        <CustomerSelector customer={selectedCustomer} onOpen={onOpenCustomer} onClear={onClearCustomer} />

        <button
          onClick={onOpenDiscount}
          type="button"
          className={cx(
            "w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition-colors touch-manipulation",
            hasAnyDiscount
              ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
          )}
        >
          <span className="flex items-center gap-2">
            <Tag size={14} /> Diskon / Voucher / Poin
          </span>
          <span className="text-xs font-medium">
            {hasAnyDiscount ? `-${formatRupiah(totalDiscount)}` : "Tambah"}
          </span>
        </button>

        <div className="pt-1">
          {cart.length === 0 ? (
            <EmptyState
              icon={<ShoppingCart size={24} />}
              title="Belum ada item"
              description="Tap menu di sebelah kiri untuk menambahkan item ke keranjang."
              compact
            />
          ) : (
            cart.map((item) => (
              <CartItem
                key={item.cartItemId}
                item={item}
                onUpdateQty={onUpdateQty}
                onSetQty={onSetQty}
                onRemove={onRemove}
                onUpdateNotes={onUpdateNotes}
              />
            ))
          )}
        </div>
      </div>

      <div
        className={
          embedded
            ? "space-y-3 pt-4 mt-4 border-t border-neutral-100"
            : "p-4 border-t border-neutral-200 space-y-3 shrink-0"
        }
      >
        <OrderSummary
          subtotal={subtotal}
          discountPct={discountPct}
          memberDiscount={totals.memberDiscount}
          voucherDiscount={voucherDiscount}
          pointsDiscount={pointsDiscount}
          servicePct={servicePct}
          serviceCharge={totals.serviceCharge}
          taxPct={taxPct}
          taxAmount={totals.taxAmount}
          total={totals.total}
        />

        <PosButton
          onClick={onSendToKitchen}
          disabled={cart.length === 0}
          fullWidth
        >
          Kirim ke Dapur
        </PosButton>
        <PosButton
          variant="outline"
          size="md"
          onClick={onCheckout}
          disabled={cart.length === 0 || quickPayDisabled}
          fullWidth
          className="text-sm"
        >
          Bayar Langsung (tanpa dapur)
        </PosButton>
        {quickPayDisabled && cart.length > 0 && (
          <p className="text-[11px] text-neutral-400 text-center -mt-1">
            Ada item bervarian/modifier — gunakan &quot;Kirim ke Dapur&quot;.
          </p>
        )}
      </div>
    </>
  );
}