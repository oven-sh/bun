// bun run build.ts <entry point> <executable> <aot | bundle | uncompiled> <none | syntax | all>: `bun build --compile` at one minify setting, with the React Compiler and --aot,
// with the React Compiler alone, or with neither.
const [entry, outfile, kind, minified] = process.argv.slice(2);
const result = await Bun.build({
  entrypoints: [entry],
  target: "bun",
  reactCompiler: kind !== "uncompiled",
  reactCompilerOutputMode: "client",
  minify: minified === "all" ? true : minified === "syntax" ? { syntax: true } : false,
  define: { "process.env.MODE": '"fast"', IS_FAST: "true" },
  features: ["FAST"],
  compile: { outfile, aot: kind === "aot" },
  throw: false,
});
for (const log of result.logs) console.error(String(log));
process.exit(result.success ? 0 : 1);
