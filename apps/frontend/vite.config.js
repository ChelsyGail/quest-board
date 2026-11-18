import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
    // Tests mock the API client, but the URL must still look configured.
    env: {
      VITE_API_BASE_URL: "http://api.test",
      VITE_QUESTS_ENABLED: "false",
      VITE_QUESTS_DEMO: "false",
      VITE_DISCUSSIONS_DEMO: "false",
      VITE_DISCUSSIONS_API: "false",
      VITE_PROOFS_DEMO: "false",
      VITE_PROOFS_API: "false",
      VITE_REWARDS_DEMO: "false",
      VITE_REWARDS_API: "false",
    },
  },
});
