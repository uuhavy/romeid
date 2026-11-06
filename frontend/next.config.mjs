/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@rome-protocol/sdk"],
  experimental: {
    outputFileTracingIncludes: {
      "/*": ["./node_modules/@rome-protocol/registry/**/*"],
      "/**": ["./node_modules/@rome-protocol/registry/**/*"],
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
