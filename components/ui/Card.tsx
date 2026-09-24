import React from "react";
import { cx } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({ padded = true, className, ...props }: CardProps) {
  return (
    <div
      className={cx(
        "bg-white rounded-lg border border-neutral-200 shadow-[var(--shadow-card)]",
        padded && "p-4 sm:p-6",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("flex items-center justify-between mb-4", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cx("text-base font-semibold text-neutral-900", className)}
      {...props}
    />
  );
}
