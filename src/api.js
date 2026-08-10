import { supabase } from "./supabase.js";

function requireClient() {
  if (!supabase) throw new Error("Supabase dashboard configuration is missing");
  return supabase;
}

async function rpc(name, params = {}) {
  const { data, error } = await requireClient().rpc(name, params);
  if (error) throw new Error(error.message || `RPC ${name} failed`);
  return data;
}

export const dashboardApi = {
  async session() {
    const { data, error } = await requireClient().auth.getSession();
    if (error) throw error;
    return data.session;
  },
  async signIn(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  },
  async sendMagicLink(email) {
    const { error } = await requireClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.href.split("#")[0] },
    });
    if (error) throw error;
  },
  async signOut() {
    await requireClient().auth.signOut();
  },
  access: () => rpc("dashboard_access_check"),
  overview: (params) => rpc("dashboard_overview", params),
  timeseries: (params) => rpc("dashboard_timeseries", params),
  users: (params) => rpc("dashboard_users", params),
  userDetails: (userId) => rpc("dashboard_user_details", { p_user_id: userId }),
  payments: (params) => rpc("dashboard_payments", params),
  kaspiPayments: (params = {}) => rpc("dashboard_kaspi_payments", params),
  sources: () => rpc("dashboard_sources_status"),
  audit: (action, metadata = {}) => rpc("dashboard_record_audit", { p_action: action, p_metadata: metadata }),
};
