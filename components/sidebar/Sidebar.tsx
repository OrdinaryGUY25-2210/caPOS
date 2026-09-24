"use client";

import React from "react";
import Link from "next/link";
import { LucideIcon } from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon | React.ComponentType<any>;
  badge?: string | number;
}

interface SidebarProps {
  items?: NavItem[];
  currentPath?: string;
}

export default function Sidebar({ items = [], currentPath }: SidebarProps) {
  return (
    <aside className="w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 min-h-screen p-4">
      <nav className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = currentPath === item.href;

          return (
            <Link
              key={item.id}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" size={20} />
              <span className="truncate">{item.label}</span>
              {item.badge && (
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
