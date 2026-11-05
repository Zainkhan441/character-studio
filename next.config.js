const path = require("path");

/**
 * ONNX Runtime bundles spawn their pthread worker via
 * `new URL("<bundle>.mjs", import.meta.url)`. Webpack emits the
 * referenced bundle as a static/media/*.mjs asset, and Next's
 * minifier then tries to minify that standalone file as a plain
 * script — SWC fails on its `import.meta` ("failed to parse input
 * file / Syntax Error", pointing at the bundle's sourceMappingURL
 * line). The files are already minified upstream, so mark them
 * minimized: Next's minifier skips any asset whose info.minimized
 * is set. Runs at PRE_PROCESS, well before the minifier
 * (OPTIMIZE_SIZE).
 */
class SkipOnnxBundleMinifyPlugin {
  apply(compiler) {
    const { webpack } = compiler;
    compiler.hooks.thisCompilation.tap("SkipOnnxBundleMinify", (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: "SkipOnnxBundleMinify",
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_PRE_PROCESS,
        },
        () => {
          for (const name of Object.keys(compilation.assets)) {
            if (/^static\/media\/ort\..*\.mjs$/.test(name)) {
              const asset = compilation.getAsset(name);
              if (asset) {
                compilation.updateAsset(name, asset.source, {
                  ...asset.info,
                  minimized: true,
                });
              }
            }
          }
        },
      );
    });
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // @huggingface/transformers ships a node build and a web build.
    // Its "node" export pulls native binaries and bare .wasm
    // specifiers that webpack cannot resolve, so force the
    // self-contained web build in both bundles. Both uses are
    // dynamic imports inside browser event handlers (segmentation
    // and voice), so the module is never executed during SSR
    // prerender — it only needs to resolve.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@huggingface/transformers": path.resolve(
        __dirname,
        "node_modules/@huggingface/transformers/dist/transformers.web.js",
      ),
      // kokoro-js's exports map points at its node build
      // (onnxruntime-node native binaries); use its self-contained
      // browser build instead. Types still resolve from the package.
      // kokoro-js's browser build imports onnxruntime-web assets by
      // bare specifier (no package prefix); point them at the real
      // files in kokoro-js's own nested onnxruntime-web.
      "ort.bundle.min.mjs": path.resolve(
        __dirname,
        "node_modules/kokoro-js/node_modules/onnxruntime-web/dist/ort.bundle.min.mjs",
      ),
      "ort-wasm-simd-threaded.jsep.wasm": path.resolve(
        __dirname,
        "node_modules/kokoro-js/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm",
      ),
    };
    config.plugins.push(new SkipOnnxBundleMinifyPlugin());
    return config;
  },
};

module.exports = nextConfig;
