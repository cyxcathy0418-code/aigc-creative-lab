import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "rislccnxyvmjjgfhwyco.supabase.co",
        pathname: "/storage/v1/object/sign/product-assets/**",
      },
    ],
  },
};

export default nextConfig;
