import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The repo root has its own package-lock.json (the CLI). Pin the app root to site/.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
