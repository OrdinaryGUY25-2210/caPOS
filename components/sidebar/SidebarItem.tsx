import React from 'react';
import Link from 'next/link';
import { Tooltip } from '@/components/ui/Tooltip';

interface SidebarItemProps {
  label: string;
  href: string;
  icon?: React.ReactNode;
  isCollapsed?: boolean;
  isActive?: boolean;
}

export function SidebarItem({
  label,
  href,
  icon,
  isCollapsed = false,
  isActive = false,
}: SidebarItemProps) {
  return (
    <Tooltip content={label}>
      <Link
        href={href}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
          isActive
            ? 'bg-blue-100 text-blue-600'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        {icon && <span className="text-lg">{icon}</span>}
        {!isCollapsed && <span className="text-sm">{label}</span>}
      </Link>
    </Tooltip>
  );
}
