import { CORE, DFS, ENTRY_INLINE } from "./plan-linker.mjs";
import * as esbuild from "esbuild";
import zlib from "node:zlib";
const use = {
  CORE: CORE + "\nexport{__node,__cap}",
  "CORE+INLINE": "var __r=1;" + CORE + ENTRY_INLINE + "\nexport{__node,__d,__main,__resume}",
  "CORE+DFS": CORE + DFS + "\nexport{__node,__cap,__rec,__top,__evaluate,__import}",
};
for (const [k, v] of Object.entries(use)) {
  const r = await esbuild.transform(v, { minify: true, format: "esm" });
  console.log(k.padEnd(14), r.code.length, "bytes min,", zlib.gzipSync(r.code).length, "gz");
  if (k === "CORE") console.log(r.code);
}
