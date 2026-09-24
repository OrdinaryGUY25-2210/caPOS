"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ChevronDown,
  Receipt,
  Coffee,
  Users,
  CreditCard,
  Settings,
  LogOut,
  ShoppingCart,
  CalendarCheck,
  Gift,
  FileText,
  PackageSearch,
  Target,
  ClipboardCheck,
  Building2,
  ClipboardList,
  QrCode,
  ScanLine,
  CalendarClock,
  Percent,
  TrendingUp,
  Grid3x3,
  Truck,
  ShoppingBag,
  UserRound,
  Layers,
  SlidersHorizontal,
  ChefHat,
  Wheat,
  Menu,
  X,
  ChevronLeft,
} from "lucide-react";
import { cx } from "@/lib/utils";

/**
 * Refactored Sidebar Component
 * Location: components/sidebar/Sidebar.tsx
 *
 * Features:
 * - Collapsible groups (expand/collapse each section)
 * - Full sidebar collapse (icons only with tooltips)
 * - Mobile drawer (hamburger menu)
 * - Active state highlighting
 * - Icon consistency
 * - Profile dropdown integration
 * - Keyboard navigation support
 * - Responsive design
 */

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size: number; className: string }>;
  premiumOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "OVERVIEW",
    items: [{ href: "/dashboard", label: "Dashboard", icon: BarChart3 }],
  },
  {
    label: "OPERATIONS",
    items: [
      { href: "/dashboard/pos", label: "POS", icon: ShoppingCart },
      { href: "/dashboard/kitchen", label: "Kitchen", icon: ChefHat },
      { href: "/dashboard/qr-tables", label: "Tables", icon: Grid3x3 },
      { href: "/dashboard/orders", label: "Orders", icon: ClipboardList },
    ],
  },
  {
    label: "MENU",
    items: [
      { href: "/dashboard/menu", label: "Products", icon: Coffee },
      { href: "/dashboard/variants", label: "Variants", icon: Layers },
      {
        href: "/dashboard/modifiers",
        label: "Modifiers",
        icon: SlidersHorizontal,
      },
      { href: "/dashboard/recipes", label: "Recipes", icon: ChefHat },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      { href: "/dashboard/stock", label: "Stock", icon: PackageSearch },
      { href: "/dashboard/ingredients", label: "Ingredients", icon: Wheat },
      {
        href: "/dashboard/stock-opname",
        label: "Stock Opname",
        icon: ClipboardCheck,
      },
      {
        href: "/dashboard/purchasing/purchase-orders",
        label: "Purchasing",
        icon: Truck,
      },
    ],
  },
  {
    label: "CUSTOMERS",
    items: [
      { href: "/dashboard/crm/customers", label: "CRM", icon: Users },
      { href: "/dashboard/membership", label: "Membership", icon: UserRound },
      { href: "/dashboard/promotions", label: "Promotions", icon: Gift },
    ],
  },
  {
    label: "BUSINESS",
    items: [
      { href: "/dashboard/analytics", label: "Analytics", icon: TrendingUp },
      {
        href: "/dashboard/reservations",
        label: "Reservations",
        icon: CalendarClock,
      },
      {
        href: "/dashboard/online-orders",
        label: "Online Orders",
        icon: ShoppingBag,
      },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
      {
        href: "/dashboard/subscription",
        label: "Subscription",
        icon: CreditCard,
      },
    ],
  },
];

/**
 * Sidebar Navigation Item
 */
function SidebarItem({
  item,
  isActive,
  isSidebarCollapsed,
}: {
  item: NavItem;
  isActive: boolean;
  isSidebarCollapsed: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cx(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative group",
        isActive
          ? "bg-primary text-white"
          : "text-neutral-700 hover:bg-neutral-100"
      )}
      title={isSidebarCollapsed ? item.label : undefined}
    >
      <Icon size={18} className="flex-shrink-0" />
      {!isSidebarCollapsed && (
        <>
          <span className="truncate flex-1">{item.label}</span>
          {item.premiumOnly && (
            <span className="text-xs bg-warning text-warning-dark px-1.5 py-0.5 rounded">
              Pro
            </span>
          )}
        </>
      )}

      {/* Tooltip on collapse */}
      {isSidebarCollapsed && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-neutral-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
          {item.label}
        </div>
      )}
    </Link>
  );
}

/**
 * Sidebar Navigation Group
 */
function SidebarGroup({
  group,
  isActive,
  isExpanded,
  onToggle,
  isSidebarCollapsed,
}: {
  group: NavGroup;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  isSidebarCollapsed: boolean;
}) {
  return (
    <div className="space-y-1">
      {/* Group Header */}
      <button
        onClick={onToggle}
        className={cx(
          "w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors",
          isActive
            ? "text-primary bg-primary-light/50"
            : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50"
        )}
      >
        <span className={isSidebarCollapsed ? "hidden" : "block"}>
          {group.label}
        </span>
        <ChevronDown
          size={14}
          className={cx(
            "transition-transform",
            isExpanded ? "rotate-180" : "",
            isSidebarCollapsed ? "hidden" : "block"
          )}
        />
      </button>

      {/* Group Items */}
      {isExpanded && (
        <div className="space-y-1 pl-0">
          {group.items.map((item) => {
            const isItemActive = usePathname().startsWith(item.href);
            return (
              <SidebarItem
                key={item.href}
                item={item}
                isActive={isItemActive}
                isSidebarCollapsed={isSidebarCollapsed}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Main Sidebar Component
 */
function SidebarContent({
  isMobile,
  onCloseMobile,
  isSidebarCollapsed,
  onToggleSidebarCollapse,
}: {
  isMobile?: boolean;
  onCloseMobile?: () => void;
  isSidebarCollapsed: boolean;
  onToggleSidebarCollapse: () => void;
}) {
  const pathname = usePathname();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["OPERATIONS", "MENU"]) // Default expanded groups
  );

  // Auto-expand group containing current active item
  useEffect(() => {
    const activeGroup = NAV_GROUPS.find((group) =>
      group.items.some((item) => pathname.startsWith(item.href))
    );
    if (activeGroup) {
      setExpandedGroups((prev) => new Set([...prev, activeGroup.label]));
    }
  }, [pathname]);

  const toggleGroup = (groupLabel: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupLabel)) {
        next.delete(groupLabel);
      } else {
        next.add(groupLabel);
      }
      return next;
    });
  };

  return (
    <div
      className={cx(
        "flex flex-col h-full bg-white border-r border-neutral-200 transition-all",
        isSidebarCollapsed ? "w-20" : "w-64"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-neutral-200">
        {!isSidebarCollapsed && (
          <div className="font-bold text-lg text-primary">caPOS</div>
        )}
        <div className="flex items-center gap-1">
          {/* Collapse Button */}
          {!isMobile && (
            <button
              onClick={onToggleSidebarCollapse}
              className="p-1.5 hover:bg-neutral-100 rounded-lg transition-colors hidden md:flex"
              title={isSidebarCollapsed ? "Expand" : "Collapse"}
            >
              {isSidebarCollapsed ? (
                <ChevronDown size={16} className="rotate-270" />
              ) : (
                <ChevronLeft size={16} />
              )}
            </button>
          )}

          {/* Mobile Close Button */}
          {isMobile && onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="p-1.5 hover:bg-neutral-100 rounded-lg transition-colors md:hidden"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-2">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup
            key={group.label}
            group={group}
            isActive={group.items.some((item) => pathname.startsWith(item.href))}
            isExpanded={expandedGroups.has(group.label)}
            onToggle={() => toggleGroup(group.label)}
            isSidebarCollapsed={isSidebarCollapsed}
          />
        ))}
      </nav>

      {/* Footer */}
      {!isSidebarCollapsed && (
        <div className="p-3 border-t border-neutral-200 space-y-2">
          <Link
            href="/dashboard/settings"
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
          >
            <Settings size={16} />
            <span>Settings</span>
          </Link>
          <button className="flex items-center gap-2 w-full px-3 py-2 text-sm text-urgent hover:bg-urgent/5 rounded-lg transition-colors">
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Mobile Drawer Wrapper
 */
function MobileDrawer({
  isOpen,
  onClose,
  isSidebarCollapsed,
  onToggleSidebarCollapse,
}: {
  isOpen: boolean;
  onClose: () => void;
  isSidebarCollapsed: boolean;
  onToggleSidebarCollapse: () => void;
}) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cx(
          "fixed left-0 top-0 h-full bg-white z-50 md:hidden transition-transform",
          isOpen ? "translate-x-0" : "-translate-x-full",
          isSidebarCollapsed ? "w-20" : "w-64"
        )}
      >
        <SidebarContent
          isMobile={true}
          onCloseMobile={onClose}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebarCollapse={onToggleSidebarCollapse}
        />
      </div>
    </>
  );
}

/**
 * Main Sidebar Export
 */
export function Sidebar() {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <SidebarContent
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebarCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />
      </div>

      {/* Mobile Drawer */}
      <MobileDrawer
        isOpen={isMobileOpen}
        onClose={() => setIsMobileOpen(false)}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebarCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Mobile Menu Button (in navbar) */}
      <div className="md:hidden">
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-2 hover:bg-neutral-100 rounded-lg transition-colors"
        >
          {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </>
  );
}
