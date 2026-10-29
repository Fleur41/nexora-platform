# Browser tests (Playwright)

The tests drive the real stack: start Django on :8000 and Next.js on :3000 first (see the
main README). Each run registers a new account and organization, so they never clash with
existing data.

```
e2e/
  pages/        page objects: one class per screen, holding its locators and actions
  support/      fixtures.ts (gives tests an `app` with every page object) and data.ts
  smoke/        fast, independent feature checks; run in CI
  regression/   one long journey from sign-up to move-out settlement, for QA
```

## Running

| Command (from `frontend/`) | What it does |
| --- | --- |
| `npm run test:regression` | Regression journey in a visible browser, 800 ms between actions (~2–3 min) |
| `npm run test:regression:ci` | Same journey headless, full speed |
| `npm run test:e2e` | Smoke tests, headless |
| `npm run test:e2e:headed` | Smoke tests in a visible browser, 300 ms between actions |
| `npm run test:e2e:report` | Open the HTML report of the last run (steps, screenshots, video, trace) |

Change the speed with `E2E_SLOW_MO` in milliseconds, e.g. `E2E_SLOW_MO=1500 npm run test:regression`
or `E2E_SLOW_MO=0` for full speed. `E2E_SCREENSHOTS=<dir>` saves screenshots of key screens.

## The regression journey

`regression/full-lifecycle.spec.ts` runs these stages in order; the report names the stage and
step that failed:

1. Sign up and create the organization
2. Property, unit type and four units
3. Tenant and lease (started last month)
4. Security charge and two months of billing (23,500 × 2)
5. Deposit received (22,000), cash payment (30,000) and receipt; balance 17,000
6. Announcement (delivery log checked) and rent reminder setting
7. Maintenance request: acknowledge, assign, quote, start, internal note, tenant update, resolve, close
8. Move-out notice from the lease, acknowledged; unit shows "notice submitted"
9. Move-out inspection: extra checklist item, one damaged item charged 3,000, signed off
10. Settlement: 17,000 of the deposit clears the balance, 2,000 refunded by M-Pesa
11. Lease ended, balance 0, unit available again

## Writing tests

- Put locators and actions in a page object, not in the spec. Specs read as a list of user
  actions: `await app.lease.recordPayment({ amount: "30000", method: "Cash" })`.
- Wrap each action in `test.step` so the report reads like the journey.
- Use the `BasePage` helpers (`text`, `field`, `button`, `link`): they only match visible
  elements, because Next keeps recently visited pages mounted but hidden.
- Check toasts with `expectToast`, scope dialog forms to `this.dialog`, and navigate with
  `openFromSidebar`, which waits for the new page before continuing.
- Any uncaught browser error fails the test automatically (see `support/fixtures.ts`).
