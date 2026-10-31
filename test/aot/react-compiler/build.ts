// bun run build.ts <entry point> <executable> [<report for aotExplain>]: `bun build --compile --aot` with the React Compiler as a client build runs it, which only the API can ask for when the target is Bun.
const [entry, outfile, aotExplain] = process.argv.slice(2);
const result = await Bun.build({ entrypoints: [entry], target: "bun", reactCompiler: true, reactCompilerOutputMode: "client", compile: { outfile, aot: true, aotExplain }, throw: false });
for (const log of result.logs) console.error(String(log));
process.exit(result.success ? 0 : 1);
