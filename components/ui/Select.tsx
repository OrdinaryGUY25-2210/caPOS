import React from "react";
import { cx } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  error?: string;
  hint?: string;
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, error, hint, placeholder, className, id, ...props }, ref) => {
    const selectId = id ?? props.name;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-neutral-700">
            {label}
          </label>
        )}
        <select
          id={selectId}
          ref={ref}
          aria-invalid={!!error || undefined}
          className={cx(
            "h-10 px-3 rounded-md border bg-white text-sm text-neutral-900",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
            "disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed",
            error
              ? "border-urgent focus-visible:ring-urgent"
              : "border-neutral-300 focus-visible:ring-primary",
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        {error ? (
          <span className="text-xs text-urgent">{error}</span>
        ) : hint ? (
          <span className="text-xs text-neutral-500">{hint}</span>
        ) : null}
      </div>
    );
  }
);
Select.displayName = "Select";
