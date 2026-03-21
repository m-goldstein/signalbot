import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "postgres"],
  outputFileTracingExcludes: {
    "*": ["venv/**/*"],
  },
};

export default nextConfig;
