import path from "path";
import vue from "esbuild-plugin-vue-next";
import { bench } from "mitata";

const build = await Bun.build({
  entrypoints: [path.join(import.meta.dir, "/index.js")],
  outdir: path.join(import.meta.dir, "/dist"),
  plugins: [vue({}) as any],
  minify: true,
  splitting: true,
});

if (!build.success) {
  throw new AggregateError(build.logs);
}

console.log(build);
