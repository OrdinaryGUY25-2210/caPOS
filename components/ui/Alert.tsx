import React from "react";
import { cx } from "@/lib/utils";

export interface AlertProps {
  variant?: "success" | "error" | "warning" | "info";
  title?: string;
  message: string;
  children?: React.ReactNode;
  className?: string;
}

// Selaras dengan Badge/Toast — satu peta status warna untuk seluruh app.
const variantStyles: Record<NonNullable<AlertProps["variant"]>, string> = {
  success: "bg-primary-light text-primary-dark border-primary/30",
  error: "bg-urgent-light text-red-700 border-urgent/30",
  warning: "bg-warning-light text-amber-700 border-warning/30",
  info: "bg-neutral-100 text-neutral-700 border-neutral-300",
};

export function Alert({ variant = "info", title, message, children, className }: AlertProps) {
  return (
    <div
      role="alert"
      className={cx("p-4 rounded-md border text-sm", variantStyles[variant], className)}
    >
      {title && <p className="font-semibold mb-1">{title}</p>}
      <p>{message}</p>
      {children}
    </div>
  );
}
