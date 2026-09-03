import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/ONNX packages can't be bundled by Turbopack.
  serverExternalPackages: [
    "@imgly/background-removal-node",
    "onnxruntime-node",
  ],
  // File tracing follows `require` into onnxruntime_binding.node but not the
  // dlopen it does next for libonnxruntime.so, which sits beside it. Without
  // this the deployed function has the binding and not the runtime, every
  // card logs "libonnxruntime.so.1.17.3: cannot open shared object file",
  // and background removal silently falls back to the raw avatar. Vercel
  // functions are linux/x64; local builds trace their own platform already.
  outputFileTracingIncludes: {
    "/\\[user\\]": ["./node_modules/onnxruntime-node/bin/napi-v3/linux/x64/*"],
  },
};

export default nextConfig;
