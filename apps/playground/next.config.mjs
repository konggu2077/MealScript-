/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources (no build step in v0.1).
  transpilePackages: [
    '@mealscript/compiler',
    '@mealscript/mcp-adapter',
    '@mealscript/optimizer',
    '@mealscript/verifier',
    '@mealscript/trace',
  ],
  webpack: (config) => {
    // Our packages import each other with explicit `.ts` extensions.
    config.resolve.extensions = ['.ts', '.tsx', '.js', '.jsx', '.json', ...(config.resolve.extensions ?? [])];
    return config;
  },
};

export default nextConfig;
