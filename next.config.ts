import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs ships its own worker and font data and does not survive being
  // bundled for the server. Loading it as a plain dependency at runtime is
  // the supported arrangement.
  //
  // @napi-rs/canvas is pdfjs's own optional dependency, declared here as a
  // direct one instead. As an optional it was resolved into the lockfile on
  // macOS only, so the Linux binary was absent in production — pdfjs then
  // could not polyfill DOMMatrix, and reading any PDF failed. Depending on it
  // explicitly puts every platform's binary in the lockfile.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
