import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the UI preview build separate from already-running local instances.
  distDir: process.env.KNOWLEDGE_UI_PREVIEW === "1" ? ".next-ui" : ".next",
};

export default nextConfig;
