import { init, use } from "echarts/core";
import { LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import "./styles.css";

use([LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const REMOTE_DATA_URL = "https://raw.githubusercontent.com/tooyakov-art/x5/main/analytics-data/latest.json";
const LOCAL_DATA_URL = `${import.meta.env.BASE_URL}data/latest.json`;
const numberFormatter = new Intl.NumberFormat("ru-RU");
const currencyFormatter = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });

let dashboardData = null;
let trendChart = null;
let platformChart = null;
let selectedPeriod = 30;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value) {
  return hasNumber(value) ? numberFormatter.format(value) : "—";
}

function formatMoney(value, currency = "USD") {
  if (!hasNumber(value)) return "—";
  if (currency === "USD") return currencyFormatter.format(value);
  return `${numberFormatter.format(value)} ${escapeHtml(currency)}`;
}

function metricHint(metric, fallback) {
  if (metric?.status === "preparing") return "Apple формирует историю";
  if (metric?.status === "not_connected") return "Источник не подключён";
  return fallback;
}

function metricCard(label, icon, metric, formatter = formatNumber, fallback = "За выбранный период") {
  const value = metric && hasNumber(metric.value) ? formatter(metric.value, metric.currency) : "—";
  return `
    <article class="metric-card">
      <div class="metric-top">
        <span class="metric-label">${escapeHtml(label)}</span>
        <span class="metric-icon" aria-hidden="true">${icon}</span>
      </div>
      <div class="metric-value">${value}</div>
      <div class="metric-hint">${escapeHtml(metricHint(metric, fallback))}</div>
    </article>`;
}

function statusMeta(status) {
  if (status === "connected" || status === "ready") return { cls: "ok", text: "Подключено", dot: "" };
  if (status === "preparing") return { cls: "pending", text: "Собирает данные", dot: "pending" };
  return { cls: "off", text: "Не подключено", dot: "offline" };
}

function sourceRow(name, detail, status) {
  const meta = statusMeta(status);
  return `
    <div class="source-row">
      <div>
        <div class="source-name">${escapeHtml(name)}</div>
        <div class="source-detail">${escapeHtml(detail)}</div>
      </div>
      <span class="source-badge ${meta.cls}">${meta.text}</span>
    </div>`;
}

function renderShell(data) {
  const overview = data.overview || {};
  const sync = data.sync || {};
  const overall = statusMeta(sync.status);
  const updated = data.generatedAt ? dateFormatter.format(new Date(data.generatedAt)) : "нет данных";

  document.querySelector("#app").innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <div class="brand-mark">X5</div>
            <div>
              <div class="brand-title">X5 App Analytics</div>
              <div class="brand-subtitle">Apple · Android · платежи · рост</div>
            </div>
          </div>
          <div class="topbar-actions">
            <div class="updated-at">Обновлено<br><strong>${escapeHtml(updated)}</strong></div>
            <button class="refresh-button" id="refresh-data" type="button">Обновить</button>
          </div>
        </div>
      </header>

      <main class="dashboard">
        <section class="hero">
          <div>
            <h1>Развитие приложения</h1>
            <p>Скачивания, установки, оплаты и удержание X5. Данные магазинов агрегированы: Apple и Google не раскрывают личность человека, который просто скачал приложение.</p>
          </div>
          <div class="status-pill"><span class="status-dot ${overall.dot}"></span>${escapeHtml(sync.message || overall.text)}</div>
        </section>

        <section class="kpi-grid" aria-label="Ключевые показатели">
          ${metricCard("Скачивания", "↓", overview.downloads)}
          ${metricCard("Установки", "↗", overview.installs)}
          ${metricCard("Покупки", "●", overview.purchases)}
          ${metricCard("Выручка", "$", overview.revenue, formatMoney)}
          ${metricCard("Подписки", "∞", overview.activeSubscriptions)}
          ${metricCard("Возвраты", "↩", overview.refunds)}
        </section>

        <section class="content-grid">
          <article class="panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Динамика роста</div>
                <div class="panel-subtitle">Скачивания, установки и покупки по дням</div>
              </div>
              <div class="period-switch" aria-label="Период">
                <button class="period-button" data-period="7">7 дней</button>
                <button class="period-button active" data-period="30">30 дней</button>
                <button class="period-button" data-period="90">90 дней</button>
              </div>
            </div>
            <div id="trend-chart" class="chart"></div>
            <div id="trend-empty" class="empty-state" hidden></div>
          </article>

          <aside class="panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Источники данных</div>
                <div class="panel-subtitle">Состояние подключений</div>
              </div>
            </div>
            <div class="source-list">
              ${sourceRow("App Store Connect", data.sources?.apple?.detail || "Analytics Reports", data.sources?.apple?.status)}
              ${sourceRow("Google Play", data.sources?.google?.detail || "Statistics & financial reports", data.sources?.google?.status)}
              ${sourceRow("Платежи X5", data.sources?.payments?.detail || "Проверенные транзакции", data.sources?.payments?.status)}
            </div>
            <div class="notice">Имена покупателей не публикуются в открытом дашборде. Здесь показываются только агрегированные показатели.</div>
          </aside>
        </section>

        <section class="lower-grid">
          <article class="panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Apple / Android</div>
                <div class="panel-subtitle">Распределение установок по платформам</div>
              </div>
            </div>
            <div id="platform-chart" class="chart compact"></div>
            <div id="platform-empty" class="empty-state" hidden></div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Воронка</div>
                <div class="panel-subtitle">Агрегированный путь от скачивания до оплаты</div>
              </div>
            </div>
            <div id="funnel" class="funnel"></div>
          </article>
        </section>

        <section class="lower-grid">
          <article class="panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Страны</div>
                <div class="panel-subtitle">Где скачивают приложение</div>
              </div>
            </div>
            <div id="countries-table" class="table-wrap"></div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Последние сборки</div>
                <div class="panel-subtitle">Состояние публикаций в магазинах</div>
              </div>
            </div>
            <div id="builds-table" class="table-wrap"></div>
          </article>
        </section>
      </main>
    </div>`;

  document.querySelector("#refresh-data").addEventListener("click", () => loadData(true));
  document.querySelectorAll("[data-period]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedPeriod = Number(button.dataset.period);
      document.querySelectorAll("[data-period]").forEach((node) => node.classList.toggle("active", node === button));
      renderTrend(data.trend || []);
    });
  });

  renderTrend(data.trend || []);
  renderPlatforms(data.platforms || []);
  renderFunnel(overview);
  renderCountries(data.countries || []);
  renderBuilds(data.builds || []);
}

function emptyMessage(targetId, message) {
  const target = document.querySelector(targetId);
  target.innerHTML = `<div><strong>Данные ещё собираются</strong>${escapeHtml(message)}</div>`;
  target.hidden = false;
}

function renderTrend(rows) {
  const chartNode = document.querySelector("#trend-chart");
  const emptyNode = document.querySelector("#trend-empty");
  const visibleRows = rows.slice(-selectedPeriod);
  if (!visibleRows.length) {
    chartNode.hidden = true;
    emptyMessage("#trend-empty", dashboardData?.sync?.detail || "Apple готовит исторический отчёт.");
    return;
  }
  chartNode.hidden = false;
  emptyNode.hidden = true;
  trendChart?.dispose();
  trendChart = init(chartNode, null, { renderer: "canvas" });
  trendChart.setOption({
    animationDuration: 550,
    color: ["#a8ff00", "#38bdf8", "#8b5cf6"],
    tooltip: { trigger: "axis", backgroundColor: "#151c28", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#f7f9fc" } },
    legend: { top: 0, right: 0, textStyle: { color: "#8e9aad" }, data: ["Скачивания", "Установки", "Покупки"] },
    grid: { left: 42, right: 20, top: 48, bottom: 32 },
    xAxis: { type: "category", boundaryGap: false, data: visibleRows.map((row) => row.date), axisLine: { lineStyle: { color: "rgba(255,255,255,.09)" } }, axisLabel: { color: "#758196", hideOverlap: true } },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "rgba(255,255,255,.055)" } }, axisLabel: { color: "#758196" } },
    series: [
      { name: "Скачивания", type: "line", smooth: true, showSymbol: false, areaStyle: { opacity: .08 }, data: visibleRows.map((row) => row.downloads ?? 0) },
      { name: "Установки", type: "line", smooth: true, showSymbol: false, data: visibleRows.map((row) => row.installs ?? 0) },
      { name: "Покупки", type: "line", smooth: true, showSymbol: false, data: visibleRows.map((row) => row.purchases ?? 0) },
    ],
  });
}

function renderPlatforms(platforms) {
  const rows = platforms.filter((row) => hasNumber(row.installs) && row.installs > 0);
  const chartNode = document.querySelector("#platform-chart");
  const emptyNode = document.querySelector("#platform-empty");
  if (!rows.length) {
    chartNode.hidden = true;
    emptyMessage("#platform-empty", "Появится после подключения отчётов App Store и Google Play.");
    return;
  }
  chartNode.hidden = false;
  emptyNode.hidden = true;
  platformChart?.dispose();
  platformChart = init(chartNode, null, { renderer: "canvas" });
  platformChart.setOption({
    color: ["#a8ff00", "#38bdf8"],
    tooltip: { trigger: "item", backgroundColor: "#151c28", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#f7f9fc" } },
    legend: { bottom: 0, textStyle: { color: "#8e9aad" } },
    series: [{ type: "pie", radius: ["52%", "75%"], center: ["50%", "45%"], label: { color: "#f7f9fc", formatter: "{d}%" }, data: rows.map((row) => ({ name: row.name, value: row.installs })) }],
  });
}

function renderFunnel(overview) {
  const items = [
    ["Скачивания", overview.downloads?.value],
    ["Установки", overview.installs?.value],
    ["Покупки", overview.purchases?.value],
  ];
  const max = Math.max(...items.map(([, value]) => hasNumber(value) ? value : 0), 1);
  const node = document.querySelector("#funnel");
  if (!items.some(([, value]) => hasNumber(value))) {
    node.innerHTML = `<div class="empty-state"><div><strong>Воронка ещё собирается</strong>Появится после первой синхронизации отчётов.</div></div>`;
    return;
  }
  node.innerHTML = items.map(([label, value]) => `
    <div class="funnel-row">
      <div class="funnel-label">${label}</div>
      <div class="funnel-track"><div class="funnel-fill" style="width:${hasNumber(value) ? Math.max((value / max) * 100, 2) : 0}%"></div></div>
      <div class="funnel-value">${formatNumber(value)}</div>
    </div>`).join("");
}

function renderCountries(countries) {
  const node = document.querySelector("#countries-table");
  if (!countries.length) {
    node.innerHTML = `<div class="empty-state"><div><strong>География ещё собирается</strong>Apple формирует разбивку по территориям.</div></div>`;
    return;
  }
  node.innerHTML = `<table class="x5-table"><thead><tr><th>Страна</th><th>Скачивания</th><th>Доля</th></tr></thead><tbody>${countries.slice(0, 12).map((row) => `<tr><td>${escapeHtml(row.country)}</td><td>${formatNumber(row.downloads)}</td><td>${hasNumber(row.share) ? `${row.share.toFixed(1)}%` : "—"}</td></tr>`).join("")}</tbody></table>`;
}

function renderBuilds(builds) {
  const node = document.querySelector("#builds-table");
  if (!builds.length) {
    node.innerHTML = `<div class="empty-state"><div><strong>Сборки не найдены</strong>Проверьте подключение магазина.</div></div>`;
    return;
  }
  node.innerHTML = `<table class="x5-table"><thead><tr><th>Платформа</th><th>Версия</th><th>Билд</th><th>Статус</th></tr></thead><tbody>${builds.map((row) => `<tr><td><span class="platform-badge">${escapeHtml(row.platform)}</span></td><td>${escapeHtml(row.version || "—")}</td><td>${escapeHtml(row.build || "—")}</td><td>${escapeHtml(row.status || "—")}</td></tr>`).join("")}</tbody></table>`;
}

async function fetchJson(url) {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadData(force = false) {
  const button = document.querySelector("#refresh-data");
  if (button) { button.disabled = true; button.textContent = "Обновляю…"; }
  try {
    dashboardData = await fetchJson(REMOTE_DATA_URL);
  } catch (remoteError) {
    console.warn("Remote analytics snapshot unavailable, using bundled snapshot", remoteError);
    dashboardData = await fetchJson(LOCAL_DATA_URL);
  }
  renderShell(dashboardData);
  if (force) window.scrollTo({ top: 0, behavior: "smooth" });
}

window.addEventListener("resize", () => {
  trendChart?.resize();
  platformChart?.resize();
});

loadData().catch((error) => {
  document.querySelector("#app").innerHTML = `<div class="empty-state" style="min-height:100vh"><div><strong>Не удалось загрузить аналитику</strong>${escapeHtml(error.message)}</div></div>`;
});
