import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs ships its own worker and font data and does not survive being
  // bundled for the server. Loading it as a plain dependency at runtime is
  // the supported arrangement.
  //
  // @napi-rs/canvas is pdfjs's own optional dependency, declared as a direct
  // one instead. As an optional it resolved into the lockfile on macOS only,
  // so the Linux binary was absent in production.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],

  // pdfjs loads its worker by constructing a path at runtime, so Vercel's
  // file tracing cannot see the reference and leaves the worker out of the
  // deployment. Reading any PDF then fails with "Setting up fake worker
  // failed" — a message that points at pdfjs rather than at the packaging,
  // which is what made it slow to diagnose. Naming the files explicitly is
  // the supported way to tell tracing about a dependency it can't infer.
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/pdfjs-dist/legacy/build/**",
      "./node_modules/pdfjs-dist/standard_fonts/**",
    ],
  },
};

export default nextConfig;
