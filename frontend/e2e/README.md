# Browser tests (Playwright)

The tests drive the real stack: start Django on :8000 and Next.js on :3000 first (see the
main README). Each run registers a new account and organization, so they never clash with
existing data.

The tenant app test reads the invitation email from **Mailpit**: run `docker compose up -d mailpit`
and start Django with the test settings below. `THROTTLE_AUTH` lifts the sign-in rate limit,
because every test signs up fresh accounts:

```bash
cd backend
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend EMAIL_PORT=1025 THROTTLE_AUTH=1000/min \
  .venv/bin/python manage.py runserver
```

Set `MAILPIT_URL` if Mailpit isn't on http://localhost:8025.

```
e2e/
  pages/        page objects: one class per screen, holding its locators and actions
  support/      fixtures.ts (gives tests an `app` with every page object), data.ts,
                api.ts (fast setup through the API) and mailbox.ts (reads emails from Mailpit)
  smoke/        fast, independent feature checks, incl. the tenant app at phone size; run in CI
  regression/   one long journey from sign-up to move-out settlement, for QA
```

## Running

| Command (from `frontend/`) | What it does |
| --- | --- |
| `npm run test:regression` | Regression journey in two visible browsers (landlord and tenant phone), 800 ms between actions (~3 min) |
| `npm run test:regression:ci` | Same journey headless, full speed |
| `npm run test:e2e` | Smoke tests, headless |
| `npm run test:e2e:headed` | Smoke tests in a visible browser, 300 ms between actions |
| `npm run test:e2e:report` | Open the HTML report of the last run (steps, screenshots, video, trace) |

Change the speed with `E2E_SLOW_MO` in milliseconds, e.g. `E2E_SLOW_MO=1500 npm run test:regression`
or `E2E_SLOW_MO=0` for full speed. `E2E_SCREENSHOTS=<dir>` saves screenshots of key screens.

## The regression journey

`regression/full-lifecycle.spec.ts` runs these stages in order with two browsers side by side:
the landlord's and the tenant's phone (the `tenantApp` fixture, Pixel 7 size). The report names
the stage and step that failed:

1. Sign up and create the organization
2. Property, unit type and four units
3. Tenant and lease (started last month)
4. Tenant invited from the tenant page; joins from the email (read from Mailpit) on their phone
5. Security charge and two months of billing (23,500 × 2), seen in the tenant app too
6. Deposit received (22,000), cash payment (30,000) and receipt; the tenant app shows 17,000 owed
7. Announcement (delivery log checked) and reminder setting; it reaches the tenant's bell
8. Repair reported in the tenant app with a photo; staff acknowledge, assign, quote, start, add an
   internal note (never shown to the tenant) and an update; the tenant replies; resolved, closed
9. Move-out notice given in the tenant app; private until staff acknowledge it
10. Move-out inspection: extra checklist item, one damaged item charged 3,000, signed off
11. Settlement: 17,000 of the deposit clears the balance, 2,000 refunded by M-Pesa
12. Lease ended, balance 0, unit available again; the tenant app shows it paid up and moved out

## Writing tests

- Put locators and actions in a page object, not in the spec. Specs read as a list of user
  actions: `await app.lease.recordPayment({ amount: "30000", method: "Cash" })`.
- Wrap each action in `test.step` so the report reads like the journey.
- Need a second user at the same time? Use the `tenantApp` fixture (its own phone-sized browser
  and session) rather than signing in and out on one page.
- Use the `BasePage` helpers (`text`, `field`, `button`, `link`): they only match visible
  elements, because Next keeps recently visited pages mounted but hidden.
- Check toasts with `expectToast`, scope dialog forms to `this.dialog`, and navigate with
  `openFromSidebar`, which waits for the new page before continuing.
- Any uncaught browser error fails the test automatically (see `support/fixtures.ts`).
