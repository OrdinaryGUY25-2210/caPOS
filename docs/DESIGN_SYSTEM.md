# caPOS Global Design System
**Status**: Phase 2A.2 §25 (98-100% completion)  
**Date**: September 2026

---

## Overview
This document defines the standardized UI components, states, colors, typography, and spacing used across all caPOS pages. All pages MUST implement all state variations (Loading → Loaded → Empty → Error → Success).

---

## 1. Color Palette

### Primary Colors
```
Primary: #6366F1 (Indigo)
  - primary-dark: #4F46E5
  - primary-light: #EEF2FF
  - primary-lighter: #F5F3FF

Success: #22C55E (Green)
  - success-dark: #16A34A
  - success-light: #DBEAFE

Warning: #F59E0B (Amber)
  - warning-dark: #D97706
  - warning-light: #FEF3C7

Urgent: #EF4444 (Red)
  - urgent-dark: #DC2626
  - urgent-light: #FEE2E2

Neutral: #F3F4F6 to #111827 (Gray scale)
  - neutral-50: #F9FAFB
  - neutral-100: #F3F4F6
  - neutral-200: #E5E7EB
  - ...
  - neutral-900: #111827
```

### Usage
- **Primary**: CTAs, active states, highlights
- **Success**: Confirmation, checkmarks, completed actions
- **Warning**: Important notifications, limited items
- **Urgent**: Errors, deletions, critical warnings
- **Neutral**: Text, borders, backgrounds

---

## 2. Typography Scale

### Headings
```
H1: 32px | font-weight: 700 | line-height: 1.2
H2: 24px | font-weight: 600 | line-height: 1.3
H3: 20px | font-weight: 600 | line-height: 1.4
H4: 16px | font-weight: 600 | line-height: 1.5
H5: 14px | font-weight: 600 | line-height: 1.5
H6: 12px | font-weight: 600 | line-height: 1.6
```

### Body Text
```
Large (lg): 16px | font-weight: 400 | line-height: 1.6
Base: 14px | font-weight: 400 | line-height: 1.6
Small (sm): 12px | font-weight: 400 | line-height: 1.5
Extra Small (xs): 11px | font-weight: 400 | line-height: 1.4
```

### Font Weights
- Regular: 400
- Medium: 500
- Semibold: 600
- Bold: 700

---

## 3. Core Components

### 3.1 Buttons

**Variants**:
- Primary (default action)
- Secondary (alternative action)
- Outline (tertiary action)
- Danger (destructive action)

**Sizes**:
- Small: 32px height
- Medium: 40px height
- Large: 48px height

**States** (per variant):
- Default
- Hover
- Active
- Disabled (opacity: 0.6)
- Loading (spinner + disabled)

```tsx
// Primary Button
<button className="btn-primary">Action</button>

// Secondary Button
<button className="btn-secondary">Cancel</button>

// Outline Button
<button className="btn-outline">Maybe</button>

// Danger Button
<button className="btn-danger">Delete</button>

// Sizes
<button className="btn-primary text-xs px-2 py-1">Small</button>
<button className="btn-primary text-sm px-3 py-2">Medium</button>
<button className="btn-primary text-base px-4 py-3">Large</button>

// Loading State
<button className="btn-primary disabled">
  <Loader2 className="animate-spin" size={16} />
  Loading...
</button>
```

### 3.2 Cards

**Structure**:
- Container with border, rounded corners, shadow
- Padding: 16px (p-4) to 20px (p-5)
- Border: 1px solid neutral-200
- Shadow: 0 1px 3px rgba(0,0,0,0.1)

**Variants**:
- Default (white background)
- Highlighted (bg-primary-light)
- Danger (bg-urgent-light, border-urgent/30)
- Success (bg-success-light, border-success/30)

```tsx
<div className="card p-4">
  <h3 className="font-semibold">Card Title</h3>
  <p className="text-sm text-neutral-600">Card content</p>
</div>

<div className="card p-4 bg-primary-light">
  <p>Highlighted card</p>
</div>
```

### 3.3 Input Fields

**States**:
- Default
- Focus (border-primary, shadow)
- Disabled (opacity: 0.6)
- Error (border-urgent)
- Success (border-success)

**Structure**:
- Height: 40px
- Padding: 8px 12px
- Font: 14px
- Placeholder color: neutral-400

```tsx
<input
  type="text"
  placeholder="Enter value"
  className="input-field"
/>

<input
  type="text"
  className="input-field border-urgent"
  value="Error state"
/>
```

### 3.4 Tables

**Header**:
- Background: neutral-50
- Font weight: 500
- Font size: 12px
- Color: neutral-500
- Sticky top (for scrolling)

**Body Rows**:
- Border bottom: 1px solid neutral-100
- Hover: bg-neutral-50
- Padding: 12px 3px

**Column Alignment**:
- Text/name: left
- Numbers: right
- Actions: center

```tsx
<div className="card overflow-hidden">
  <div className="overflow-x-auto max-h-96 overflow-y-auto">
    <table className="w-full text-sm">
      <thead className="bg-neutral-50 sticky top-0">
        <tr>
          <th className="text-left px-3 py-2 font-medium text-neutral-500">
            Column
          </th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-neutral-100 hover:bg-neutral-50">
          <td className="px-3 py-2">Data</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

### 3.5 Modal

**Structure**:
- Overlay: bg-black/50
- Modal container: bg-white, rounded-lg, shadow-lg
- Header: border-bottom, padding-bottom
- Body: scrollable, max-height: 80vh
- Footer: border-top, button group

```tsx
<Modal
  title="Modal Title"
  onClose={() => setOpen(false)}
  footer={
    <div className="flex gap-2">
      <button className="btn-outline flex-1">Cancel</button>
      <button className="btn-primary flex-1">Confirm</button>
    </div>
  }
>
  <p>Modal content goes here</p>
</Modal>
```

### 3.6 Badge / Tags

**Variants**:
- Active (bg-primary, text-white)
- Warning (bg-warning, text-warning-dark)
- Urgent (bg-urgent, text-white)
- Success (bg-success, text-white)
- Neutral (bg-neutral-100, text-neutral-700)

**Sizes**:
- Small: 12px font, 4px 8px padding
- Medium: 14px font, 6px 12px padding

```tsx
<span className="badge-active">Active</span>
<span className="badge-warning">Pending</span>
<span className="badge-urgent">Error</span>
```

### 3.7 Alert

**Structure**:
- Padding: 12px 16px
- Border left: 4px solid (color-coded)
- Icon on left, message, close button on right

**Variants**:
- Info (border-primary)
- Success (border-success)
- Warning (border-warning)
- Error (border-urgent)

```tsx
<div className="flex items-start gap-3 p-3 rounded-lg border-l-4 border-primary bg-primary-light">
  <Info size={18} className="text-primary mt-0.5 flex-shrink-0" />
  <div className="flex-1">
    <p className="text-sm font-medium text-primary">Information</p>
    <p className="text-xs text-primary/80">Message content</p>
  </div>
  <button className="text-primary/60 hover:text-primary">
    <X size={14} />
  </button>
</div>
```

### 3.8 Toast / Notification

**Positions**:
- Top right (default)
- Top left
- Bottom right
- Bottom left

**Auto-dismiss**: 3-5 seconds

**Variants**:
- Success (green)
- Error (red)
- Warning (amber)
- Info (blue)

```tsx
toast.success("Action completed!");
toast.error("Something went wrong");
toast.warning("Please review this");
toast.info("Information message");
```

### 3.9 Tooltip

**Positions**:
- Top
- Bottom
- Left
- Right

**On collapse state**: Show tooltip on hover for truncated items

```tsx
<Tooltip text="Full text here" position="top">
  <button>Hover me</button>
</Tooltip>
```

### 3.10 Dropdown / Select

**Open State**:
- Box shadow on menu
- Items have hover background
- Selected item highlighted

**Keyboard Navigation**:
- Arrow keys: navigate
- Enter: select
- Escape: close

```tsx
<select className="input-field">
  <option>Option 1</option>
  <option>Option 2</option>
</select>
```

### 3.11 Pagination

**Structure**:
- Previous/Next buttons
- Page numbers (show 5 max, ellipsis for hidden)
- Current page highlighted

```tsx
<div className="flex items-center gap-1">
  <button className="btn-outline px-2 py-1">Prev</button>
  <button className="bg-primary text-white px-3 py-1 rounded">1</button>
  <button className="btn-outline px-3 py-1">2</button>
  <span className="px-2">...</span>
  <button className="btn-outline px-2 py-1">Next</button>
</div>
```

### 3.12 Skeleton Loader

**Shape Variants**:
- Text: full-width rectangular bar
- Avatar: circular
- Card: multiple text bars with large area
- Table row: multiple text bars

**Animation**: Shimmer effect (left to right)

```tsx
<div className="space-y-3">
  <Skeleton className="h-4 w-full" />
  <Skeleton className="h-4 w-5/6" />
  <Skeleton className="h-4 w-4/6" />
</div>
```

### 3.13 Empty State

**Components**:
- Icon (large, 64px, neutral-300)
- Heading (bold, neutral-900)
- Description (neutral-600)
- CTA button (optional)

```tsx
<div className="text-center py-12">
  <Coffee size={64} className="mx-auto text-neutral-300 mb-3" />
  <h3 className="font-semibold text-neutral-900">No items yet</h3>
  <p className="text-sm text-neutral-600 mt-1">
    Create your first item to get started
  </p>
  <button className="btn-primary mt-4">Create Item</button>
</div>
```

### 3.14 Error State

**Components**:
- Icon (AlertTriangle, 64px, urgent)
- Heading (bold, urgent)
- Error message (neutral-600)
- Retry button

```tsx
<div className="text-center py-12">
  <AlertTriangle size={64} className="mx-auto text-urgent mb-3" />
  <h3 className="font-semibold text-neutral-900">Something went wrong</h3>
  <p className="text-sm text-neutral-600 mt-1">{{ error message }}</p>
  <button className="btn-primary mt-4">Try again</button>
</div>
```

### 3.15 Confirmation Modal

**Structure**:
- Clear title (question phrasing)
- Description of action
- Confirm button (danger-colored if destructive)
- Cancel button

```tsx
<Modal
  title="Delete item?"
  footer={
    <div className="flex gap-2">
      <button className="btn-outline flex-1">Cancel</button>
      <button className="bg-urgent text-white flex-1 rounded-lg">
        Delete Permanently
      </button>
    </div>
  }
>
  <p className="text-sm">
    This action cannot be undone. All associated data will be deleted.
  </p>
</Modal>
```

---

## 4. Page States (CRITICAL)

**Every page MUST implement all 5 states:**

### 4.1 Loading State
```
- Show skeleton loaders
- Disable all interactive elements
- Optional: loading message ("Loading data...")
- Duration: Until data arrives
```

```tsx
if (loading) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
```

### 4.2 Loaded State
```
- Display actual data
- All interactions enabled
- Normal UI
- Duration: Until user action or data change
```

```tsx
if (data) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{data.title}</h1>
      <div className="card p-4">{/* data rendering */}</div>
    </div>
  );
}
```

### 4.3 Empty State
```
- When: No data matches filter/query
- Show: Icon, heading, description
- CTA: Create first item or adjust filters
- Duration: Until user creates item or changes filters
```

```tsx
if (data.length === 0) {
  return (
    <div className="text-center py-12">
      <Coffee size={64} className="mx-auto text-neutral-300 mb-3" />
      <h3 className="font-semibold">No items found</h3>
      <p className="text-sm text-neutral-600">Create your first item</p>
      <button className="btn-primary mt-4">Create</button>
    </div>
  );
}
```

### 4.4 Error State
```
- When: Data fetch fails, action fails
- Show: Error icon, message, retry button
- Allow: Back button, dismiss, retry
- Duration: Until retry succeeds or user navigates away
```

```tsx
if (error) {
  return (
    <div className="text-center py-12">
      <AlertTriangle size={64} className="mx-auto text-urgent mb-3" />
      <h3 className="font-semibold">Failed to load</h3>
      <p className="text-sm text-neutral-600">{error.message}</p>
      <button className="btn-primary mt-4" onClick={retry}>
        Retry
      </button>
    </div>
  );
}
```

### 4.5 Success State
```
- When: Action completed successfully
- Show: Checkmark, success message, next action
- Duration: 2-3 seconds (or permanent if user confirmation needed)
- Auto-dismiss: Toast notification with auto-hide
- Permanent: Modal or page state requiring acknowledgment
```

```tsx
if (success) {
  return (
    <div className="card p-6 text-center bg-success-light border border-success">
      <CheckCircle2 size={48} className="mx-auto text-success mb-3" />
      <h3 className="font-semibold text-neutral-900">
        Action completed successfully
      </h3>
      <p className="text-sm text-neutral-600 mt-1">
        Your changes have been saved
      </p>
      <button className="btn-primary mt-4">Continue</button>
    </div>
  );
}
```

---

## 5. Spacing System

**Base Unit**: 4px

```
0: 0
1: 4px
2: 8px
3: 12px
4: 16px
5: 20px
6: 24px
8: 32px
10: 40px
12: 48px
```

**Usage**:
- Padding: p-3, p-4, p-5
- Margin: m-2, m-4, m-6
- Gap: gap-2, gap-3, gap-4
- Space-y: space-y-2, space-y-4, space-y-6

---

## 6. Border Radius

```
sm: 4px
md: 6px
lg: 8px
xl: 12px (default for cards)
2xl: 16px
full: 9999px (circles)
```

---

## 7. Shadows

```
None: no shadow
sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05)
md: 0 4px 6px -1px rgba(0, 0, 0, 0.1)  ← default card
lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1)
xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1) ← modal
```

---

## 8. Transitions

```
Fade: opacity 200ms
Slide: transform 200ms cubic-bezier(0.4, 0, 0.2, 1)
Color: color 150ms
Default: 200ms
```

---

## 9. Responsive Breakpoints

```
Mobile: < 640px
Tablet: 640px - 1024px
Desktop: > 1024px

Utility prefix:
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
```

---

## 10. Accessibility Requirements

### Text Contrast
- Normal text: minimum 4.5:1 contrast ratio
- Large text: minimum 3:1 contrast ratio

### Interactive Elements
- Minimum 44×44px touch target
- Focus states visible (outline or background)
- Keyboard navigation support
- ARIA labels where appropriate

### Color
- Don't rely on color alone to convey meaning
- Always pair color with icons/text

### Motion
- Respect `prefers-reduced-motion`
- No auto-playing animations > 5 seconds

---

## 11. Implementation Checklist

### For Every Page
- [ ] Loading skeleton
- [ ] Loaded data display
- [ ] Empty state (if applicable)
- [ ] Error state with retry
- [ ] Success state feedback
- [ ] All buttons have accessible labels
- [ ] Forms have proper labels
- [ ] Keyboard navigation works
- [ ] Touch targets ≥ 44px
- [ ] Responsive mobile layout

### For Every Component
- [ ] Default state
- [ ] Hover state (if clickable)
- [ ] Active state
- [ ] Disabled state
- [ ] Focus state (for keyboard nav)
- [ ] Error state
- [ ] Loading state (if async)
- [ ] Consistent with design system
- [ ] Accessible color contrast
- [ ] Mobile responsive

---

## 12. CSS Classes Reference

### Buttons
- `.btn-primary` - Primary action
- `.btn-secondary` - Secondary action
- `.btn-outline` - Tertiary action
- `.btn-danger` - Destructive action

### Cards
- `.card` - Standard card styling
- `.card:hover` - Hover effect

### Forms
- `.input-field` - Input styling
- `.input-field:focus` - Focus state

### Badges
- `.badge-active` - Active status
- `.badge-warning` - Warning status
- `.badge-urgent` - Error status

### Layout
- `.container` - Max width wrapper
- `.grid` - CSS Grid
- `.flex` - Flexbox

---

## 13. Resources

- **Font**: Inter (system font stack)
- **Icons**: Lucide React
- **Tailwind CSS**: Utility-first CSS framework
- **Color Codes**: See section 1

---

## Notes

- This design system is **living documentation**
- Updates must be approved before implementation
- New component? Add to this document first
- Deviations require design review
- Mobile-first approach (design for mobile, enhance for desktop)
