import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site from /<repo>/, so assets need that prefix.
export default defineConfig({
  base: "/agent-automations/",
  plugins: [react()],
});
