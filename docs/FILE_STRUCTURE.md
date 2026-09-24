# caPOS Component Restructuring - File Structure Guide
**Visual Organization Map**

---

## 📁 Complete Directory Structure

```
capos-project/
├─ app/
│  ├─ dashboard/
│  │  ├─ settings/
│  │  │  ├─ page.tsx                      ← HUB PAGE (refactor from current)
│  │  │  │                                   Shows 12 category cards
│  │  │  │                                   Grid layout, responsive
│  │  │  │                                   Links to individual pages
│  │  │  │
│  │  │  ├─ business/
│  │  │  │  └─ page.tsx                   ← NEW (Logo, name, phone, address)
│  │  │  │
│  │  │  ├─ profile/
│  │  │  │  └─ page.tsx                   ← NEW (Avatar, email, password)
│  │  │  │
│  │  │  ├─ branch/
│  │  │  │  └─ page.tsx                   ← NEW (Multi-location config)
│  │  │  │
│  │  │  ├─ receipt/
│  │  │  │  └─ page.tsx                   ← NEW (Format, footer, logo)
│  │  │  │
│  │  │  ├─ printer/
│  │  │  │  └─ page.tsx                   ← NEW (Paper width, connection)
│  │  │  │
│  │  │  ├─ menu/
│  │  │  │  └─ page.tsx                   ← NEW (Categories, display)
│  │  │  │
│  │  │  ├─ payment/
│  │  │  │  └─ page.tsx                   ← NEW (Methods, gateway config)
│  │  │  │
│  │  │  ├─ qr/
│  │  │  │  └─ page.tsx                   ← NEW (Dynamic QR, table QR)
│  │  │  │
│  │  │  ├─ subscription/
│  │  │  │  └─ page.tsx                   ← NEW (Plan, usage, upgrade)
│  │  │  │
│  │  │  ├─ import/
│  │  │  │  └─ page.tsx                   ← REFACTOR (use import components)
│  │  │  │                                   Cleaner, uses extracted components
│  │  │  │
│  │  │  ├─ security/
│  │  │  │  └─ page.tsx                   ← NEW (2FA, sessions, delete)
│  │  │  │
│  │  │  └─ pwa/
│  │  │     └─ page.tsx                   ← NEW (Offline, installation)
│  │  │
│  │  └─ ... (other dashboard pages unchanged)
│  │
│  ├─ globals.css                         ← REFACTOR (add design system vars)
│  │                                          Color variables
│  │                                          Typography scales
│  │                                          Utility classes
│  │
│  └─ ... (other app files unchanged)
│
└─ components/
   ├─ ui/                                 ← NEW DESIGN SYSTEM
   │  ├─ Button.tsx                       ← 4 variants × 3 sizes × 5 states
   │  ├─ Card.tsx                         ← 4 variants
   │  ├─ Input.tsx                        ← 5 states
   │  ├─ Modal.tsx                        ← Header, body, footer
   │  ├─ Badge.tsx                        ← 4 variants × 2 sizes
   │  ├─ Alert.tsx                        ← 4 types
   │  ├─ Tooltip.tsx                      ← 4 positions
   │  ├─ Table.tsx                        ← Sortable, scrollable
   │  ├─ Dropdown.tsx                     ← Menu items, keyboard nav
   │  ├─ Select.tsx                       ← Options, multi-select
   │  ├─ Toast.tsx                        ← 4 types, all positions
   │  ├─ Tabs.tsx                         ← Tab navigation
   │  ├─ Pagination.tsx                   ← Prev/Next + numbers
   │  ├─ Skeleton.tsx                     ← 4 shape variants
   │  ├─ EmptyState.tsx                   ← Icon, heading, CTA
   │  ├─ ErrorState.tsx                   ← Error icon, message, retry
   │  └─ Confirmation.tsx                 ← Title, message, buttons
   │
   ├─ settings/                           ← NEW SETTINGS UTILITIES
   │  ├─ SettingsHeader.tsx               ← Page header with icon + title
   │  └─ SettingsCard.tsx                 ← Reusable settings card
   │
   ├─ profile/                            ← NEW PROFILE COMPONENTS
   │  ├─ ProfileDropdown.tsx              ← Navbar user menu
   │  ├─ ProfileCard.tsx                  ← Profile display card
   │  ├─ AccountSettings.tsx              ← Account info form
   │  ├─ PasswordChangeForm.tsx           ← Change password
   │  ├─ AvatarUploadCard.tsx             ← Avatar upload & preview
   │  └─ DeleteAccountModal.tsx           ← Delete with confirmation
   │
   ├─ sidebar/                            ← NEW REFACTORED SIDEBAR
   │  ├─ Sidebar.tsx                      ← Main sidebar (refactored)
   │  │                                      Collapsible groups
   │  │                                      Full collapse mode
   │  │                                      Mobile drawer
   │  ├─ SidebarGroup.tsx                 ← Group container (expand/collapse)
   │  ├─ SidebarItem.tsx                  ← Individual nav item
   │  ├─ SidebarCollapse.tsx              ← Collapse toggle button
   │  ├─ MobileDrawer.tsx                 ← Mobile menu (hamburger)
   │  └─ NavTooltip.tsx                   ← Tooltip for collapsed nav
   │
   ├─ layout/                             ← NEW LAYOUT COMPONENTS
   │  ├─ DashboardLayout.tsx              ← Main layout (sidebar + content)
   │  └─ Navbar.tsx                       ← Top navbar with profile dropdown
   │
   ├─ import/                             ← NEW IMPORT COMPONENTS
   │  ├─ ImportFlow.tsx                   ← Main import flow orchestrator
   │  ├─ ImportTypeSelector.tsx           ← Choose data type (products/etc)
   │  ├─ FileUploader.tsx                 ← Drag-drop file upload
   │  ├─ ColumnMapper.tsx                 ← Map CSV columns
   │  ├─ ImportPreview.tsx                ← Preview + validation
   │  ├─ ImportProgress.tsx               ← Real-time progress bar
   │  └─ ImportResult.tsx                 ← Success/error summary
   │
   ├─ DashboardSidebar.tsx                ← OLD (keep until refactored)
   ├─ DashboardShell.tsx                  ← OLD (keep until refactored)
   ├─ Modal.tsx                           ← OLD (keep as backup)
   ├─ Skeleton.tsx                        ← OLD (keep as backup)
   ├─ Toast.tsx                           ← OLD (keep as backup)
   │
   └─ ... (other existing components unchanged)
```

---

## 🎯 Priority: What to Create First

### Phase 1 (Week 1-2): Settings + Profile
```
Priority 1 - HIGH IMPACT:
├─ app/dashboard/settings/page.tsx (hub) ←START HERE
├─ app/dashboard/settings/business/page.tsx
├─ app/dashboard/settings/profile/page.tsx
├─ components/profile/ProfileDropdown.tsx
└─ components/profile/DeleteAccountModal.tsx

These 5 files give users immediate value:
- Better settings navigation
- Account management
- Quick profile access
```

### Phase 2 (Week 3-4): Sidebar + Import
```
Priority 2 - MEDIUM IMPACT:
├─ components/sidebar/Sidebar.tsx (refactored)
├─ components/sidebar/SidebarGroup.tsx
├─ components/sidebar/MobileDrawer.tsx
├─ components/import/*.tsx (all 7 components)
└─ app/dashboard/settings/import/page.tsx (refactored)

These improve navigation and data import significantly.
```

### Phase 3 (Week 5-6): Design System
```
Priority 3 - SYSTEM IMPROVEMENT:
├─ components/ui/Button.tsx
├─ components/ui/Card.tsx
├─ components/ui/Input.tsx
├─ components/ui/Modal.tsx
├─ ... (all 15+ components)
└─ app/globals.css (refactored)

These standardize the entire app.
```

---

## 📊 File Creation Checklist

### Settings Pages (12 files total)
```
Settings Hub:
  ✅ app/dashboard/settings/page.tsx (provided as code example)

Category Pages (11 more):
  🔲 app/dashboard/settings/business/page.tsx
  🔲 app/dashboard/settings/profile/page.tsx
  🔲 app/dashboard/settings/branch/page.tsx
  🔲 app/dashboard/settings/receipt/page.tsx
  🔲 app/dashboard/settings/printer/page.tsx
  🔲 app/dashboard/settings/menu/page.tsx
  🔲 app/dashboard/settings/payment/page.tsx
  🔲 app/dashboard/settings/qr/page.tsx
  🔲 app/dashboard/settings/subscription/page.tsx
  🔲 app/dashboard/settings/security/page.tsx
  🔲 app/dashboard/settings/pwa/page.tsx
  ✅ app/dashboard/settings/import/page.tsx (refactor existing)
```

### Profile Components (6 files)
```
  ✅ components/profile/ProfileDropdown.tsx (provided as code example)
  ✅ components/profile/DeleteAccountModal.tsx (included in ProfileDropdown)
  🔲 components/profile/AccountSettings.tsx
  🔲 components/profile/PasswordChangeForm.tsx
  🔲 components/profile/AvatarUploadCard.tsx
  🔲 components/profile/ProfileCard.tsx
```

### Sidebar Components (5 files)
```
  ✅ components/sidebar/Sidebar.tsx (provided as code example)
  🔲 components/sidebar/SidebarGroup.tsx
  🔲 components/sidebar/SidebarItem.tsx
  🔲 components/sidebar/MobileDrawer.tsx
  🔲 components/sidebar/NavTooltip.tsx
```

### Import Components (7 files)
```
  ✅ components/import/FileUploader.tsx (provided as code example)
  ✅ components/import/ImportTypeSelector.tsx (provided)
  ✅ components/import/ColumnMapper.tsx (provided)
  ✅ components/import/ImportPreview.tsx (provided)
  ✅ components/import/ImportProgress.tsx (provided)
  ✅ components/import/ImportResult.tsx (provided)
  🔲 components/import/ImportFlow.tsx (orchestrator)
```

### Layout Components (2 files)
```
  🔲 components/layout/DashboardLayout.tsx
  🔲 components/layout/Navbar.tsx
```

### Settings Utilities (2 files)
```
  🔲 components/settings/SettingsHeader.tsx
  🔲 components/settings/SettingsCard.tsx
```

### Design System Components (17 files)
```
  🔲 components/ui/Button.tsx
  🔲 components/ui/Card.tsx
  🔲 components/ui/Input.tsx
  🔲 components/ui/Modal.tsx
  🔲 components/ui/Badge.tsx
  🔲 components/ui/Alert.tsx
  🔲 components/ui/Tooltip.tsx
  🔲 components/ui/Table.tsx
  🔲 components/ui/Dropdown.tsx
  🔲 components/ui/Select.tsx
  🔲 components/ui/Toast.tsx
  🔲 components/ui/Tabs.tsx
  🔲 components/ui/Pagination.tsx
  🔲 components/ui/Skeleton.tsx
  🔲 components/ui/EmptyState.tsx
  🔲 components/ui/ErrorState.tsx
  🔲 components/ui/Confirmation.tsx
```

### Refactored/Updated Files (2 files)
```
  ✅ app/globals.css (refactor with design system)
  ✅ app/dashboard/settings/import/page.tsx (use new components)
```

**TOTAL: ~50 files**
- ✅ 8 files provided as code examples
- 🔲 42 files to create/refactor

---

## 🔄 Migration Path

### Safe Approach: Keep Old, Create New
```
Step 1: Create all new files alongside existing code
Step 2: New settings hub links to both old & new pages
Step 3: Test all new functionality
Step 4: Switch users to new versions
Step 5: Delete old components when confident

Benefits:
- Zero downtime
- Easy rollback if issues
- Parallel testing possible
- Users can switch gradually
```

### Fast Approach: Replace in-place
```
Step 1: Create feature branch
Step 2: Replace/refactor existing files
Step 3: Test thoroughly
Step 4: Deploy all at once

Benefits:
- Faster development
- Cleaner codebase
- No duplication

Risk:
- Potential downtime if issues
- Must test very thoroughly
```

**Recommendation: Use Safe Approach initially**

---

## 📍 File Dependencies

### Settings Hub Page
```
Depends on:
  → components/settings/SettingsHeader.tsx
  → (none - just links)

Provides:
  → Navigation to all category pages
```

### ProfileDropdown
```
Depends on:
  → Supabase client (lib/supabase/client)
  → getCurrentProfile (lib/getCurrentProfile)
  → Modal component (components/Modal)

Provides:
  → Quick profile access
  → Account deletion
  → All logout functionality
```

### Sidebar
```
Depends on:
  → components/sidebar/SidebarGroup.tsx
  → components/sidebar/SidebarItem.tsx
  → components/sidebar/MobileDrawer.tsx
  → components/sidebar/NavTooltip.tsx
  → lucide-react (icons)

Provides:
  → Main navigation
  → Mobile menu
  → Responsive layout
```

### Import Components
```
Depends on:
  → XLSX library (xlsx)
  → lucide-react (icons)
  → components/Modal

Provides:
  → Data import flow
  → Column mapping
  → Progress tracking
```

### Design System Components
```
Depends on:
  → Tailwind CSS
  → lucide-react (icons)
  → app/globals.css (variables)

Provides:
  → Standard UI elements
  → Consistent styling
  → Accessible components
```

---

## 🚀 Implementation Tips

### Tip 1: Start Small
```
✅ Start with Settings Hub (simplest)
  → Just a grid of links, very safe

✅ Then ProfileDropdown (visible to users)
  → Quick win, clear functionality

🔄 Then Sidebar (complex but important)
  → Affects entire app navigation

🔄 Then Import Components (parallelizable)
  → Can work on while testing sidebar

⏳ Then Design System (time-consuming)
  → Do while other areas are in QA
```

### Tip 2: Test Each Area
```
After completing Settings Hub:
  → Test all links
  → Check responsive layout
  → Verify no regressions

After ProfileDropdown:
  → Test dropdown open/close
  → Test all menu items
  → Test delete confirmation
  → Test logout

After Sidebar:
  → Test group toggle
  → Test sidebar collapse
  → Test mobile drawer
  → Test keyboard nav

After Import Components:
  → Test each component independently
  → Test full flow
  → Test error cases

After Design System:
  → Run full app audit
  → Check all pages use new components
  → Verify color consistency
  → Check accessibility
```

### Tip 3: Version Your Code
```
Good practice:
  components/ui/Button.tsx         ← New
  components/ui/ButtonLegacy.tsx  ← Keep old as backup

  app/globals.css                  ← Updated with variables
  app/globals-backup.css           ← Keep original

  After 1 week of success:
    Delete -backup and -legacy files
```

---

## 🎨 Folder Organization Principles

1. **By Feature** (current approach)
   ```
   settings/
   profile/
   sidebar/
   import/
   ui/
   ```
   ✅ Best for: Large codebases
   ✅ Makes it clear what goes where

2. **By Type** (alternative)
   ```
   components/pages/
   components/modals/
   components/forms/
   components/layouts/
   ```
   ⚠️ Not recommended - harder to locate related code

**Recommendation**: Stick with feature-based organization (current approach)

---

## 📝 File Naming Conventions

### Follow these patterns:

**Components** (PascalCase)
```
✅ ProfileDropdown.tsx
✅ ImportTypeSelector.tsx
✅ SidebarGroup.tsx
❌ profileDropdown.tsx (wrong)
❌ profile-dropdown.tsx (wrong)
```

**Pages** (lowercase, keep as page.tsx)
```
✅ app/dashboard/settings/page.tsx
✅ app/dashboard/settings/business/page.tsx
❌ SettingsPage.tsx (wrong)
❌ settings.tsx (wrong)
```

**Utilities/Hooks** (camelCase)
```
✅ useProfileContext.ts
✅ compressImage.ts
✅ calculateTotal.ts
❌ UseProfileContext.ts (wrong)
❌ CompressImage.ts (wrong)
```

**Styles/CSS** (kebab-case if separate files)
```
✅ components/Button.module.css
✅ components/ui/button.css
❌ components/ButtonStyles.css (wrong)
```

---

## 🔍 Quick Reference: Where Everything Goes

| What | Where | Why |
|------|-------|-----|
| Settings hub page | `app/dashboard/settings/page.tsx` | All other settings link from here |
| Business settings | `app/dashboard/settings/business/page.tsx` | Specific category page |
| Account dropdown | `components/profile/ProfileDropdown.tsx` | Used in navbar |
| Sidebar navigation | `components/sidebar/Sidebar.tsx` | Main layout component |
| Import flow | `components/import/` | Reusable throughout app |
| Design system | `components/ui/` | Used everywhere |
| Layout wrapper | `components/layout/DashboardLayout.tsx` | Wraps all dashboard pages |
| Global CSS | `app/globals.css` | Typography, colors, utilities |

---

## ✅ Final Organization Checklist

Before you start implementing:

- [ ] Review this file structure guide
- [ ] Create folder structure (don't create files yet)
- [ ] Copy provided code examples to right locations
- [ ] Update imports in existing files
- [ ] Verify no circular dependencies
- [ ] Test that app still builds
- [ ] Then start implementation by phase

---

## 📚 Related Documentation

- **README.md** - Overview of entire package
- **CAPOS_COMPONENT_RESTRUCTURING.md** - Detailed specifications
- **DESIGN_SYSTEM.md** - Component standards
- **IMPLEMENTATION_GUIDE.md** - Step-by-step timeline
- **FILE_STRUCTURE.md** - This file

**Read in this order**:
1. README.md (orientation)
2. This file (folder setup)
3. CAPOS_COMPONENT_RESTRUCTURING.md (what to build)
4. DESIGN_SYSTEM.md (how to build it)
5. IMPLEMENTATION_GUIDE.md (step-by-step)

---

**Ready to start? Create the folder structure and begin with Phase 1!**
