import type { NextConfig } from "next";

// Baseline headers. A Content-Security-Policy needs a nonce for the inline theme
// script and is added in Phase 16 (see docs/SECURITY.md).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // OpenCV's Node branch conditionally references "fs". In browsers, the
  // Paddle-based OCR path never uses it; this empty shim keeps Turbopack's
  // Client Component and SSR bundles from trying to polyfill Node filesystem APIs.
  turbopack: {
    resolveAlias: {
      fs: "./src/lib/browser-noop-module.ts",
    },
  },
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
