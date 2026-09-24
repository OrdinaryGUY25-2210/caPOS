"use client";

import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, forwardRef } from "react";
import { Loader2, Minus, Plus, Inbox, AlertTriangle, CheckCircle2, Check } from "lucide-react";
import { cx } from "@/lib/utils";

/* ============================== Button ============================== */

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-dark disabled:bg-neutral-300 disabled:hover:bg-neutral-300",
  outline: "border border-neutral-200 text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 disabled:hover:bg-transparent",
  ghost: "text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 disabled:hover:bg-transparent",
  danger: "bg-urgent text-white hover:bg-urgent/90 disabled:opacity-50",
};
const BTN_SIZES: Record<ButtonSize, string> = {
  sm: "text-xs px-2.5 py-1.5 rounded-lg gap-1.5",
  md: "text-sm px-4 py-2.5 rounded-xl gap-2",
  lg: "text-base px-5 py-3 rounded-2xl gap-2",
};

export function PosButton({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  fullWidth = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center font-semibold transition-colors touch-manipulation select-none",
        "disabled:cursor-not-allowed",
        BTN_VARIANTS[variant],
        BTN_SIZES[size],
        fullWidth && "w-full",
        className
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin shrink-0" /> : icon}
      {children}
    </button>
  );
}

/* ============================== Input =============================== */

export const PosInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PosInput({ className, ...rest }, ref) {
    return <input ref={ref} {...rest} className={cx("input-field", className)} />;
  }
);

/* ========================== Quantity Stepper ======================== */

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = Infinity,
  size = "md",
  ariaLabel = "Jumlah",
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const btn = size === "sm" ? "w-7 h-7" : "w-8 h-8";
  const icon = size === "sm" ? 12 : 13;
  const field = size === "sm" ? "w-8" : "w-10";
  const canDec = value > min;
  const canInc = value < max;
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => canDec && onChange(value - 1)}
        disabled={!canDec}
        aria-label="Kurangi jumlah"
        className={cx(btn, "rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-100 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation")}
      >
        <Minus size={icon} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max === Infinity ? undefined : max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        onFocus={(e) => e.target.select()}
        aria-label={ariaLabel}
        className={cx(
          "text-sm font-medium text-center bg-transparent border-b border-transparent focus:border-primary outline-none",
          "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
          field
        )}
      />
      <button
        type="button"
        onClick={() => canInc && onChange(value + 1)}
        disabled={!canInc}
        aria-label="Tambah jumlah"
        className={cx(btn, "rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-100 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation")}
      >
        <Plus size={icon} />
      </button>
    </div>
  );
}

/* ============================ State blocks =========================== */

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center text-center gap-2", compact ? "py-6 px-3" : "py-10 px-4")}>
      <div className="text-neutral-300">{icon ?? <Inbox size={compact ? 22 : 28} />}</div>
      <p className="text-sm font-medium text-neutral-500">{title}</p>
      {description && <p className="text-xs text-neutral-400 max-w-xs">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function LoadingState({ message = "Memuat...", compact = false }: { message?: string; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-3 text-neutral-400", compact ? "py-6" : "py-10")}>
      <Loader2 size={compact ? 20 : 24} className="animate-spin" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

export function ErrorState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 text-sm">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p>{message}</p>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function SuccessState({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2.5 text-sm">
      {icon ?? <CheckCircle2 size={16} className="shrink-0" />}
      <p className="flex-1">{message}</p>
    </div>
  );
}

/* ============================ Section label ========================== */

export function SectionLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">{children}</p>
      {hint && <span className="text-[10px] text-neutral-400">{hint}</span>}
    </div>
  );
}

/* ====================== Selectable row (radio/check) ================= */

export function SelectableRow({
  selected,
  onClick,
  label,
  trailing,
  radio = true,
}: {
  selected: boolean;
  onClick: () => void;
  label: ReactNode;
  trailing?: ReactNode;
  radio?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm text-left transition-colors touch-manipulation",
        selected ? "border-primary bg-primary/5" : "border-neutral-200 hover:bg-neutral-50"
      )}
    >
      <span className="flex items-center gap-2 text-neutral-800 min-w-0">
        <span
          className={cx(
            "w-4 h-4 border flex items-center justify-center shrink-0 text-white",
            radio ? "rounded-full" : "rounded",
            selected ? "border-primary bg-primary" : "border-neutral-300"
          )}
        >
          {selected && <Check size={10} strokeWidth={3} />}
        </span>
        <span className="truncate">{label}</span>
      </span>
      {trailing && <span className="text-neutral-500 shrink-0 ml-2">{trailing}</span>}
    </button>
  );
}