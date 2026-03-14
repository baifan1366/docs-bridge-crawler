import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {},
  
  // Simple webpack config following official Transformers.js documentation
  // Only exclude Node.js-specific packages when bundling for browser
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // Exclude optional native dependencies
      sharp$: false,
      "onnxruntime-node$": false,
    };
    return config;
  }
};

export default nextConfig;
