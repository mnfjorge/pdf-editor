import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BLOB_CONFIGURED: process.env.BLOB_READ_WRITE_TOKEN ? "true" : "false",
  },
};

export default nextConfig;
