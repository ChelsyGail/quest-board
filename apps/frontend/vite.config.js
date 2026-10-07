import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
    // Tests mock the API client, but the URL must still look configured.
    env: { VITE_API_BASE_URL: "http://api.test" },
  },
});
