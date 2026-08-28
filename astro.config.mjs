import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://hyperxq.github.io",
  base: process.env.GITHUB_ACTIONS ? "/finance-tracker" : "/",
  integrations: [react()],
  devToolbar: { enabled: false },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
});
