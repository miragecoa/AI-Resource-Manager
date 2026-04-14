/**
 * patch-onnx.cjs
 *
 * Patches @huggingface/transformers to replace onnxruntime-node with onnxruntime-web.
 * This forces WASM backend in all environments, saving 211MB of native binaries.
 *
 * Run before electron-builder: the patch modifies node_modules in-place.
 */

const fs = require('fs')
const path = require('path')

const files = [
  'node_modules/@huggingface/transformers/dist/transformers.node.mjs',
  'node_modules/@huggingface/transformers/dist/transformers.node.cjs',
  'node_modules/@huggingface/transformers/dist/transformers.node.min.cjs',
]

let patched = 0

for (const rel of files) {
  const fp = path.join(__dirname, '..', 'app', rel)
  if (!fs.existsSync(fp)) continue

  let code = fs.readFileSync(fp, 'utf-8')
  const orig = code

  // 1. ESM: import * as ONNX_NODE from "onnxruntime-node" → stub
  code = code.replace(
    /import\s*\*\s*as\s*ONNX_NODE\s*from\s*["']onnxruntime-node["']\s*;?/g,
    'const ONNX_NODE = {};'
  )

  // 2. CJS: var ONNX_NODE = __toESM(require("onnxruntime-node"), 1) → stub
  code = code.replace(
    /var\s+ONNX_NODE\s*=\s*__toESM\s*\(\s*require\s*\(\s*["']onnxruntime-node["']\s*\)\s*,\s*\d+\s*\)\s*;?/g,
    'var ONNX_NODE = {};'
  )

  // 3. Replace the Node.js backend block that assigns ONNX = ONNX_NODE and registers "cpu"
  //    with one that uses onnxruntime-web and registers "wasm"
  //
  //    Original:
  //      } else if (apis.IS_NODE_ENV) {
  //        ONNX = ONNX_NODE;
  //        switch (process.platform) { ... }
  //        supportedDevices.push("webgpu");
  //        supportedDevices.push("cpu");
  //        defaultDevices = ["cpu"];
  //      }
  //
  //    Patched: skip ONNX_NODE, fall through to the web branch
  code = code.replace(
    /\}\s*else\s+if\s*\(apis\.IS_NODE_ENV\)\s*\{[^}]*ONNX\s*=\s*ONNX_NODE;[\s\S]*?supportedDevices\.push\("cpu"\);\s*defaultDevices\s*=\s*\["cpu"\];\s*\}/,
    `} else if (apis.IS_NODE_ENV) {
  ONNX = (ORT_SYMBOL in globalThis) ? globalThis[ORT_SYMBOL] : ONNX_NODE;
  supportedDevices.push("wasm");
  defaultDevices = ["wasm"];
}`
  )

  // 4. DEFAULT_DEVICE: "cpu" → "wasm" for Node
  code = code.replace(
    /var\s+DEFAULT_DEVICE\s*=\s*apis\.IS_NODE_ENV\s*\?\s*"cpu"\s*:\s*"wasm"/g,
    'var DEFAULT_DEVICE = "wasm"'
  )

  if (code !== orig) {
    fs.writeFileSync(fp, code, 'utf-8')
    console.log(`[patch-onnx] Patched: ${rel}`)
    patched++
  } else {
    console.log(`[patch-onnx] Already patched or no match: ${rel}`)
  }
}

console.log(`[patch-onnx] Done: ${patched} file(s) patched`)
