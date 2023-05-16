import path from "path";
import * as esbuild from "esbuild";
import vue from "esbuild-plugin-vue-next";
import { bench, run } from "mitata";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
bench("vue plugin", async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "/index.js")],
    outdir: path.join(__dirname, "/dist"),
    plugins: [vue({})],
    minify: true,
    splitting: true,
    format: "esm",
    bundle: true,
  });
});
await run();
