# X5 Analytics Dashboard status

Date: 2026-08-10
Branch: `main` (local changes not published)

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
