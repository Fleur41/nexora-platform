# Accessibility audit (Phase 7, October 2026)

Target: **WCAG 2.1 level AA** for everything people use: the public site, sign-in, the
landlord dashboard, the tenant app and the platform console.

## How it was audited

1. **Automated: axe-core** (`@axe-core/playwright`, rules tagged wcag2a/2aa/21a/21aa) on 43
   screens with realistic data:
   - **Public site:** home, sign-in, registration, forgotten password, listings, a listing.
   - **Dashboard:** all 22 pages, plus the detail pages of a property, tenant, lease, invoice,
     payment, repair, inspection and move-out, and a form dialog.
   - **Tenant app:** home, bills, a bill, pay, repairs and move-out, at phone size.
   - **Platform console:** organizations, an organization, invoices and plans.
2. **Manual checks**:
   - keyboard-only use (Tab order, visible focus, dialogs trap and return focus, Escape closes)
   - page language and titles
   - zoom and reflow at 320 px wide (the tenant app and mobile smoke test)
   - reduced motion

## Findings and fixes

| Issue | WCAG | Where | Fix |
| ----- | ---- | ----- | --- |
| White text on the emerald accent was 3.4:1 | 1.4.3 Contrast (AA) | Primary "Get started" and accent buttons | Accent darkened slightly, `#0f9d76` → `#0b8564` (4.6:1). Same hue, so the brand still reads as Nexora green. |
| Status badge text on tinted backgrounds was 4.3–4.5:1 | 1.4.3 | "Active", "Paid", "Overdue"… badges everywhere | `accent-strong` `#0a7a5b` → `#08694e` (5.6:1); `warning-strong` `#b45309` → `#9a4507` (5.5:1) |
| Faded tenant name on unit tiles was 3.3:1 | 1.4.3 | Property page unit grid | Full-strength text |
| Unit tiles were named "Unit A1, Occupied" while showing "A1 · Achieng Otieno" | 2.5.3 Label in Name | Property page unit grid | Name comes from the visible text, with the status added for screen readers: "A1 Achieng Otieno, Occupied" |
| Tab pointed at a panel that didn't exist | 4.1.2 Name, Role, Value | Leases (All / Expiring) | The list is now the tab panel |
| Chart was `role="img"` but contained focusable month bars | 4.1.2 / nested-interactive | Reports chart | `role="group"` with a label. Each month is a labelled control with a visible focus ring, and the chart has a table view. |
| No way to skip the sidebar (20+ links) | 2.4.1 Bypass Blocks | Every page | "Skip to main content" is the first Tab stop and moves focus to `<main>` |
| Animations ignored "reduce motion" | 2.3.3 (AAA, best practice) | Dialogs, toasts | Global `prefers-reduced-motion` rule |

After the fixes, axe reports **zero violations on all 43 screens**.

## Already in place (verified)

- **Labels and errors.** Every form control has a programmatic label: `FormField` wires the
  label, hint and error with `aria-describedby` and `aria-invalid`. Errors are shown as text,
  not by colour alone.
- **Status is never colour alone.** Badges carry words, unit tiles show the status and have a
  legend, and the chart has a legend and a table view.
- **Dialogs and menus** come from Radix: focus is trapped, Escape closes them, focus returns to
  the trigger, and they have labelled titles.
- **Feedback is announced.** Toasts, alerts and the chart tooltip use live regions
  (`role="status"` / `role="alert"`).
- **Page basics.** `lang="en"` on every page, and a descriptive title per page
  ("Invoices · Nexora").
- **Phone size.** The tenant app works at 412 px and reflows down to 320 px. Touch targets are
  at least 40 px.

## Keeping it accessible

`frontend/e2e/smoke/accessibility.spec.ts` runs in CI. It checks the main screens and the platform
console with axe, plus the skip link by keyboard. A new violation fails the build.

Automated tools find roughly a third of accessibility problems. Before a major release, also:

- Do the main journeys with the keyboard only: create a property, let a unit, bill, record a
  payment, and the tenant paying.
- Do one journey with a screen reader (VoiceOver on macOS or iOS, TalkBack on Android).
- Zoom the browser to 200%, check that nothing is cut off, and check that the tenant app works
  at 320 px.

## Known gaps

- Charts and tables are tested with axe and the keyboard, but not yet with a screen reader user.
- PDF exports (reports, the user manual) aren't tagged PDFs. The CSV and Excel downloads are the
  accessible alternative for reports.
