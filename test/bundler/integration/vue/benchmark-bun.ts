import path from "path";
import vue from "esbuild-plugin-vue-next";
import { bench, group, run } from "mitata";
import * as esbuild from "esbuild";

group("esbuild-plugin-vue-next", () => {
  bench("Bun.build", async () => {
    await Bun.build({
      entrypoints: [path.join(import.meta.dir, "/index.js")],
      outdir: path.join(import.meta.dir, "/dist"),
      plugins: [vue({}) as any],
      minify: true,
      splitting: true,
    });
  });
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  bench("esbuild.build", async () => {
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
});
await run();
