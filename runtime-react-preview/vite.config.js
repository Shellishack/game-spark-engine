import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5050,
    allowedHosts: [
      "61d5-20-43-157-160.ngrok-free.app",
      ".ngrok-free.app",
    ],
  },
  preview: {
    host: "0.0.0.0",
    port: 5050,
    allowedHosts: [
      "61d5-20-43-157-160.ngrok-free.app",
      ".ngrok-free.app",
    ],
  },
});
