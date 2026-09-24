import * as echarts from "echarts";
import { api, downloadCsv, PERIODS, periodRange, toCsv } from "./api.js";
import { isConfigured } from "./supabase.js";
import "./styles.css";

const root = document.getElementById("app");

const state = {
  period: "30d",
  tab: "overview",
  search: "",
  sort: { key: "credits_spent", direction: "desc" },
  data: {},
  charts: [],
};

const TABS = [
  { id: "overview", label: "Обзор" },
  { id: "money", label: "Деньги" },
  { id: "tools", label: "Кредиты и инструменты" },
  { id: "people", label: "Люди" },
  { id: "visits", label: "Посещения" },
  { id: "system", label: "Система" },
];

const TOOL_LABELS = { image: "Изображения", voice: "Озвучка", video: "Видео", lipsync: "Lipsync" };

const number = (value) => new Intl.NumberFormat("ru-RU").format(Math.round(Number(value) || 0));
const money = (value) => `${number(value)} ₸`;
const date = (value) => (value ? new Date(value).toLocaleDateString("ru-RU") : "—");
const dateTime = (value) => (value ? new Date(value).toLocaleString("ru-RU") : "—");
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function delta(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (!before) return now ? `<span class="up">новое</span>` : "";
  const change = Math.round(((now - before) / before) * 100);
  const cls = change >= 0 ? "up" : "down";
  return `<span class="${cls}">${change >= 0 ? "+" : ""}${change}% к прошлому периоду</span>`;
}

function kpi(label, value, note = "") {
  return `<div class="card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-note">${note}</div></div>`;
}

function table(columns, rows, options = {}) {
  const head = columns.map((column) => `<th data-sort="${column.key}">${column.label}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns.map((column) => `<td>${column.render ? column.render(row) : escapeHtml(row[column.key] ?? "—")}</td>`).join("");
      return `<tr class="${options.rowClass || ""}" data-id="${escapeHtml(row[options.idKey] ?? "")}">${cells}</tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${
    body || `<tr><td colspan="${columns.length}">Пока пусто</td></tr>`
  }</tbody></table></div>`;
}

function sortRows(rows, key, direction) {
  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    const numeric = typeof left === "number" && typeof right === "number";
    const compare = numeric ? left - right : String(left ?? "").localeCompare(String(right ?? ""), "ru");
    return direction === "asc" ? compare : -compare;
  });
}

function drawChart(element, option) {
  const chart = echarts.init(element, null, { renderer: "canvas" });
  chart.setOption({
    backgroundColor: "transparent",
    textStyle: { color: "rgba(255,255,255,0.65)", fontFamily: "Inter, sans-serif" },
    grid: { left: 44, right: 16, top: 28, bottom: 28 },
    tooltip: { trigger: "axis", backgroundColor: "#12121d", borderColor: "rgba(255,255,255,0.12)", textStyle: { color: "#fff" } },
    ...option,
  });
  state.charts.push(chart);
  return chart;
}

function axis(days, key) {
  return { data: days.map((day) => day.day), type: "category", axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } } , boundaryGap: key === "bar" };
}

// ------------------------------------------------------------------- tabs ---

function renderOverview(container) {
  const data = state.data.overview;
  if (!data) return;
  const funnel = data.funnel || {};
  const maxStep = Math.max(funnel.registered || 0, funnel.generated || 0, funnel.paid || 0, 1);
  const step = (label, value) => `
    <div class="funnel-row">
      <span>${label}</span>
      <span class="funnel-bar"><span class="funnel-fill" style="width:${Math.round(((value || 0) / maxStep) * 100)}%"></span></span>
      <strong>${number(value)}</strong>
    </div>`;

  container.innerHTML = `
    <div class="notice">Доход считается по каталогу цен для начисленных покупок: выплаты Apple и Google в базу пока не синхронизируются.</div>
    <div class="grid">
      ${kpi("Доход", money(data.revenue_kzt), `${delta(data.revenue_kzt, data.revenue_kzt_previous)} · iOS ${money(data.revenue_ios_kzt)} · Android ${money(data.revenue_android_kzt)}`)}
      ${kpi("Куплено кредитов", number(data.credits_sold), `${number(data.purchases)} покупок`)}
      ${kpi("Потрачено кредитов", number(data.credits_spent), delta(data.credits_spent, data.credits_spent_previous))}
      ${kpi("Себестоимость", money(data.provider_cost_kzt), "кредиты ÷ 2")}
      ${kpi("Прибыль", money(data.profit_kzt), "доход − себестоимость")}
      ${kpi("Активные люди", number(data.active_users), delta(data.active_users, data.active_users_previous))}
      ${kpi("Новые регистрации", number(data.registered), `всего ${number(data.registered_total)}`)}
      ${kpi("Генерации", number(data.generations), `${number(data.generations_failed)} с ошибкой`)}
    </div>
    <div class="section grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));">
      <div class="card"><h2>Доход и расход кредитов по дням</h2><div class="chart" id="chart-money"></div></div>
      <div class="card"><h2>Активные люди по дням</h2><div class="chart" id="chart-active"></div></div>
    </div>
    <div class="section card">
      <h2>Путь пользователя за период</h2>
      <div class="funnel">
        ${step("Зарегистрировались", funnel.registered)}
        ${step("Сделали генерацию", funnel.generated)}
        ${step("Купили кредиты", funnel.paid)}
      </div>
    </div>`;

  const days = data.daily || [];
  drawChart(document.getElementById("chart-money"), {
    legend: { data: ["Доход, ₸", "Кредиты"], textStyle: { color: "rgba(255,255,255,0.6)" } },
    xAxis: axis(days),
    yAxis: { type: "value", splitLine: { lineStyle: { color: "rgba(255,255,255,0.07)" } } },
    series: [
      { name: "Доход, ₸", type: "line", smooth: true, data: days.map((d) => d.revenue), itemStyle: { color: "#cbff18" }, areaStyle: { color: "rgba(203,255,24,0.12)" } },
      { name: "Кредиты", type: "line", smooth: true, data: days.map((d) => d.credits_spent), itemStyle: { color: "#60a5fa" } },
    ],
  });
  drawChart(document.getElementById("chart-active"), {
    xAxis: axis(days, "bar"),
    yAxis: { type: "value", splitLine: { lineStyle: { color: "rgba(255,255,255,0.07)" } } },
    series: [{ type: "bar", data: days.map((d) => d.active_users), itemStyle: { color: "#a78bfa", borderRadius: [6, 6, 0, 0] } }],
  });
}

function renderMoney(container) {
  const data = state.data.revenue;
  if (!data) return;
  const totals = data.totals || {};
  const purchases = data.purchases || [];

  container.innerHTML = `
    <div class="grid">
      ${kpi("Доход за период", money(totals.revenue_kzt))}
      ${kpi("Покупок", number(totals.purchases), `${number(totals.payers)} платящих`)}
      ${kpi("Средний чек", money(totals.average_check_kzt))}
      ${kpi("Начислено кредитов", number(totals.credits_granted), `возвращено ${number(totals.credits_revoked)}`)}
    </div>
    <div class="section card">
      <h2>Покупки <button class="chip" id="export-purchases">Выгрузить CSV</button></h2>
      ${table(
        [
          { key: "credited_at", label: "Дата", render: (row) => dateTime(row.credited_at) },
          { key: "user_name", label: "Пользователь" },
          { key: "email", label: "Почта" },
          { key: "platform", label: "Магазин" },
          { key: "product_id", label: "Пакет" },
          { key: "price_kzt", label: "Сумма", render: (row) => money(row.price_kzt) },
          { key: "credits_granted", label: "Кредиты", render: (row) => number(row.credits_granted) },
          {
            key: "credits_revoked",
            label: "Статус",
            render: (row) =>
              Number(row.credits_revoked) > 0
                ? `<span class="pill pill-bad">возврат ${number(row.credits_revoked)}</span>`
                : `<span class="pill pill-ok">начислено</span>`,
          },
        ],
        purchases,
      )}
    </div>`;

  document.getElementById("export-purchases")?.addEventListener("click", () => {
    downloadCsv(
      `x5-purchases-${state.period}.csv`,
      toCsv(purchases, [
        { key: "credited_at", label: "Дата" },
        { key: "user_name", label: "Пользователь" },
        { key: "email", label: "Почта" },
        { key: "platform", label: "Магазин" },
        { key: "product_id", label: "Пакет" },
        { key: "price_kzt", label: "Сумма, ₸" },
        { key: "credits_granted", label: "Кредиты" },
        { key: "credits_revoked", label: "Возвращено" },
      ]),
    );
  });
}

function renderTools(container) {
  const data = state.data.tools;
  if (!data) return;
  const tools = (data.tools || []).map((tool) => ({ ...tool, label: TOOL_LABELS[tool.tool] || tool.tool }));

  container.innerHTML = `
    <div class="section grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));">
      <div class="card"><h2>Куда уходят кредиты</h2><div class="chart" id="chart-tools"></div></div>
      <div class="card">
        <h2>По инструментам</h2>
        ${table(
          [
            { key: "label", label: "Инструмент" },
            { key: "runs", label: "Запусков", render: (row) => number(row.runs) },
            { key: "failed", label: "Ошибок", render: (row) => number(row.failed) },
            { key: "credits_spent", label: "Кредитов", render: (row) => number(row.credits_spent) },
            { key: "provider_cost_kzt", label: "Себестоимость", render: (row) => money(row.provider_cost_kzt) },
            { key: "users", label: "Людей", render: (row) => number(row.users) },
          ],
          tools,
        )}
      </div>
    </div>
    <div class="section grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));">
      <div class="card"><h2>Кто больше всех тратит</h2>${table(
        [
          { key: "user_name", label: "Пользователь" },
          { key: "credits_spent", label: "Кредитов", render: (row) => number(row.credits_spent) },
          { key: "runs", label: "Запусков", render: (row) => number(row.runs) },
        ],
        data.top_spenders || [],
      )}</div>
      <div class="card"><h2>Ошибки</h2>${table(
        [
          { key: "tool", label: "Инструмент", render: (row) => TOOL_LABELS[row.tool] || row.tool },
          { key: "error_code", label: "Код" },
          { key: "runs", label: "Раз", render: (row) => number(row.runs) },
        ],
        data.errors || [],
      )}</div>
    </div>`;

  drawChart(document.getElementById("chart-tools"), {
    tooltip: { trigger: "item" },
    grid: undefined,
    series: [
      {
        type: "pie",
        radius: ["45%", "72%"],
        itemStyle: { borderColor: "#0e0e18", borderWidth: 2 },
        label: { color: "rgba(255,255,255,0.7)" },
        data: tools.map((tool) => ({ name: tool.label, value: tool.credits_spent })),
      },
    ],
    color: ["#cbff18", "#60a5fa", "#a78bfa", "#f59e0b"],
  });
}

function renderPeople(container) {
  const data = state.data.users;
  if (!data) return;
  const rows = sortRows(data.users || [], state.sort.key, state.sort.direction);

  container.innerHTML = `
    <div class="card" style="margin-bottom:12px; display:flex; gap:10px; align-items:center;">
      <input type="search" id="user-search" placeholder="Поиск по имени или почте" value="${escapeHtml(state.search)}" />
      <button class="chip" id="export-users">CSV</button>
    </div>
    <div class="card">
      <h2>Люди · ${number(data.total)} всего</h2>
      ${table(
        [
          { key: "name", label: "Имя" },
          { key: "email", label: "Почта" },
          { key: "registration_platform", label: "Откуда" },
          { key: "city", label: "Город" },
          { key: "credits", label: "Баланс", render: (row) => number(row.credits) },
          { key: "paid_kzt", label: "Оплатил", render: (row) => money(row.paid_kzt) },
          { key: "credits_spent", label: "Потратил", render: (row) => number(row.credits_spent) },
          { key: "generations", label: "Генераций", render: (row) => number(row.generations) },
          { key: "created_at", label: "Регистрация", render: (row) => date(row.created_at) },
          { key: "last_seen", label: "Был(а)", render: (row) => date(row.last_seen) },
        ],
        rows,
        { rowClass: "row-click", idKey: "user_id" },
      )}
    </div>`;

  const search = document.getElementById("user-search");
  search?.addEventListener("change", async (event) => {
    state.search = event.target.value;
    await load();
  });
  document.getElementById("export-users")?.addEventListener("click", () => {
    downloadCsv(
      `x5-users-${state.period}.csv`,
      toCsv(rows, [
        { key: "name", label: "Имя" },
        { key: "email", label: "Почта" },
        { key: "registration_platform", label: "Платформа" },
        { key: "city", label: "Город" },
        { key: "credits", label: "Баланс" },
        { key: "paid_kzt", label: "Оплатил, ₸" },
        { key: "credits_spent", label: "Потратил кредитов" },
        { key: "generations", label: "Генераций" },
        { key: "created_at", label: "Регистрация" },
        { key: "last_seen", label: "Последний вход" },
      ]),
    );
  });
  container.querySelectorAll("th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort;
      state.sort = { key, direction: state.sort.key === key && state.sort.direction === "desc" ? "asc" : "desc" };
      renderPeople(container);
    });
  });
  container.querySelectorAll("tr.row-click").forEach((row) => {
    row.addEventListener("click", () => openUser(row.dataset.id));
  });
}

async function openUser(userId) {
  if (!userId) return;
  const detail = await api.userDetail(userId);
  const profile = detail.profile || {};
  const drawer = document.createElement("div");
  drawer.className = "drawer";
  drawer.innerHTML = `
    <div class="drawer-body">
      <button class="chip" id="close-drawer">Закрыть</button>
      <h2 style="margin-top:14px">${escapeHtml(profile.name || profile.email || "Пользователь")}</h2>
      <p class="kpi-note">${escapeHtml(profile.email || "")} · ${escapeHtml(profile.registration_platform || "—")} · ${escapeHtml(profile.city || "—")}</p>
      <div class="grid" style="grid-template-columns: repeat(2, 1fr);">
        ${kpi("Баланс", number(profile.credits))}
        ${kpi("Регистрация", date(profile.created_at))}
      </div>
      <div class="card section"><h2>Покупки</h2>${table(
        [
          { key: "credited_at", label: "Дата", render: (row) => date(row.credited_at) },
          { key: "product_id", label: "Пакет" },
          { key: "price_kzt", label: "Сумма", render: (row) => money(row.price_kzt) },
        ],
        detail.purchases || [],
      )}</div>
      <div class="card section"><h2>Инструменты</h2>${table(
        [
          { key: "tool", label: "Инструмент", render: (row) => TOOL_LABELS[row.tool] || row.tool },
          { key: "runs", label: "Запусков", render: (row) => number(row.runs) },
          { key: "credits_spent", label: "Кредитов", render: (row) => number(row.credits_spent) },
          { key: "failed", label: "Ошибок", render: (row) => number(row.failed) },
        ],
        detail.tools || [],
      )}</div>
      <div class="card section"><h2>Последние генерации</h2>${table(
        [
          { key: "created_at", label: "Когда", render: (row) => dateTime(row.created_at) },
          { key: "tool", label: "Инструмент", render: (row) => TOOL_LABELS[row.tool] || row.tool },
          { key: "status", label: "Статус" },
          { key: "cost_credits", label: "Кредитов", render: (row) => number(row.cost_credits) },
        ],
        detail.recent || [],
      )}</div>
    </div>`;
  drawer.addEventListener("click", (event) => {
    if (event.target === drawer || event.target.id === "close-drawer") drawer.remove();
  });
  document.body.appendChild(drawer);
}

function renderVisits(container) {
  const data = state.data.visits;
  if (!data) return;
  const active = data.active || {};
  const stickiness = active.mau ? Math.round((active.dau / active.mau) * 100) : 0;

  container.innerHTML = `
    <div class="grid">
      ${kpi("Сегодня (DAU)", number(active.dau))}
      ${kpi("За неделю (WAU)", number(active.wau))}
      ${kpi("За месяц (MAU)", number(active.mau))}
      ${kpi("Липкость", `${stickiness}%`, "DAU ÷ MAU")}
      ${kpi("Заходили за 30 дней", number(active.seen_30d), "по профилям, до учёта посещений")}
    </div>
    <div class="section card"><h2>Заходы по дням</h2><div class="chart" id="chart-visits"></div></div>
    <div class="section grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));">
      <div class="card"><h2>Платформы</h2>${table(
        [
          { key: "platform", label: "Платформа" },
          { key: "users", label: "Людей", render: (row) => number(row.users) },
          { key: "events", label: "Событий", render: (row) => number(row.events) },
        ],
        data.platforms || [],
      )}</div>
      <div class="card"><h2>Куда заходят</h2>${table(
        [
          { key: "screen", label: "Экран" },
          { key: "views", label: "Открытий", render: (row) => number(row.views) },
          { key: "users", label: "Людей", render: (row) => number(row.users) },
        ],
        data.screens || [],
      )}</div>
      <div class="card"><h2>Города</h2>${table(
        [
          { key: "country", label: "Страна" },
          { key: "city", label: "Город" },
          { key: "users", label: "Людей", render: (row) => number(row.users) },
        ],
        data.cities || [],
      )}</div>
    </div>`;

  const days = data.daily || [];
  drawChart(document.getElementById("chart-visits"), {
    legend: { data: ["Люди", "Сессии"], textStyle: { color: "rgba(255,255,255,0.6)" } },
    xAxis: axis(days),
    yAxis: { type: "value", splitLine: { lineStyle: { color: "rgba(255,255,255,0.07)" } } },
    series: [
      { name: "Люди", type: "line", smooth: true, data: days.map((d) => d.users), itemStyle: { color: "#cbff18" } },
      { name: "Сессии", type: "line", smooth: true, data: days.map((d) => d.sessions), itemStyle: { color: "#60a5fa" } },
    ],
  });
}

function renderSystem(container) {
  const data = state.data.health;
  if (!data) return;
  container.innerHTML = `
    <div class="card"><h2>Провайдеры</h2>${table(
      [
        { key: "provider", label: "Провайдер" },
        { key: "capability", label: "Что делает" },
        {
          key: "available",
          label: "Статус",
          render: (row) => (row.available ? `<span class="pill pill-ok">работает</span>` : `<span class="pill pill-bad">лежит</span>`),
        },
        { key: "model", label: "Модель" },
        { key: "last_success_at", label: "Последний успех", render: (row) => dateTime(row.last_success_at) },
        { key: "last_error_code", label: "Ошибка" },
      ],
      data.providers || [],
    )}</div>
    <div class="section card"><h2>Последние сбои генераций</h2>${table(
      [
        { key: "created_at", label: "Когда", render: (row) => dateTime(row.created_at) },
        { key: "tool", label: "Инструмент", render: (row) => TOOL_LABELS[row.tool] || row.tool },
        { key: "status", label: "Статус" },
        { key: "error_code", label: "Код" },
      ],
      data.recent_failures || [],
    )}</div>`;
}

// ------------------------------------------------------------------ shell ---

async function load() {
  const range = periodRange(state.period);
  const body = document.getElementById("tab-body");
  if (body) body.innerHTML = `<div class="card">Загружаем…</div>`;

  try {
    if (state.tab === "overview") state.data.overview = await api.overview(range);
    if (state.tab === "money") state.data.revenue = await api.revenue(range);
    if (state.tab === "tools") state.data.tools = await api.tools(range);
    if (state.tab === "people") state.data.users = await api.users(range, state.search);
    if (state.tab === "visits") state.data.visits = await api.visits(range);
    if (state.tab === "system") state.data.health = await api.health();
    renderTab();
  } catch (error) {
    if (error.denied) return renderLogin(error.message);
    if (body) body.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
  }
}

function renderTab() {
  state.charts.forEach((chart) => chart.dispose());
  state.charts = [];
  const body = document.getElementById("tab-body");
  if (!body) return;
  if (state.tab === "overview") renderOverview(body);
  if (state.tab === "money") renderMoney(body);
  if (state.tab === "tools") renderTools(body);
  if (state.tab === "people") renderPeople(body);
  if (state.tab === "visits") renderVisits(body);
  if (state.tab === "system") renderSystem(body);
}

function renderShell() {
  root.innerHTML = `
    <div class="topbar">
      <div class="brand">X Five <span>Analytics</span></div>
      <div class="spacer"></div>
      ${PERIODS.map((period) => `<button class="chip ${period.id === state.period ? "active" : ""}" data-period="${period.id}">${period.label}</button>`).join("")}
      <button class="chip" id="sign-out">Выйти</button>
    </div>
    <div class="shell">
      <div class="tabs">
        ${TABS.map((tab) => `<button class="tab ${tab.id === state.tab ? "active" : ""}" data-tab="${tab.id}">${tab.label}</button>`).join("")}
      </div>
      <div id="tab-body"></div>
    </div>`;

  root.querySelectorAll("[data-period]").forEach((button) =>
    button.addEventListener("click", async () => {
      state.period = button.dataset.period;
      renderShell();
      await load();
    }),
  );
  root.querySelectorAll("[data-tab]").forEach((button) =>
    button.addEventListener("click", async () => {
      state.tab = button.dataset.tab;
      renderShell();
      await load();
    }),
  );
  document.getElementById("sign-out")?.addEventListener("click", async () => {
    await api.signOut();
    renderLogin();
  });
}

function renderLogin(message = "") {
  root.innerHTML = `
    <div class="shell">
      <form class="login card" id="login-form">
        <div class="brand">X Five <span>Analytics</span></div>
        <p class="kpi-note">Вход только для администраторов X5.</p>
        ${message ? `<div class="notice error">${escapeHtml(message)}</div>` : ""}
        ${isConfigured ? "" : `<div class="notice">Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.</div>`}
        <input type="email" name="email" placeholder="Почта" autocomplete="username" required />
        <input type="password" name="password" placeholder="Пароль" autocomplete="current-password" required />
        <button class="primary" type="submit">Войти</button>
      </form>
    </div>`;

  document.getElementById("login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api.signIn(form.get("email"), form.get("password"));
      await start();
    } catch (error) {
      renderLogin(error.message);
    }
  });
}

async function start() {
  if (!isConfigured) return renderLogin();
  const session = await api.session();
  if (!session) return renderLogin();
  renderShell();
  await load();
}

window.addEventListener("resize", () => state.charts.forEach((chart) => chart.resize()));
start();
