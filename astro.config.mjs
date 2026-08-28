import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  integrations: [react()],
  devToolbar: { enabled: false },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
});
