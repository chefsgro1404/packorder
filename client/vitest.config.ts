import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    server: {
      deps: {
        // Native addon — must not be bundled by Vite/Vitest
        external: ["@duckdb/node-api"],
      },
    },
    // Single-thread to avoid multiple DuckDB instances fighting over Parquet files
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
