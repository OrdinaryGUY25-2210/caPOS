import React from "react";
import { cx } from "@/lib/utils";

export interface BadgeProps {
  variant?: "default" | "success" | "warning" | "danger" | "info";
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "bg-neutral-100 text-neutral-700",
  success: "bg-primary-light text-primary-dark",
  warning: "bg-warning-light text-amber-700",
  danger: "bg-urgent-light text-red-700",
  info: "bg-neutral-200 text-neutral-700",
};

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
