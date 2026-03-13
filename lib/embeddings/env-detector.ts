/**
 * Environment detection utilities
 * Determines whether to use transformers.js locally or API in production
 */

export function isVercelProduction(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

export function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function shouldUseTransformersJS(): boolean {
  // Only use transformers.js in local development
  return isLocalDevelopment() && !isVercelProduction();
}
