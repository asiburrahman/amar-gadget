import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native addon dependencies (DLL/.so/.dylib) are not inferred from the
  // binding itself. Include only the installed Sharp platform libraries.
  outputFileTracingIncludes: {
    "/*": ["node_modules/@img/sharp-*/lib/**/*", "node_modules/@img/sharp-libvips-*/lib/**/*"],
  },
  skipProxyUrlNormalize: true,
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
