import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs ships its own worker and font data and does not survive being
  // bundled for the server. Loading it as a plain dependency at runtime is
  // the supported arrangement.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
