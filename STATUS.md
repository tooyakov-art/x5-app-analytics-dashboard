# Status

- Outcome: отдельный X5 App Analytics dashboard для скачиваний, оплат и роста.
- Data: App Store Connect подключён; первая синхронизация 2026-08-10 увидела 10 сборок, включая iOS 1.1.6 (208) в TestFlight. Исторические Analytics Reports запрошены и могут готовиться до 24–48 часов.
- Android: интерфейс готов, для данных нужны Google Play service account и GCS report bucket.
- Payments: публично показываются только агрегаты; для Supabase нужен серверный read-only секрет.
- Deployment: `main`; GitHub Pages is live at https://tooyakov-art.github.io/x5-app-analytics-dashboard/.
- Verification: data contract passed; Vite production build passed; Pages returned HTTP 200 and referenced the production JS/CSS bundles (2026-08-10).
- Next action: wait for Apple historical segments; add Google Play and protected Supabase credentials when available.
