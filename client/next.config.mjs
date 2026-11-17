/** @type {import('next').NextConfig} */
const nextConfig = {
  // DuckDB is a native Node.js addon — must not be bundled by webpack.
  // db.ts imports it with /* webpackIgnore: true */ so webpack never analyses
  // its internals (or the platform-specific binaries the loader switch-cases on).
  serverExternalPackages: ["@duckdb/node-api", "detect-libc"],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
      },
    ],
  },
};

export default nextConfig;
