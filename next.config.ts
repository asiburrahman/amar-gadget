import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
