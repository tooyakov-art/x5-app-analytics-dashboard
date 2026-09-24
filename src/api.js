import { supabase } from "./supabase.js";

/**
 * Every number on this dashboard comes from an `admin_analytics_*` function.
 * They aggregate on the server and refuse anyone outside is_x5_developer(), so
 * the browser never holds another user's raw rows and never needs a service key.
 */
function requireClient() {
  if (!supabase) throw new Error("Не задан адрес Supabase или анонимный ключ");
  return supabase;
}

async function rpc(name, params = {}) {
  const { data, error } = await requireClient().rpc(name, params);
  if (error) {
    if (error.code === "42501" || /not_authorized/.test(error.message || "")) {
      const denied = new Error("Нет доступа: аккаунт не в списке администраторов");
      denied.denied = true;
      throw denied;
    }
    throw new Error(error.message || `Запрос ${name} не прошёл`);
  }
  return data;
}

export const PERIODS = [
  { id: "today", label: "Сегодня", days: 1 },
  { id: "7d", label: "7 дней", days: 7 },
  { id: "30d", label: "30 дней", days: 30 },
  { id: "90d", label: "90 дней", days: 90 },
  { id: "all", label: "Всё время", days: 3650 },
];

export function periodRange(periodId) {
  const period = PERIODS.find((item) => item.id === periodId) || PERIODS[2];
  const to = new Date();
  const from = new Date(to.getTime() - period.days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString(), label: period.label };
}

export const api = {
  async session() {
    const { data, error } = await requireClient().auth.getSession();
    if (error) throw error;
    return data.session;
  },
  async signIn(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw new Error("Не удалось войти: проверьте почту и пароль");
    return data.session;
  },
  async signOut() {
    await requireClient().auth.signOut();
  },
  overview: (range) => rpc("admin_analytics_overview", { p_from: range.from, p_to: range.to }),
  revenue: (range) => rpc("admin_analytics_revenue", { p_from: range.from, p_to: range.to }),
  tools: (range) => rpc("admin_analytics_tools", { p_from: range.from, p_to: range.to }),
  users: (range, search = "", limit = 200) =>
    rpc("admin_analytics_users", { p_from: range.from, p_to: range.to, p_search: search, p_limit: limit, p_offset: 0 }),
  userDetail: (userId) => rpc("admin_analytics_user_detail", { p_user: userId }),
  visits: (range) => rpc("admin_analytics_visits", { p_from: range.from, p_to: range.to }),
  health: () => rpc("admin_analytics_health"),
};

export function toCsv(rows, columns) {
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.map((column) => escape(column.label)).join(";");
  const body = rows.map((row) => columns.map((column) => escape(row[column.key])).join(";"));
  return [header, ...body].join("\n");
}

export function downloadCsv(filename, csv) {
  // Excel on Windows needs the BOM to read Cyrillic.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
