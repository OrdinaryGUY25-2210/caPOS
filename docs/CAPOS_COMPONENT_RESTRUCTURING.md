# caPOS Component Restructuring Guide
**Target Completion**: Phase 2A.2 §21-25  
**Date**: September 2026

---

## Overview
This document outlines the restructuring of caPOS dashboard components to achieve 90-98% completion across Import, Settings, Profile, Sidebar Navigation, and Global Design System modules.

---

## 1. IMPORT FEATURE (Target: 90%)

### Location
```
app/dashboard/settings/import/page.tsx (refactored)
components/import/ImportFlow.tsx (new)
components/import/ImportTypeSelector.tsx (new)
components/import/FileUploader.tsx (new)
components/import/ColumnMapper.tsx (new)
components/import/ImportPreview.tsx (new)
components/import/ImportProgress.tsx (new)
components/import/ImportResult.tsx (new)
```

### Flow
```
Upload
  ↓
Detect columns
  ↓
Preview
  ↓
Validate
  ↓
Error report
  ↓
Import
  ↓
Success
```

### Minimal Entities
- Product
- Variant
- Modifier
- Ingredient
- Recipe
- Customer
- Supplier

### Key Improvements
1. Split monolithic page into reusable components
2. Better error handling & reporting
3. Column detection automation
4. Real-time validation feedback
5. Progress tracking

---

## 2. SETTINGS (Target: 95%)

### Location
```
app/dashboard/settings/page.tsx (refactored - becomes hub)
app/dashboard/settings/business/page.tsx (new)
app/dashboard/settings/profile/page.tsx (new)
app/dashboard/settings/branch/page.tsx (new)
app/dashboard/settings/receipt/page.tsx (new)
app/dashboard/settings/printer/page.tsx (new)
app/dashboard/settings/menu/page.tsx (new)
app/dashboard/settings/payment/page.tsx (new)
app/dashboard/settings/qr/page.tsx (new)
app/dashboard/settings/subscription/page.tsx (new)
app/dashboard/settings/import/page.tsx (existing)
app/dashboard/settings/security/page.tsx (new)
app/dashboard/settings/pwa/page.tsx (new)

components/settings/SettingsNav.tsx (new)
components/settings/SettingsCard.tsx (new)
```

### Settings Categories
```
├─ Business
│  ├─ Business Info
│  ├─ Logo Upload
│  └─ Contact Info
├─ Profile
│  ├─ Account Info
│  ├─ Password
│  └─ Avatar
├─ Branch
│  ├─ Branch Management
│  └─ Multi-location Config
├─ Receipt
│  ├─ Receipt Format
│  ├─ Footer Text
│  └─ Logo Placement
├─ Printer
│  ├─ Paper Width (58mm/80mm)
│  ├─ Connection Type
│  └─ Test Print
├─ Menu
│  ├─ Category Settings
│  └─ Product Display
├─ Payment
│  ├─ Payment Methods
│  ├─ Midtrans Config
│  └─ QRIS Settings
├─ QR
│  ├─ QR Table Config
│  └─ Dynamic QR
├─ Subscription
│  ├─ Plan Overview
│  ├─ Usage Stats
│  └─ Upgrade/Downgrade
├─ Import
│  ├─ Data Import
│  └─ Migration Tools
├─ Security
│  ├─ Two-Factor Auth
│  ├─ Session Management
│  └─ Account Deletion
└─ PWA
   ├─ Offline Mode
   └─ Installation Settings
```

### Key Rules
- **Never** make settings one long page
- Use tab navigation or sidebar for category switching
- Clear visual separation between sections
- Danger zone (delete account) clearly marked

---

## 3. PROFILE / ACCOUNT (Target: 95%)

### Location
```
components/profile/ProfileDropdown.tsx (new)
components/profile/ProfileCard.tsx (new)
components/profile/AccountSettings.tsx (new)
components/profile/PasswordChange.tsx (new)
components/profile/AvatarUpload.tsx (new)
components/profile/DeleteAccountModal.tsx (new)

app/dashboard/settings/profile/page.tsx (new)
```

### Profile Dropdown
```
├─ Profile
├─ Account Information
├─ Settings
├─ Subscription
├─ Logout
└─ Delete Account
```

### Requirements
- Profile dropdown in top navbar
- Quick access to account settings
- **Clear confirmation** for account deletion
- Confirmation must include:
  - Warning about data loss
  - Typed confirmation of business name
  - Secondary button confirmation

---

## 4. SIDEBAR / NAVIGATION (Target: 98%)

### Location
```
components/sidebar/Sidebar.tsx (refactored)
components/sidebar/SidebarGroup.tsx (new)
components/sidebar/SidebarItem.tsx (new)
components/sidebar/SidebarCollapse.tsx (new)
components/sidebar/MobileDrawer.tsx (new)
components/sidebar/NavTooltip.tsx (new)

components/layout/DashboardLayout.tsx (refactored)
components/layout/Navbar.tsx (new)
```

### Navigation Structure
```
OVERVIEW
├─ Dashboard

OPERATIONS
├─ POS
├─ Kitchen
├─ Tables
└─ Orders

MENU
├─ Products
├─ Variants
├─ Modifiers
└─ Recipes

INVENTORY
├─ Stock
├─ Ingredients
├─ Stock Opname
└─ Purchasing

CUSTOMERS
├─ CRM
├─ Membership
└─ Promotions

BUSINESS
├─ Analytics
├─ Reservations
└─ Online Orders

SYSTEM
├─ Settings
├─ Subscription
└─ Help
```

### Must Have
- ✅ Group menu (visual grouping)
- ✅ Collapse group (minimize/expand sections)
- ✅ Collapse sidebar (full collapse to icons)
- ✅ Mobile drawer (hamburger menu)
- ✅ Active state (highlight current page)
- ✅ Icon consistency (all items have icons)
- ✅ Tooltip (on collapsed state)
- ✅ Scroll (handle overflow)
- ✅ Profile dropdown (user menu)
- ✅ Logout (from sidebar)
- ✅ Responsive (mobile/tablet/desktop)

---

## 5. GLOBAL DESIGN SYSTEM (Target: 98–100%)

### Location
```
components/ui/Button.tsx (refactored)
components/ui/Card.tsx (refactored)
components/ui/Table.tsx (new)
components/ui/Modal.tsx (refactored)
components/ui/Dropdown.tsx (new)
components/ui/Input.tsx (refactored)
components/ui/Select.tsx (new)
components/ui/Badge.tsx (new)
components/ui/Toast.tsx (refactored)
components/ui/Alert.tsx (new)
components/ui/Tooltip.tsx (new)
components/ui/Tabs.tsx (new)
components/ui/Pagination.tsx (new)
components/ui/Skeleton.tsx (refactored)
components/ui/EmptyState.tsx (new)
components/ui/ErrorState.tsx (new)
components/ui/Confirmation.tsx (new)

app/globals.css (refactored)
```

### Standardization Requirements
1. **Typography**
   - Heading sizes (h1, h2, h3, h4, h5, h6)
   - Body text sizes (sm, base, lg)
   - Font weights (regular, medium, semibold, bold)

2. **Buttons**
   - Variants: primary, secondary, outline, danger
   - Sizes: sm, md, lg
   - States: default, hover, active, disabled, loading

3. **Cards**
   - Padding, border-radius, shadow consistency
   - Light/dark backgrounds
   - Hover states

4. **Tables**
   - Header styling
   - Row striping
   - Sorting indicators
   - Column alignment

5. **Modal**
   - Overlay, backdrop
   - Header, body, footer
   - Close button
   - Scrollable body

6. **Dropdown**
   - Menu items
   - Dividers
   - Icons
   - Keyboard navigation

7. **Input**
   - Border, padding, focus states
   - Placeholder text
   - Error states
   - Disabled states

8. **Select**
   - Dropdown options
   - Search functionality
   - Multi-select support
   - Placeholder

9. **Badge**
   - Variants: active, warning, urgent, neutral
   - Sizes: sm, md

10. **Toast**
    - Positions: top, bottom
    - Types: success, error, warning, info
    - Auto-dismiss

11. **Alert**
    - Alert variants
    - Icon + message
    - Close button

12. **Tooltip**
    - Position variants
    - Dark/light theme
    - Arrow indicator

13. **Tabs**
    - Tab navigation
    - Active indicator
    - Disabled tabs

14. **Pagination**
    - Previous/Next buttons
    - Page numbers
    - Disabled states

15. **Skeleton**
    - Skeleton loader animations
    - Different shapes

16. **Empty State**
    - Icon, heading, message
    - Call-to-action button

17. **Error State**
    - Error icon
    - Error message
    - Retry button

18. **Confirmation**
    - Title, message
    - Confirm/Cancel buttons
    - Danger confirmation (red button)

### Page States (REQUIRED)
**Every page MUST have all states:**
```
Loading
  ↓
Loaded (with data)
  ↓
Empty (no data)
  ↓
Error (with retry)
  ↓
Success (after action)
```

### Rules
- ✅ No page shall have ONLY: "data tampil / data tidak tampil"
- ✅ All states must be represented in components
- ✅ Consistent color palette (primary, success, warning, urgent, neutral)
- ✅ Consistent spacing (4px grid)
- ✅ Consistent shadows & borders

---

## Implementation Priority

### Phase 1 (Weeks 1-2)
1. Global Design System (UI components)
2. Settings page restructuring
3. Profile/Account components

### Phase 2 (Weeks 3-4)
1. Sidebar/Navigation refactoring
2. Import component extraction
3. Page state management

### Phase 3 (Weeks 5-6)
1. Integration & testing
2. Mobile responsiveness
3. Performance optimization

---

## File Structure Summary

```
app/
├─ dashboard/
│  ├─ settings/
│  │  ├─ page.tsx (hub/router)
│  │  ├─ business/page.tsx
│  │  ├─ profile/page.tsx
│  │  ├─ branch/page.tsx
│  │  ├─ receipt/page.tsx
│  │  ├─ printer/page.tsx
│  │  ├─ menu/page.tsx
│  │  ├─ payment/page.tsx
│  │  ├─ qr/page.tsx
│  │  ├─ subscription/page.tsx
│  │  ├─ import/page.tsx (refactored)
│  │  ├─ security/page.tsx
│  │  └─ pwa/page.tsx

components/
├─ ui/
│  ├─ Button.tsx
│  ├─ Card.tsx
│  ├─ Table.tsx
│  ├─ Modal.tsx
│  ├─ Dropdown.tsx
│  ├─ Input.tsx
│  ├─ Select.tsx
│  ├─ Badge.tsx
│  ├─ Toast.tsx
│  ├─ Alert.tsx
│  ├─ Tooltip.tsx
│  ├─ Tabs.tsx
│  ├─ Pagination.tsx
│  ├─ Skeleton.tsx
│  ├─ EmptyState.tsx
│  ├─ ErrorState.tsx
│  └─ Confirmation.tsx

├─ settings/
│  ├─ SettingsNav.tsx
│  └─ SettingsCard.tsx

├─ profile/
│  ├─ ProfileDropdown.tsx
│  ├─ ProfileCard.tsx
│  ├─ AccountSettings.tsx
│  ├─ PasswordChange.tsx
│  ├─ AvatarUpload.tsx
│  └─ DeleteAccountModal.tsx

├─ sidebar/
│  ├─ Sidebar.tsx (refactored)
│  ├─ SidebarGroup.tsx
│  ├─ SidebarItem.tsx
│  ├─ SidebarCollapse.tsx
│  ├─ MobileDrawer.tsx
│  └─ NavTooltip.tsx

├─ layout/
│  ├─ DashboardLayout.tsx
│  └─ Navbar.tsx

└─ import/
   ├─ ImportFlow.tsx
   ├─ ImportTypeSelector.tsx
   ├─ FileUploader.tsx
   ├─ ColumnMapper.tsx
   ├─ ImportPreview.tsx
   ├─ ImportProgress.tsx
   └─ ImportResult.tsx
```

---

## Completion Checklist

### Import (90%)
- [ ] FileUploader component
- [ ] ColumnMapper component
- [ ] ImportPreview component
- [ ] Error reporting
- [ ] Progress tracking
- [ ] Result display
- [ ] Multi-entity support
- [ ] Duplicate detection
- [ ] Validation rules

### Settings (95%)
- [ ] Settings hub/router
- [ ] 12 category pages
- [ ] Navigation between categories
- [ ] Form state management
- [ ] Save/cancel logic
- [ ] Danger zone (delete account)
- [ ] Success feedback

### Profile (95%)
- [ ] ProfileDropdown component
- [ ] Account settings page
- [ ] Password change form
- [ ] Avatar upload
- [ ] DeleteAccountModal with confirmation
- [ ] Profile card display

### Sidebar (98%)
- [ ] Group collapsing
- [ ] Sidebar collapse toggle
- [ ] Mobile drawer
- [ ] Active state highlighting
- [ ] Tooltip system
- [ ] Profile dropdown integration
- [ ] Responsive layout
- [ ] Keyboard navigation

### Design System (98-100%)
- [ ] All 15 component types
- [ ] All variants & states
- [ ] Color system
- [ ] Typography scale
- [ ] Spacing/grid system
- [ ] Shadow system
- [ ] Page state coverage
- [ ] Accessibility features

---

## Notes
- All existing page routes remain unchanged
- No database schema modifications required
- Backward compatible with existing functionality
- Focus on UX/UI improvements & code organization
