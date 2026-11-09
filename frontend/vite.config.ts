import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
  base: process.env.GITHUB_PAGES === "true" ? "/Final-joy-inbox/" : "/",
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  build: {
    sourcemap: false
  }
}));
