import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, "..");
const outDir = path.join(clientDir, "dist");
const indexPath = path.join(clientDir, "index.html");
const bundleEntryPath = path.join(clientDir, "bundle-entry.js");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const bundleResult = await build({
  entryPoints: [bundleEntryPath],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  minify: true,
  target: ["es2022"],
});

const bundledCode = bundleResult.outputFiles[0].text;
const indexHtml = await readFile(indexPath, "utf8");
const bundledHtml = indexHtml.replace(
  /<script>[\s\S]*?\(async function loadClient\([\s\S]*?<\/script>/,
  `<script type="module">${bundledCode}</script>`
);

if (bundledHtml === indexHtml) {
  throw new Error("Failed to replace the runtime client loader in index.html.");
}

await writeFile(path.join(outDir, "index.html"), bundledHtml, "utf8");

console.log("Built client/dist/index.html");