import type { NextConfig } from "next";

// Django origin. The browser never calls it directly: /api/* is proxied so session and
// CSRF cookies stay first-party and no CORS is required.
const apiOrigin = (process.env.NEXORA_API_ORIGIN ?? "http://localhost:8000").replace(/\/$/, "");

// Everything is served from this origin (the API through the rewrite below). Next's inline
// bootstrap scripts need 'unsafe-inline' without per-request nonces; dev tooling also needs
// eval and the HMR websocket.
const dev = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Django routes end in "/"; don't let Next strip the slash before proxying.
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  // Self-contained server for the production image (frontend/Dockerfile, target "prod").
  output: "standalone",
  // The floating dev-tools badge covers controls in every corner (sidebar, the tenant app's
  // header and tab bar). Compile and runtime errors are still shown without it.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      { source: "/api/:path*/", destination: `${apiOrigin}/api/:path*/` },
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
