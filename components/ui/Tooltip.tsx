"use client";

import React, { useState } from "react";
import { cx } from "@/lib/utils";

export interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
}

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={cx(
            "absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-xs text-white z-50",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2"
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
