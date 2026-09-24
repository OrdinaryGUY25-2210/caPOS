import React from "react";
import { cx } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const inputId = id ?? props.name;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-neutral-700">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          aria-invalid={!!error || undefined}
          className={cx(
            "h-10 px-3 rounded-md border bg-white text-sm text-neutral-900",
            "placeholder:text-neutral-400 transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
            "disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed",
            error
              ? "border-urgent focus-visible:ring-urgent"
              : "border-neutral-300 focus-visible:ring-primary",
            className
          )}
          {...props}
        />
        {error ? (
          <span className="text-xs text-urgent">{error}</span>
        ) : hint ? (
          <span className="text-xs text-neutral-500">{hint}</span>
        ) : null}
      </div>
    );
  }
);
Input.displayName = "Input";
