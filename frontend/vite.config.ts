import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const api = process.env.API_URL || "http://127.0.0.1:8000";
export default defineConfig({ base: "./", plugins: [react()], server: { proxy: { "/agent": api, "/health": api } } });
