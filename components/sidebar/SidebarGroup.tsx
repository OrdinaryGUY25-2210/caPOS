import React from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';

interface NavItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface SidebarGroupProps {
  group: NavGroup;
  isCollapsed: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

export function SidebarGroup({
  group,
  isCollapsed,
  isExpanded,
  onToggle,
}: SidebarGroupProps) {
  return (
    <div className="space-y-1">
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors ${
          isCollapsed ? 'justify-center' : ''
        }`}
      >
        {!isCollapsed && (
          <>
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex-1">
              {group.title}
            </span>
            <ChevronDown
              size={16}
              className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </>
        )}
      </button>

      {isExpanded && !isCollapsed && (
        <div className="space-y-0.5">
          {group.items.map((item) => (
            <Tooltip key={item.href} content={item.label}>
              <Link
                href={item.href}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors text-gray-700"
              >
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm">{item.label}</span>
              </Link>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
