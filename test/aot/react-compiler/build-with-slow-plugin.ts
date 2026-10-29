// bun run build-with-slow-plugin.ts <entry point> <executable>: ./build.ts, with a plugin that provides three files as they are on the disk, each a while after it is asked for.
const [entry, outfile] = process.argv.slice(2);
const provided: [RegExp, "ts" | "tsx" | "text", number][] = [
  [/gate\.ts$/, "ts", 300],
  [/Provided\.tsx$/, "tsx", 500],
  [/note\.txt$/, "text", 700],
];
const result = await Bun.build({
  entrypoints: [entry],
  target: "bun",
  reactCompiler: true,
  reactCompilerOutputMode: "client",
  compile: { outfile, aot: true },
  throw: false,
  plugins: [
    {
      name: "slow",
      setup(build) {
        for (const [filter, loader, milliseconds] of provided) {
          build.onLoad({ filter }, async ({ path }) => {
            await Bun.sleep(milliseconds);
            return { contents: await Bun.file(path).text(), loader };
          });
        }
      },
    },
  ],
});
for (const log of result.logs) console.error(String(log));
process.exit(result.success ? 0 : 1);
