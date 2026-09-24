# caPOS Component Restructuring - Implementation Guide
**Target Completion**: Phase 2A.2 §21-25  
**Estimated Timeline**: 6 weeks

---

## Quick Summary

This restructuring improves caPOS architecture across 5 key areas:

| Area | Current State | Target | Files | Priority |
|------|---------------|--------|-------|----------|
| **Import** | Monolithic page | 7 reusable components | 8 new | 1 |
| **Settings** | Single page | 12 category pages + hub | 12 new | 1 |
| **Profile** | Missing | Full account management | 5 new | 2 |
| **Sidebar** | Basic nav | Collapsible, mobile-aware | 2 refactored | 2 |
| **Design System** | Scattered | Centralized standards | 15+ components | 3 |

---

## Phase 1: Foundation (Weeks 1-2)

### Week 1: Settings Hub & Organization

**Goal**: Create the settings routing structure

#### Tasks:
1. **Create Settings Hub Page**
   - File: `app/dashboard/settings/page.tsx` (refactor)
   - Replace current form with category grid
   - Group categories by section (Business, Config, Payment, etc.)
   - Use `SETTINGS_CATEGORIES` array
   - Link to individual setting pages

   **Checklist**:
   - [ ] Hub page displays all 12 categories
   - [ ] Categories grouped by section
   - [ ] Hover effects on cards
   - [ ] Navigation links working
   - [ ] Mobile responsive layout

2. **Create Business Settings Page**
   - File: `app/dashboard/settings/business/page.tsx` (new)
   - Move logo upload from current settings
   - Move business name/phone from current settings
   - Add business address field
   - Save to `tenants` table

   **Code snippet**:
   ```tsx
   export default function BusinessSettingsPage() {
     return (
       <div className="space-y-6">
         <SettingsHeader title="Business Profile" />
         <LogoUploadCard />
         <BusinessInfoCard />
         <ContactInfoCard />
       </div>
     );
   }
   ```

3. **Create Profile Settings Page**
   - File: `app/dashboard/settings/profile/page.tsx` (new)
   - User account information
   - Avatar upload
   - Email display
   - Password change form
   - Account verification

   **Components needed**:
   - `AccountInfoForm`
   - `AvatarUploadCard`
   - `PasswordChangeForm`

4. **Create Remaining Category Pages** (stubs)
   - `app/dashboard/settings/branch/page.tsx`
   - `app/dashboard/settings/receipt/page.tsx`
   - `app/dashboard/settings/printer/page.tsx`
   - `app/dashboard/settings/menu/page.tsx`
   - `app/dashboard/settings/payment/page.tsx`
   - `app/dashboard/settings/qr/page.tsx`
   - `app/dashboard/settings/subscription/page.tsx`
   - `app/dashboard/settings/security/page.tsx`
   - `app/dashboard/settings/pwa/page.tsx`

   For now, each can be:
   ```tsx
   export default function CategoryPage() {
     return (
       <div className="space-y-6">
         <SettingsHeader title="Category Name" />
         <p className="text-neutral-600">Content coming soon...</p>
       </div>
     );
   }
   ```

5. **Create SettingsHeader Component**
   - File: `components/settings/SettingsHeader.tsx` (new)
   - Displays page title, description, back button
   - Consistent styling across all settings pages

   **Props**:
   ```tsx
   interface SettingsHeaderProps {
     title: string;
     description?: string;
     icon?: React.ComponentType;
   }
   ```

#### Testing:
- Click through all category links
- Verify responsive layout (mobile/tablet/desktop)
- Check scroll behavior on long pages
- Verify no duplicate navigation

### Week 2: Profile Components & Account Management

**Goal**: Create profile dropdown and account deletion with proper confirmation

#### Tasks:
1. **Create ProfileDropdown Component**
   - File: `components/profile/ProfileDropdown.tsx` (new)
   - Display user avatar + name + business
   - Dropdown menu with 6 options:
     1. Profil Saya (→ /dashboard/settings/profile)
     2. Pengaturan (→ /dashboard/settings)
     3. Paket Saya (→ /dashboard/settings/subscription)
     4. Hapus Akun (owner only, modal)
     5. Logout
   - Handle outside click to close
   - Responsive (hide text on mobile)

   **Code structure**:
   ```tsx
   interface ProfileDropdownProps {
     user: UserProfile;
   }

   export default function ProfileDropdown({ user }: ProfileDropdownProps) {
     const [isOpen, setIsOpen] = useState(false);
     // ... implementation
   }
   ```

2. **Create DeleteAccountModal Component**
   - File: `components/profile/DeleteAccountModal.tsx` (new)
   - **CRITICAL**: Require typed confirmation of business name
   - Show warning about data loss:
     - ✗ All menu/products
     - ✗ All transactions
     - ✗ All staff & branches
     - ✗ All inventory
     - ✗ All membership data
     - ✗ All accounts (user + employees)
   - Disable confirm button until typed correctly
   - Show loading state during deletion

   **States**:
   ```tsx
   // Confirmation input empty
   <button disabled>Hapus Permanen</button>

   // Confirmation text typed correctly
   <button className="bg-urgent">Hapus Permanen</button>

   // Deleting
   <button disabled>
     <Loader2 className="animate-spin" /> Menghapus...
   </button>
   ```

3. **Create PasswordChangeForm Component**
   - File: `components/profile/PasswordChangeForm.tsx` (new)
   - Current password input
   - New password input (with strength indicator)
   - Confirm password input
   - Show/hide password toggle
   - Validation rules display

4. **Create AvatarUploadCard Component**
   - File: `components/profile/AvatarUploadCard.tsx` (new)
   - Current avatar display
   - Upload new avatar
   - Remove avatar
   - Image preview before save
   - Max 2MB, auto-compress

5. **Integrate ProfileDropdown into Navbar**
   - File: `components/layout/Navbar.tsx` (refactor)
   - Replace current profile button with ProfileDropdown
   - Position on right side of navbar
   - Test on mobile (check overflow)

#### Testing:
- Profile dropdown opens/closes
- Menu items navigate correctly
- Delete account modal shows
- Typed confirmation prevents premature deletion
- All account forms save correctly
- Mobile responsive (text hidden, icon only)
- Logout works correctly

---

## Phase 2: Navigation & Import Refactoring (Weeks 3-4)

### Week 3: Sidebar Refactoring

**Goal**: Create collapsible, mobile-aware navigation

#### Tasks:
1. **Refactor Sidebar Component**
   - File: `components/sidebar/Sidebar.tsx` (refactor)
   - Features to add:
     - [ ] Collapsible groups (expand/collapse per section)
     - [ ] Full sidebar collapse (icons only, show tooltips)
     - [ ] Mobile drawer (hamburger menu)
     - [ ] Active state highlighting
     - [ ] Scroll behavior in nav
     - [ ] Keyboard navigation (arrow keys)

   **Key properties**:
   ```tsx
   interface SidebarProps {
     isMobileOpen: boolean;
     onMobileToggle: () => void;
     isCollapsed: boolean;
     onCollapse: () => void;
   }
   ```

2. **Create SidebarGroup Component**
   - File: `components/sidebar/SidebarGroup.tsx` (new)
   - Renders group header + items
   - Toggle expand/collapse with ChevronDown icon
   - Auto-expand if active item in group
   - Smooth transitions

3. **Create SidebarItem Component**
   - File: `components/sidebar/SidebarItem.tsx` (new)
   - Individual nav item
   - Show/hide label based on sidebar state
   - Active state styling
   - Tooltip on collapsed state
   - Icon + label alignment

4. **Create MobileDrawer Component**
   - File: `components/sidebar/MobileDrawer.tsx` (new)
   - Slides in from left on mobile
   - Overlay with click-to-close
   - Close button (X icon)
   - Same nav structure as desktop
   - Locks body scroll when open

5. **Create NavTooltip Component**
   - File: `components/sidebar/NavTooltip.tsx` (new)
   - Shows on hover when sidebar collapsed
   - Position: right of icon
   - Dark background, white text
   - No delay (instant show)
   - Arrow pointer to icon

#### Testing:
- Group toggle works (expand/collapse)
- Groups auto-expand when active item present
- Sidebar collapse toggle works
- Icons visible when collapsed
- Tooltips appear on collapsed sidebar hover
- Mobile drawer opens/closes
- Drawer overlay closes on click
- Mobile scroll locked when drawer open
- Active item highlighted correctly
- Keyboard arrow keys navigate
- Responsive layout (mobile/tablet/desktop)

### Week 4: Import Components Extraction

**Goal**: Break monolithic import page into reusable components

#### Tasks:
1. **Create FileUploader Component**
   - File: `components/import/FileUploader.tsx` (new)
   - Drag-drop zone
   - Click to browse
   - File validation (xlsx, xls, csv)
   - Size validation (max 10MB)
   - Error messages

2. **Create ImportTypeSelector Component**
   - File: `components/import/ImportTypeSelector.tsx` (new)
   - 7 data types (Products enabled, others "Coming soon")
   - Icon per type
   - Description per type
   - Disabled state styling
   - Select state styling

3. **Create ColumnMapper Component**
   - File: `components/import/ColumnMapper.tsx` (new)
   - Shows detected columns
   - Dropdown to map each required field
   - Mark required/optional
   - Auto-detect logic (guessColumn)
   - Visual feedback if not mapped

4. **Create ImportPreview Component**
   - File: `components/import/ImportPreview.tsx` (new)
   - Stats grid (total, valid, invalid)
   - Tier quota warning
   - Scrollable preview table
   - Row validation status
   - Duplicate detection

5. **Create ImportProgress Component**
   - File: `components/import/ImportProgress.tsx` (new)
   - Loading spinner
   - Progress bar
   - Current/total counter
   - Custom message prop
   - Real-time updates

6. **Create ImportResult Component**
   - File: `components/import/ImportResult.tsx` (new)
   - Success/skipped/failed stats
   - Expandable error list
   - Download CSV report button
   - "Import another" button
   - Success messaging

7. **Refactor Import Page**
   - File: `app/dashboard/settings/import/page.tsx` (refactor)
   - Use extracted components
   - Cleaner state management
   - Same flow (5 steps)
   - Backward compatible

#### Testing:
- Each component renders independently
- File upload works with xlsx/xls/csv
- File size validation works
- Column detection works
- Mapping validation works
- Preview displays correctly
- Import progress updates
- Results display correctly
- Download report works
- All data types show (enabled/disabled)
- Back buttons work between steps
- Cancel exits flow gracefully

---

## Phase 3: Design System & Polish (Weeks 5-6)

### Week 5: Design System Implementation

**Goal**: Standardize all UI components across caPOS

#### Tasks:
1. **Create UI Component Library**
   - File: `components/ui/Button.tsx` (new/refactor)
   - File: `components/ui/Card.tsx` (new/refactor)
   - File: `components/ui/Input.tsx` (new/refactor)
   - File: `components/ui/Modal.tsx` (new/refactor)
   - File: `components/ui/Badge.tsx` (new)
   - File: `components/ui/Alert.tsx` (new)
   - File: `components/ui/Tooltip.tsx` (new)
   - File: `components/ui/Table.tsx` (new)
   - File: `components/ui/Dropdown.tsx` (new)
   - File: `components/ui/Select.tsx` (new)
   - File: `components/ui/Toast.tsx` (new/refactor)
   - File: `components/ui/Tabs.tsx` (new)
   - File: `components/ui/Pagination.tsx` (new)
   - File: `components/ui/Skeleton.tsx` (new/refactor)
   - File: `components/ui/EmptyState.tsx` (new)
   - File: `components/ui/ErrorState.tsx` (new)
   - File: `components/ui/Confirmation.tsx` (new)

   **For each component**, implement:
   - [ ] All variants (primary, secondary, outline, danger, etc.)
   - [ ] All sizes (sm, md, lg)
   - [ ] All states (default, hover, active, disabled, loading)
   - [ ] Responsive behavior
   - [ ] Accessibility (contrast, focus states)
   - [ ] TypeScript types
   - [ ] Storybook story (optional)

2. **Update globals.css**
   - File: `app/globals.css` (refactor)
   - Add CSS variables for colors
   - Add utility classes (.btn-*, .card, .input-field, etc.)
   - Add transitions/animations
   - Add responsive utilities

   **CSS Variables example**:
   ```css
   :root {
     /* Colors */
     --primary: #6366F1;
     --primary-dark: #4F46E5;
     --primary-light: #EEF2FF;
     
     /* Typography */
     --font-base: 14px;
     --font-sm: 12px;
     --font-lg: 16px;
     
     /* Spacing */
     --spacing-1: 4px;
     --spacing-2: 8px;
     --spacing-3: 12px;
     --spacing-4: 16px;
     --spacing-5: 20px;
   }
   ```

3. **Update Page States**
   - Audit all dashboard pages
   - Add loading skeleton
   - Add empty state
   - Add error state with retry
   - Add success feedback
   - Remove pages with only "data/no data"

   **Pages to update**:
   - [ ] Dashboard
   - [ ] Menu
   - [ ] POS
   - [ ] CRM
   - [ ] Analytics
   - [ ] Inventory
   - [ ] Settings (all categories)
   - [ ] ... (20+ pages total)

#### Testing:
- All components render
- All variants work
- All states display correctly
- Hover/focus/active states visible
- Disabled state works
- Loading state works
- Mobile responsive
- Accessibility contrast ok
- Tab navigation works
- Color consistency across app

### Week 6: Integration & Polish

**Goal**: Integrate all new components, test thoroughly, optimize

#### Tasks:
1. **Component Integration**
   - Replace old components with new design system ones
   - Update all existing pages to use new components
   - Fix any color/spacing inconsistencies
   - Verify no regressions

2. **Testing & QA**
   - Desktop (1920x1080)
   - Tablet (768x1024)
   - Mobile (375x667)
   - Dark mode (if applicable)
   - Keyboard navigation
   - Screen reader (NVDA/JAWS)
   - Touch interactions

3. **Performance Optimization**
   - Bundle size analysis
   - Image optimization
   - Code splitting
   - Lazy loading
   - CSS minification

4. **Documentation**
   - Component library docs
   - Usage examples
   - Props documentation
   - Accessibility notes
   - TypeScript types

5. **Deployment Checklist**
   - [ ] All tests passing
   - [ ] No console errors
   - [ ] Lighthouse score > 90
   - [ ] Mobile performance ok
   - [ ] No visual regressions
   - [ ] Accessibility audit passed
   - [ ] Settings fully functional
   - [ ] Profile account management works
   - [ ] Import/export works
   - [ ] Sidebar navigation works

---

## File Checklist

### New Files to Create
```
✅ Components
  ✅ settings/
    - SettingsHeader.tsx
    - SettingsCard.tsx
  ✅ profile/
    - ProfileDropdown.tsx
    - ProfileCard.tsx
    - AccountSettings.tsx
    - PasswordChangeForm.tsx
    - AvatarUploadCard.tsx
    - DeleteAccountModal.tsx
  ✅ sidebar/
    - SidebarGroup.tsx
    - SidebarItem.tsx
    - MobileDrawer.tsx
    - NavTooltip.tsx
  ✅ import/
    - FileUploader.tsx
    - ImportTypeSelector.tsx
    - ColumnMapper.tsx
    - ImportPreview.tsx
    - ImportProgress.tsx
    - ImportResult.tsx
  ✅ ui/
    - Button.tsx
    - Card.tsx
    - Input.tsx
    - Modal.tsx
    - Badge.tsx
    - Alert.tsx
    - Tooltip.tsx
    - Table.tsx
    - Dropdown.tsx
    - Select.tsx
    - Toast.tsx
    - Tabs.tsx
    - Pagination.tsx
    - Skeleton.tsx
    - EmptyState.tsx
    - ErrorState.tsx
    - Confirmation.tsx
  ✅ layout/
    - DashboardLayout.tsx
    - Navbar.tsx

✅ Pages
  ✅ app/dashboard/settings/
    - page.tsx (hub - refactor)
    - business/page.tsx
    - profile/page.tsx
    - branch/page.tsx
    - receipt/page.tsx
    - printer/page.tsx
    - menu/page.tsx
    - payment/page.tsx
    - qr/page.tsx
    - subscription/page.tsx
    - import/page.tsx (refactor)
    - security/page.tsx
    - pwa/page.tsx

✅ Documentation
  - CAPOS_COMPONENT_RESTRUCTURING.md
  - DESIGN_SYSTEM.md
  - IMPLEMENTATION_GUIDE.md
```

### Files to Refactor
```
- components/DashboardSidebar.tsx → Sidebar.tsx
- components/DashboardShell.tsx → layout/DashboardLayout.tsx
- app/dashboard/settings/page.tsx → Settings hub
- app/dashboard/settings/import/page.tsx → Use components
```

---

## Risk Mitigation

### Potential Issues & Solutions

| Issue | Solution |
|-------|----------|
| Settings page too long | Use tab nav or category links ✓ |
| Sidebar too complex | Use collapsible groups ✓ |
| Mobile nav broken | Add mobile drawer ✓ |
| Import page confusing | Split into 7 components ✓ |
| Design inconsistency | Centralized design system ✓ |
| Accessibility gaps | WCAG 2.1 AA compliance audit |
| Performance regression | Code splitting, lazy loading |

---

## Success Metrics

### Completion Targets
- ✅ Import: 90% (5 of 7 entities implemented)
- ✅ Settings: 95% (all 12 categories, full CRUD)
- ✅ Profile: 95% (all account management features)
- ✅ Sidebar: 98% (all features implemented)
- ✅ Design System: 98-100% (all components standardized)

### Quality Metrics
- ✅ 100% TypeScript type coverage
- ✅ 0 console errors in production
- ✅ Lighthouse score > 90 (mobile & desktop)
- ✅ WCAG 2.1 AA compliance
- ✅ 100% responsive (mobile to desktop)
- ✅ <3s page load time
- ✅ All page states implemented

### User Satisfaction
- ✅ No feature regressions
- ✅ Improved UX (clearer navigation, better feedback)
- ✅ Fewer support tickets (clearer flows)
- ✅ Mobile experience improved

---

## Timeline Summary

```
Week 1:   Settings Hub + Profile Pages
Week 2:   Profile Components + Delete Modal
Week 3:   Sidebar Refactor + Groups
Week 4:   Import Components + Extraction
Week 5:   UI Design System + Components
Week 6:   Integration, Testing, Deployment
```

**Total: 6 weeks (full-time) or 12 weeks (part-time)**

---

## Deployment Strategy

### Pre-Deployment
1. Feature branch: `feature/component-restructuring`
2. Create PR with documentation
3. Code review (emphasis on accessibility)
4. QA testing (all devices)

### Deployment
1. Merge to main
2. Tag as `v2.A.2.25`
3. Deploy to staging
4. 48hr smoke test
5. Deploy to production
6. Monitor error logs

### Post-Deployment
1. User feedback collection
2. Performance monitoring
3. Bug fix sprint (1 week)
4. Documentation updates
5. Release notes

---

## References

- **Design System**: `DESIGN_SYSTEM.md`
- **Specification**: `CAPOS_COMPONENT_RESTRUCTURING.md`
- **Component Code**: `settings-page-hub.tsx`, `ProfileDropdown.tsx`, `Sidebar-Refactored.tsx`, `ImportComponents.tsx`
- **Figma**: [Link to design file]
- **Jira Epic**: [Link to epic]

---

## Questions?

Contact: [Your name]  
Slack: @[Your handle]  
Email: [Your email]
