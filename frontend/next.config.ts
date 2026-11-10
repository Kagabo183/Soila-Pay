import type { NextConfig } from "next";

// STATIC_EXPORT=1 npm run build -> plain HTML/JS in ./out for shared hosting
// (cPanel), where the files are served directly and only the Python API runs.
// (`next dev` keeps its own .next/dev folder, so an export build never
// disturbs a running dev server.)
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = staticExport ? { output: "export", trailingSlash: true, images: { unoptimized: true } } : {};

export default nextConfig;
