import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "planet-leone-monsters-garbage.trycloudflare.com",
    "*.trycloudflare.com",
    "trycloudflare.com",
    "amargadget.gmksolution.com",
    "*.gmksolution.com",
    "gmksolution.com",
  ],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "amargadget.gmksolution.com",
        "*.gmksolution.com",
        "gmksolution.com",
        "*.trycloudflare.com",
        "trycloudflare.com",
        "localhost:3000",
        "127.0.0.1:3000",
      ],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.r2.dev",
      },
    ],
  },
};

export default nextConfig;
