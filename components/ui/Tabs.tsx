"use client";

import React, { useState } from "react";
import { cx } from "@/lib/utils";

export interface TabItem {
  label: string;
  value: string;
  content: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  defaultTab?: string;
  value?: string;
  onChange?: (value: string) => void;
}

export function Tabs({ items, defaultTab, value, onChange }: TabsProps) {
  const [internal, setInternal] = useState(defaultTab ?? items[0]?.value);
  const active = value ?? internal;

  const select = (v: string) => {
    setInternal(v);
    onChange?.(v);
  };

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-neutral-200 overflow-x-auto no-scrollbar">
        {items.map((item) => (
          <button
            key={item.value}
            role="tab"
            aria-selected={active === item.value}
            disabled={item.disabled}
            onClick={() => select(item.value)}
            className={cx(
              "px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded-t-md",
              "disabled:opacity-50 disabled:pointer-events-none",
              active === item.value
                ? "border-primary text-primary"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="pt-4">{items.find((item) => item.value === active)?.content}</div>
    </div>
  );
}
