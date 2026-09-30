import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // node:sqlite is a Node built-in used by the FAB demo DB layer
  serverExternalPackages: [],
};

export default nextConfig;
