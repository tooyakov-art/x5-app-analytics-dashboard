import { init, use } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { dashboardApi } from "./api.js";
import { isConfigured, supabase } from "./supabase.js";
import "./styles.css";

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const app = document.querySelector("#app");
const nf = new Intl.NumberFormat("ru-RU");
const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "KZT", maximumFractionDigits: 0 });
const dtf = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });
const df = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" });

const state = {
  session: null,
  allowed: false,
  tab: "overview",
  period: "30",
  filters: { platform: "", country: "", city: "", role: "", provider: "", product: "" },
  overview: null,
  timeseries: [],
  users: { rows: [], total: 0 },
  payments: { rows: [], total: 0 },
  kaspi: { rows: [], total: 0 },
  sources: [],
  loading: false,
  error: "",
};

let trendChart = null;

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const nullable = (value) => value === "" ? null : value;
const labelRole = (value) => value === "specialist" ? "Специалист" : value === "entrepreneur" ? "Предприниматель" : "Не указано";
const labelStatus = (value) => ({ succeeded: "Успешно", pending: "Ожидает", failed: "Ошибка", cancelled: "Отменено", expired: "Истекло", refunded: "Возврат", rejected: "Отклонено" }[value] || value || "—");
const labelProvider = (value) => ({ apple: "Apple", google_play: "Google Play", kaspi: "Kaspi", card: "Карта" }[value] || value || "—");

function dateRange() {
  const to = new Date();
  const from = new Date(to);
  if (state.period === "today") from.setHours(0, 0, 0, 0);
  else from.setDate(from.getDate() - Number(state.period));
  return { from: from.toISOString(), to: to.toISOString() };
}

function baseParams() {
  const { from, to } = dateRange();
  return {
    p_from: from,
    p_to: to,
    p_platform: nullable(state.filters.platform),
    p_country: nullable(state.filters.country.trim().toUpperCase()),
    p_city: nullable(state.filters.city.trim()),
    p_role: nullable(state.filters.role),
  };
}

function renderLoading(message = "Загружаю реальные данные…") {
  app.innerHTML = `<main class="center-screen"><div class="loader"></div><h1>${esc(message)}</h1></main>`;
}

function renderConfigError() {
  app.innerHTML = `<main class="center-screen"><div class="brand-mark">X5</div><h1>Дашборд не настроен</h1><p>Отсутствует публичная конфигурация Supabase. Секретные серверные ключи в браузер не передаются.</p></main>`;
}

function renderLogin(message = "") {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card">
        <div class="brand"><div class="brand-mark">X5</div><div><strong>X5 App Analytics</strong><span>Закрытый кабинет владельцев</span></div></div>
        <h1>Вход в аналитику</h1>
        <p>Доступ разрешён только двум аккаунтам X5. Регистрация новых аккаунтов здесь отключена.</p>
        <form id="login-form">
          <label>Email<input name="email" type="email" autocomplete="email" required placeholder="name@example.com"></label>
          <label>Пароль<input name="password" type="password" autocomplete="current-password" placeholder="Пароль X5"></label>
          <button type="submit" class="primary-button">Войти</button>
          <button type="button" id="magic-link" class="secondary-button">Получить ссылку на email</button>
          <div id="auth-message" class="form-message ${message ? "error" : ""}">${esc(message)}</div>
        </form>
      </section>
    </main>`;

  const form = document.querySelector("#login-form");
  const messageNode = document.querySelector("#auth-message");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    messageNode.className = "form-message";
    messageNode.textContent = "Проверяю аккаунт…";
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    if (!password) {
      messageNode.className = "form-message error";
      messageNode.textContent = "Введите пароль или запросите ссылку на email.";
      return;
    }
    try {
      await dashboardApi.signIn(email, password);
      await bootAuthenticated();
    } catch (error) {
      messageNode.className = "form-message error";
      messageNode.textContent = error.message;
    }
  });
  document.querySelector("#magic-link").addEventListener("click", async () => {
    const email = String(new FormData(form).get("email") || "").trim();
    if (!email) {
      messageNode.className = "form-message error";
      messageNode.textContent = "Сначала укажите email.";
      return;
    }
    try {
      await dashboardApi.sendMagicLink(email);
      messageNode.className = "form-message success";
      messageNode.textContent = "Ссылка отправлена. Откройте её на этом устройстве.";
    } catch (error) {
      messageNode.className = "form-message error";
      messageNode.textContent = error.message;
    }
  });
}

function renderDenied() {
  app.innerHTML = `<main class="center-screen"><div class="brand-mark">X5</div><h1>Доступ закрыт</h1><p>Этот аккаунт не входит в список владельцев дашборда.</p><button id="sign-out" class="secondary-button compact">Выйти</button></main>`;
  document.querySelector("#sign-out").addEventListener("click", async () => { await dashboardApi.signOut(); renderLogin(); });
}

function navItem(id, label, icon) {
  return `<button class="nav-item ${state.tab === id ? "active" : ""}" data-tab="${id}"><span>${icon}</span>${label}</button>`;
}

function filterBar() {
  return `<section class="filters-panel">
    <select id="period-filter" aria-label="Период">
      <option value="today" ${state.period === "today" ? "selected" : ""}>Сегодня</option>
      <option value="7" ${state.period === "7" ? "selected" : ""}>7 дней</option>
      <option value="30" ${state.period === "30" ? "selected" : ""}>30 дней</option>
      <option value="90" ${state.period === "90" ? "selected" : ""}>90 дней</option>
    </select>
    <select id="platform-filter"><option value="">Все платформы</option><option value="ios" ${state.filters.platform === "ios" ? "selected" : ""}>iOS</option><option value="android" ${state.filters.platform === "android" ? "selected" : ""}>Android</option></select>
    <input id="country-filter" value="${esc(state.filters.country)}" maxlength="2" placeholder="Страна: KZ">
    <input id="city-filter" value="${esc(state.filters.city)}" maxlength="80" placeholder="Город">
    <select id="role-filter"><option value="">Все роли</option><option value="specialist" ${state.filters.role === "specialist" ? "selected" : ""}>Специалисты</option><option value="entrepreneur" ${state.filters.role === "entrepreneur" ? "selected" : ""}>Предприниматели</option></select>
    <button id="apply-filters" class="primary-button compact">Применить</button>
  </section>`;
}

function metricCard(label, value, hint, tone = "green") {
  return `<article class="metric-card"><div class="metric-label">${esc(label)}</div><div class="metric-value ${tone}">${esc(value)}</div><div class="metric-hint">${esc(hint)}</div></article>`;
}

function renderOverview() {
  const o = state.overview || {};
  return `${filterBar()}
    <section class="metric-grid">
      ${metricCard("Скачивания", nf.format(n(o.downloads)), "App Store + Google Play")}
      ${metricCard("Установки", nf.format(n(o.installs)), "Подтверждено магазинами", "blue")}
      ${metricCard("Регистрации", nf.format(n(o.registrations)), `${o.registrationConversion ?? "—"}% от скачиваний`, "purple")}
      ${metricCard("Активные", nf.format(n(o.activeUsers)), "За выбранный период", "blue")}
      ${metricCard("Оплаты", nf.format(n(o.payments)), `${o.paymentConversion ?? "—"}% от регистраций`)}
      ${metricCard("Выручка", money.format(n(o.revenue)), "Успешные операции", "green")}
      ${metricCard("Подписки", nf.format(n(o.activeSubscriptions)), "Активные сейчас", "purple")}
      ${metricCard("Возвраты", nf.format(n(o.refunds)), "Отменённые начисления", "red")}
    </section>
    <section class="panel chart-panel"><div class="panel-heading"><div><h2>Развитие приложения</h2><p>Скачивания, установки, регистрации и активные пользователи</p></div></div><div id="trend-chart" class="chart"></div></section>
    <section class="panel"><div class="panel-heading"><div><h2>Источники данных</h2><p>Последняя успешная синхронизация</p></div></div>${sourcesMarkup()}</section>`;
}

function sourcesMarkup() {
  if (!state.sources.length) return `<div class="empty-state">Источники ещё не настроены в Supabase.</div>`;
  return `<div class="sources-grid">${state.sources.map((row) => `<article class="source-card"><div><strong>${esc(labelProvider(row.source))}</strong><p>${esc(row.detail || "Без описания")}</p></div><span class="status-badge ${esc(row.status)}">${esc(row.status)}</span><small>Успешно: ${row.lastSuccessAt ? esc(dtf.format(new Date(row.lastSuccessAt))) : "ещё нет"}</small></article>`).join("")}</div>`;
}

function renderUsers() {
  const rows = state.users.rows || [];
  return `${filterBar()}<section class="panel"><div class="panel-heading"><div><h2>Пользователи</h2><p>Найдено: ${nf.format(n(state.users.total))}</p></div><input id="user-search" class="search-input" placeholder="Имя, email, телефон" value=""></div>
    <div class="table-wrap"><table><thead><tr><th>Пользователь</th><th>Роль</th><th>Страна / город</th><th>Платформа</th><th>Регистрация</th><th>Тариф</th><th>Оплаты</th></tr></thead><tbody>
    ${rows.length ? rows.map((row) => `<tr data-user="${esc(row.id)}" class="clickable-row"><td><strong>${esc(row.name || "Без имени")}</strong><small>${esc(row.email || row.phone || "—")}</small></td><td>${esc(labelRole(row.role))}</td><td>${esc(row.country || "Не указано")} · ${esc(row.city || "Не указано")}</td><td>${esc(row.platform || "—")}</td><td>${row.registeredAt ? esc(df.format(new Date(row.registeredAt))) : "—"}</td><td>${esc(row.plan || "free")}</td><td>${nf.format(n(row.paymentCount))} · ${money.format(n(row.paymentTotal))}</td></tr>`).join("") : `<tr><td colspan="7" class="empty-cell">Пользователи за период не найдены</td></tr>`}
    </tbody></table></div></section>`;
}

function renderPayments() {
  const rows = state.payments.rows || [];
  const kaspiRows = state.kaspi.rows || [];
  return `${filterBar()}<section class="filters-panel secondary"><select id="provider-filter"><option value="">Все способы</option><option value="apple">Apple</option><option value="google_play">Google Play</option><option value="kaspi">Kaspi</option><option value="card">Карта</option></select><input id="product-filter" placeholder="Товар или тариф" value="${esc(state.filters.product)}"><input id="payment-search" placeholder="Имя или email"><button id="payment-apply" class="secondary-button compact">Найти</button><button id="export-csv" class="primary-button compact">Скачать CSV</button></section>
    <section class="panel kaspi-queue"><div class="panel-heading"><div><h2>Kaspi — ожидают проверки</h2><p>Сверьте сумму и код платежа перед подтверждением. Найдено: ${nf.format(n(state.kaspi.total))}</p></div></div><div class="table-wrap"><table><thead><tr><th>Создано</th><th>Пользователь</th><th>Код</th><th>Пакет</th><th>Сумма</th><th>Действие</th></tr></thead><tbody>
    ${kaspiRows.length ? kaspiRows.map((row) => `<tr><td>${row.createdAt ? esc(dtf.format(new Date(row.createdAt))) : "—"}<small>до ${row.expiresAt ? esc(dtf.format(new Date(row.expiresAt))) : "—"}</small></td><td><strong>${esc(row.buyerName || "Без имени")}</strong><small>${esc(row.email || "—")}</small></td><td><strong class="payment-code">${esc(row.paymentCode)}</strong></td><td>${nf.format(n(row.credits))} кредитов</td><td>${money.format(n(row.amountKzt))}</td><td><div class="payment-actions"><button class="primary-button compact" data-kaspi-confirm="${esc(row.id)}">Подтвердить</button><button class="danger-button compact" data-kaspi-reject="${esc(row.id)}">Отклонить</button></div></td></tr>`).join("") : `<tr><td colspan="6" class="empty-cell">Нет платежей Kaspi, ожидающих проверки</td></tr>`}
    </tbody></table></div></section>
    <section class="panel"><div class="panel-heading"><div><h2>Платежи</h2><p>Найдено: ${nf.format(n(state.payments.total))}</p></div></div><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Пользователь</th><th>Способ</th><th>Товар</th><th>Статус</th><th>Сумма</th></tr></thead><tbody>
    ${rows.length ? rows.map((row) => `<tr><td>${row.purchasedAt ? esc(dtf.format(new Date(row.purchasedAt))) : "—"}</td><td><strong>${esc(row.userName || "Без имени")}</strong><small>${esc(row.email || "—")}</small></td><td>${esc(labelProvider(row.provider))}</td><td>${esc(row.product || "—")}</td><td><span class="payment-status ${esc(row.status)}">${esc(labelStatus(row.status))}</span></td><td>${row.amount == null ? "—" : esc(new Intl.NumberFormat("ru-RU", { style: "currency", currency: row.currency || "KZT" }).format(n(row.amount)))}</td></tr>`).join("") : `<tr><td colspan="6" class="empty-cell">Платежи за период не найдены</td></tr>`}
    </tbody></table></div></section>`;
}

function renderGrowth() {
  const rows = state.timeseries || [];
  const totalReg = rows.reduce((sum, row) => sum + n(row.registrations), 0);
  const totalActive = rows.reduce((sum, row) => sum + n(row.activeUsers), 0);
  return `${filterBar()}<section class="metric-grid compact-grid">${metricCard("Регистрации", nf.format(totalReg), "За период", "purple")}${metricCard("Активность", nf.format(totalActive), "Дневные активные пользователи", "blue")}${metricCard("Конверсия регистрации", `${state.overview?.registrationConversion ?? "—"}%`, "Скачал → зарегистрировался")}${metricCard("Конверсия оплаты", `${state.overview?.paymentConversion ?? "—"}%`, "Зарегистрировался → оплатил")}</section><section class="panel chart-panel"><div class="panel-heading"><div><h2>Рост по дням</h2><p>Реальные события приложения и отчёты магазинов</p></div></div><div id="trend-chart" class="chart tall"></div></section>`;
}

function renderSources() {
  return `<section class="panel"><div class="panel-heading"><div><h2>Состояние источников</h2><p>Ошибки не скрываются пустыми карточками</p></div><button id="refresh-sources" class="secondary-button compact">Обновить</button></div>${sourcesMarkup()}</section>`;
}

function renderDashboard() {
  const content = state.error
    ? `<section class="error-banner"><strong>Не удалось загрузить данные</strong><span>${esc(state.error)}</span><button id="retry" class="secondary-button compact">Повторить</button></section>`
    : ({ overview: renderOverview, users: renderUsers, payments: renderPayments, growth: renderGrowth, sources: renderSources }[state.tab] || renderOverview)();

  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand sidebar-brand"><div class="brand-mark">X5</div><div><strong>App Analytics</strong><span>Закрытый кабинет</span></div></div><nav>${navItem("overview", "Обзор", "⌂")}${navItem("users", "Пользователи", "◎")}${navItem("payments", "Платежи", "₸")}${navItem("growth", "Рост", "↗")}${navItem("sources", "Источники", "●")}</nav><div class="sidebar-user"><span>${esc(state.session?.user?.email || "")}</span><button id="sign-out">Выйти</button></div></aside><main class="main-content"><header><button id="mobile-menu" aria-label="Меню">☰</button><div><h1>${({ overview: "Обзор", users: "Пользователи", payments: "Платежи", growth: "Рост", sources: "Источники" }[state.tab])}</h1><p>Только реальные данные X5</p></div><button id="refresh" class="secondary-button compact">Обновить</button></header>${content}</main></div><div id="modal-root"></div>`;

  bindDashboardEvents();
  if (!state.error && ["overview", "growth"].includes(state.tab)) requestAnimationFrame(renderTrendChart);
}

function readFilters() {
  state.period = document.querySelector("#period-filter")?.value || state.period;
  state.filters.platform = document.querySelector("#platform-filter")?.value || "";
  state.filters.country = document.querySelector("#country-filter")?.value || "";
  state.filters.city = document.querySelector("#city-filter")?.value || "";
  state.filters.role = document.querySelector("#role-filter")?.value || "";
}

function bindDashboardEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", async () => { state.tab = button.dataset.tab; await loadData(); }));
  document.querySelector("#sign-out")?.addEventListener("click", async () => { await dashboardApi.signOut(); state.session = null; state.allowed = false; renderLogin(); });
  document.querySelector("#refresh")?.addEventListener("click", loadData);
  document.querySelector("#retry")?.addEventListener("click", loadData);
  document.querySelector("#apply-filters")?.addEventListener("click", async () => { readFilters(); await loadData(); });
  document.querySelector("#mobile-menu")?.addEventListener("click", () => document.querySelector(".sidebar")?.classList.toggle("open"));
  document.querySelectorAll("[data-user]").forEach((row) => row.addEventListener("click", () => showUser(row.dataset.user)));
  document.querySelector("#user-search")?.addEventListener("keydown", async (event) => { if (event.key === "Enter") await loadUsers(event.target.value); });
  document.querySelector("#payment-apply")?.addEventListener("click", async () => { state.filters.provider = document.querySelector("#provider-filter")?.value || ""; state.filters.product = document.querySelector("#product-filter")?.value || ""; await loadPayments(document.querySelector("#payment-search")?.value || ""); });
  document.querySelector("#export-csv")?.addEventListener("click", exportPayments);
  document.querySelectorAll("[data-kaspi-confirm]").forEach((button) => button.addEventListener("click", () => reviewKaspi(button.dataset.kaspiConfirm, "confirmed")));
  document.querySelectorAll("[data-kaspi-reject]").forEach((button) => button.addEventListener("click", () => reviewKaspi(button.dataset.kaspiReject, "rejected")));
  document.querySelector("#refresh-sources")?.addEventListener("click", loadData);
}

async function reviewKaspi(paymentId, decision) {
  const action = decision === "confirmed" ? "начислить кредиты" : "отклонить заявку";
  if (!window.confirm(`Подтвердить действие: ${action}?`)) return;
  state.loading = true;
  try {
    await dashboardApi.reviewKaspiPayment(paymentId, decision);
    await loadPayments();
  } catch (error) {
    state.error = error.message;
    state.loading = false;
    renderDashboard();
  }
}

function renderTrendChart() {
  const node = document.querySelector("#trend-chart");
  if (!node) return;
  trendChart?.dispose();
  trendChart = init(node);
  const rows = state.timeseries || [];
  trendChart.setOption({
    color: ["#cbff18", "#38bdf8", "#a78bfa", "#f59e0b"],
    tooltip: { trigger: "axis", backgroundColor: "#151722", borderColor: "#303341", textStyle: { color: "#fff" } },
    legend: { top: 0, textStyle: { color: "#9da3b4" }, data: ["Скачивания", "Установки", "Регистрации", "Активные"] },
    grid: { left: 42, right: 20, top: 50, bottom: 34 },
    xAxis: { type: "category", boundaryGap: false, data: rows.map((r) => r.date), axisLabel: { color: "#747b8d", hideOverlap: true }, axisLine: { lineStyle: { color: "#2a2d38" } } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { color: "#747b8d" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.05)" } } },
    series: [
      { name: "Скачивания", type: "line", smooth: true, showSymbol: false, data: rows.map((r) => n(r.downloads)) },
      { name: "Установки", type: "line", smooth: true, showSymbol: false, data: rows.map((r) => n(r.installs)) },
      { name: "Регистрации", type: "line", smooth: true, showSymbol: false, data: rows.map((r) => n(r.registrations)) },
      { name: "Активные", type: "line", smooth: true, showSymbol: false, data: rows.map((r) => n(r.activeUsers)) },
    ],
  });
}

async function showUser(userId) {
  const root = document.querySelector("#modal-root");
  root.innerHTML = `<div class="modal-backdrop"><section class="modal-card"><div class="loader"></div></section></div>`;
  try {
    const data = await dashboardApi.userDetails(userId);
    const p = data?.profile || {};
    root.innerHTML = `<div class="modal-backdrop"><section class="modal-card"><button id="close-modal" class="modal-close">×</button><h2>${esc(p.name || "Без имени")}</h2><p>${esc(p.email || p.phone || "—")}</p><div class="detail-grid"><div><span>Роль</span><strong>${esc(labelRole(p.role))}</strong></div><div><span>Город</span><strong>${esc(p.country || "—")} · ${esc(p.city || "—")}</strong></div><div><span>Платформа</span><strong>${esc(p.platform || "—")}</strong></div><div><span>Тариф</span><strong>${esc(p.plan || "free")}</strong></div><div><span>Кредиты</span><strong>${nf.format(n(p.credits))}</strong></div><div><span>Подписка до</span><strong>${p.subscriptionEndDate ? esc(df.format(new Date(p.subscriptionEndDate))) : "—"}</strong></div></div><h3>Установки</h3><div class="mini-list">${(data.installations || []).map((i) => `<div><strong>${esc(i.platform)} · ${esc(i.version || "—")} (${esc(i.build || "—")})</strong><span>${i.lastSeenAt ? esc(dtf.format(new Date(i.lastSeenAt))) : "—"}</span></div>`).join("") || "Нет данных"}</div><h3>Платежи</h3><div class="mini-list">${(data.payments || []).map((t) => `<div><strong>${esc(labelProvider(t.provider))} · ${esc(t.product || "—")}</strong><span>${esc(labelStatus(t.status))} · ${t.amount == null ? "—" : money.format(n(t.amount))}</span></div>`).join("") || "Нет платежей"}</div></section></div>`;
    document.querySelector("#close-modal").addEventListener("click", () => { root.innerHTML = ""; });
    document.querySelector(".modal-backdrop").addEventListener("click", (event) => { if (event.target.classList.contains("modal-backdrop")) root.innerHTML = ""; });
  } catch (error) {
    root.innerHTML = `<div class="modal-backdrop"><section class="modal-card"><button id="close-modal" class="modal-close">×</button><h2>Ошибка</h2><p>${esc(error.message)}</p></section></div>`;
    document.querySelector("#close-modal").addEventListener("click", () => { root.innerHTML = ""; });
  }
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
async function exportPayments() {
  const rows = state.payments.rows || [];
  const headers = ["Дата", "Пользователь", "Email", "Способ", "Товар", "Статус", "Сумма", "Валюта"];
  const lines = [headers, ...rows.map((r) => [r.purchasedAt, r.userName, r.email, labelProvider(r.provider), r.product, labelStatus(r.status), r.amount, r.currency])];
  const blob = new Blob(["\ufeff" + lines.map((row) => row.map(csvCell).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `x5-payments-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
  URL.revokeObjectURL(url);
  await dashboardApi.audit("csv_export", { section: "payments", count: rows.length });
}

async function loadUsers(search = null) {
  state.loading = true;
  try {
    state.users = await dashboardApi.users({ ...baseParams(), p_search: nullable(search?.trim() || ""), p_limit: 200, p_offset: 0 });
    state.error = "";
  } catch (error) { state.error = error.message; }
  state.loading = false; renderDashboard();
}

async function loadPayments(search = null) {
  state.loading = true;
  const { from, to } = dateRange();
  try {
    [state.payments, state.kaspi] = await Promise.all([
      dashboardApi.payments({ p_from: from, p_to: to, p_provider: nullable(state.filters.provider), p_status: null, p_product: nullable(state.filters.product.trim()), p_search: nullable(search?.trim() || ""), p_limit: 500, p_offset: 0 }),
      dashboardApi.kaspiPayments({ p_status: "pending", p_limit: 100, p_offset: 0 }),
    ]);
    state.error = "";
  } catch (error) { state.error = error.message; }
  state.loading = false; renderDashboard();
}

async function loadData() {
  state.loading = true; state.error = ""; renderDashboard();
  try {
    const base = baseParams();
    const overviewParams = { ...base, p_provider: nullable(state.filters.provider), p_product: nullable(state.filters.product) };
    const common = [dashboardApi.overview(overviewParams), dashboardApi.timeseries(base), dashboardApi.sources()];
    const [overview, timeseries, sources] = await Promise.all(common);
    state.overview = overview; state.timeseries = timeseries || []; state.sources = sources || [];
    if (state.tab === "users") state.users = await dashboardApi.users({ ...base, p_search: null, p_limit: 200, p_offset: 0 });
    if (state.tab === "payments") {
      const { from, to } = dateRange();
      [state.payments, state.kaspi] = await Promise.all([
        dashboardApi.payments({ p_from: from, p_to: to, p_provider: nullable(state.filters.provider), p_status: null, p_product: nullable(state.filters.product), p_search: null, p_limit: 500, p_offset: 0 }),
        dashboardApi.kaspiPayments({ p_status: "pending", p_limit: 100, p_offset: 0 }),
      ]);
    }
    await dashboardApi.audit("view", { tab: state.tab, period: state.period });
  } catch (error) { state.error = error.message; }
  state.loading = false; renderDashboard();
}

async function bootAuthenticated() {
  renderLoading("Проверяю права доступа…");
  try {
    state.session = await dashboardApi.session();
    if (!state.session) { renderLogin(); return; }
    state.allowed = await dashboardApi.access();
    if (!state.allowed) { renderDenied(); return; }
    await dashboardApi.audit("login", { surface: "github_pages" });
    await loadData();
  } catch (error) { renderLogin(error.message); }
}

async function boot() {
  if (!isConfigured) { renderConfigError(); return; }
  await bootAuthenticated();
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") { state.session = null; state.allowed = false; renderLogin(); }
  });
}

window.addEventListener("resize", () => trendChart?.resize());
boot();
