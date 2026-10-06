import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // node:sqlite is a Node built-in used by the FAB demo DB layer
  serverExternalPackages: [],
  // The knowledge base is read with fs at runtime, so file tracing cannot see it.
  outputFileTracingIncludes: {
    "/api/ai/chat": ["./data/kb/**/*.md"],
    "/api/fab/knowledge": ["./data/kb/**/*.md"],
    "/fab/knowledge": ["./data/kb/**/*.md"],
  },
};

export default nextConfig;
