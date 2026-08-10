import { defineConfig } from "vite";

export default defineConfig({
  base: "/x5-app-analytics-dashboard/",
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
