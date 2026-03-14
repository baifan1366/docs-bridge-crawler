import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack:{},
  // Explicitly mark transformers and onnxruntime as external for server
  // This matches the main app configuration
  serverExternalPackages: [
    '@huggingface/transformers',
    'onnxruntime-common',
    'onnxruntime-web',
    'onnxruntime-node'
  ],
  
  webpack: (config, { isServer }) => {
    // Ignore transformers and related packages on server-side
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        '@huggingface/transformers': 'commonjs @huggingface/transformers',
        'onnxruntime-common': 'commonjs onnxruntime-common',
        'onnxruntime-web': 'commonjs onnxruntime-web',
        'onnxruntime-node': 'commonjs onnxruntime-node',
      });
    }
    
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      "onnxruntime-node$": false,
      "onnxruntime-common$": false,
      "onnxruntime-web$": false,
    };
    
    return config;
  }
};

export default nextConfig;
