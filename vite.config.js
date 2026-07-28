import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend talks only to same-origin /api and /files; the dev proxy forwards
// both to the Express backend on :3001. No CORS, no ports in frontend code.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/files": "http://localhost:3001",
    },
  },
});
