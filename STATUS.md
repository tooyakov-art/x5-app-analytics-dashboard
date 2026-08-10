# X5 Analytics Dashboard status

Date: 2026-08-10
Branch: `codex/x5-secure-real-data-dashboard` (Kaspi changes local, not published)

## Outcome

- Supabase Auth login with no public signup.
- Access is checked by protected `dashboard_access_check`; all data comes from protected RPC functions.
- Overview, users, user details, payments/CSV, growth, and source status sections are implemented with period and business filters.
- The old public `data/latest.json` source is removed.
- The current GitHub Pages URL still serves the previous public build until this protected version can be deployed safely: https://tooyakov-art.github.io/x5-app-analytics-dashboard/.

## Verification

- `pnpm run check`: passed security contract.
- `pnpm run build`: passed production build.
- No service-role, Apple, Google, Kaspi, or card secret is bundled in the browser.

## Blocker and next action

Do not publish this dashboard before the shared Supabase migration and Edge Functions are deployed. A fresh protected Supabase deployment credential is not available in the current environment.

Best next action: apply the backend migration/functions, set the dashboard repository `X5_SUPABASE_ANON_KEY`, run the two-admin and outsider access UAT, then publish GitHub Pages.

## Kaspi review queue (2026-08-10)

- The Payments section now has a protected Kaspi queue with payment code, buyer, package, amount, expiry, and Confirm/Reject actions.
- Confirmation calls `review_kaspi_credit_payment`; the server, not the browser, checks the dashboard-admin list and performs the idempotent credit grant.
- Verified with `pnpm run check` and `pnpm run build`.
- The UI is not live yet because its RPCs depend on the unapplied Supabase migrations in the X5SSD feature branch.
