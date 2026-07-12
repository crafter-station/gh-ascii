import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/ONNX packages can't be bundled by Turbopack.
  serverExternalPackages: [
    "@imgly/background-removal-node",
    "onnxruntime-node",
  ],
};

export default nextConfig;
