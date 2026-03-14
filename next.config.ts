import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack:{},
  
  webpack: (config, { isServer }) => {
    // Force WASM backend by aliasing native runtime to false
    config.resolve.alias = {
      ...config.resolve.alias,
      'sharp$': false,
      'onnxruntime-node$': false,
    };
    
    // Exclude native modules from bundling
    config.externals = config.externals || [];
    if (isServer) {
      config.externals.push({
        'sharp': 'commonjs sharp',
        'onnxruntime-node': 'commonjs onnxruntime-node',
      });
    }
    
    return config;
  }
};

export default nextConfig;
