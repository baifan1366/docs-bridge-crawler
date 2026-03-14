import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {},
  
  // Ensure transformers.js is bundled correctly for serverless
  experimental: {
    serverComponentsExternalPackages: [],
  },
  
  // Simple webpack config following official Transformers.js documentation
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // Exclude optional native dependencies
      sharp$: false,
      "onnxruntime-node$": false,
    };
    
    // Ensure WASM files are handled correctly
    if (isServer) {
      config.externals = config.externals || [];
      // Don't externalize transformers - it needs to be bundled
    }
    
    return config;
  }
};

export default nextConfig;
