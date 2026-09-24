import React from "react";
import { cx } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 font-medium rounded-md transition-colors " +
  "duration-150 disabled:opacity-50 disabled:pointer-events-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const variantStyles: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-dark active:bg-primary-dark " +
    "focus-visible:ring-primary",
  outline:
    "border border-neutral-300 text-neutral-700 bg-white hover:bg-neutral-50 " +
    "active:bg-neutral-100 focus-visible:ring-primary",
  ghost:
    "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 " +
    "focus-visible:ring-primary",
  danger:
    "bg-urgent text-white hover:bg-red-700 active:bg-red-700 focus-visible:ring-urgent",
};

// Tinggi (h-*) DIKUNCI per size — dipakai bareng Input/Select supaya
// selalu align tinggi di satu baris form. Jangan ubah tanpa mengubah
// Input.tsx & Select.tsx juga.
const sizeStyles: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(base, variantStyles[variant], sizeStyles[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}
