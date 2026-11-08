import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const isCloudflare = process.env.DEPLOY_TARGET === "cloudflare";

export default defineConfig(({ command }) => ({
  base: isCloudflare
    ? "/"
    : command === "build"
      ? "/Final-joy-inbox/"
      : "/",
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  build: {
    sourcemap: false
  }
}));
