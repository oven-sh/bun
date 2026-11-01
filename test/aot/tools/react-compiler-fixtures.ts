// Does the React Compiler do the same to a component under --aot as in a bundle?
//
//   bun test/aot/tools/react-compiler-fixtures.ts [--bun <bun>] [--jobs 16] [--as-written] [<part of a fixture's name>]
//
// Takes every upstream fixture of test/bundler/transpiler/react-compiler-fixtures that has an entry point. Each one is built alone with `--compile` and with
// `--compile --aot`, without minifying and with `minify.syntax`, and renders at least twice. The two executables must print the same results and ask for memo
// caches of the same sizes. A third executable, built without the compiler, must print the same results too: that finds a bug the first two share.
// Every top-level function declaration gets a "use memo" directive, because upstream's own harness compiles all of them; `--as-written` leaves the
// fixtures alone.
// It prints one line for each fixture that differs and exits with 1 if there is any. About 850 fixtures and 5,000 builds: eight minutes on 48 cores.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { availableParallelism, tmpdir } from "os";
import { extname, join } from "path";
import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  options: { "bun": { type: "string" }, "jobs": { type: "string" }, "as-written": { type: "boolean" } },
  allowPositionals: true,
});
const bun = values.bun ?? process.execPath;
const transpilerTests = join(import.meta.dir, "..", "..", "bundler", "transpiler");
const fixtures = join(transpilerTests, "react-compiler-fixtures");
const doesNotEnd = new Set(["ssa-for-trivial-update", "ssa-nested-loops-no-reassign", "ssa-while-no-reassign"]);
// It needs @enableResetCacheOnSourceFileChanges, which only upstream's harness can turn on.
const needsAnOption = new Set(["fast-refresh-refresh-on-const-changes-dev"]);
// These print a stack trace, or stop with an uncaught error while they load: the text names files and lines of the executable.
// `ValidateMemoization` throws when its input is new in a render in which its dependencies are not: without the compiler it is.
const onlyTheSourceThrows = new Set([
  "array-pattern-spread-creates-array",
  "dont-merge-if-dep-is-inner-declaration-of-previous-scope",
  "preserve-memo-deps-conditional-property-chain-less-precise-deps",
]);
const printsPositions = /^(console-readonly|error\.todo-object-expression-[gs]et-syntax|outlining-in-react-memo|react-namespace|use-operator-)/;

const room = ownTemporaryFolder(mkdtempSync(join(tmpdir(), "react-compiler-fixtures-")));
function write(path: string, text: string) {
  mkdirSync(join(room, path, ".."), { recursive: true });
  writeFileSync(join(room, path), text);
}

// Outside node_modules: a bundle treats a package named "react" in its own way.
const standIn = readFileSync(join(transpilerTests, "react-compiler-fixtures-run", "react.js"), "utf8");
write(
  "stand-in/react.js",
  standIn.replace(
    "export function c(size) {",
    "export const sizes = [];\nexport function c(size) {\n  if (!(instance.cache in instance.caches)) sizes.push(size);",
  ),
);
write("stand-in/fbt.js", "export const IntlVariations = {}; export const init = () => {};");
const sharedRuntime = await Bun.build({
  entrypoints: [join(fixtures, "shared-runtime.ts")],
  outdir: join(room, "stand-in"),
  target: "browser",
  external: ["*"],
  treeShaking: false,
});
if (!sharedRuntime.success) throw new AggregateError(sharedRuntime.logs, "shared-runtime.ts does not build");
const react = ["./stand-in/react.js"];
write(
  "tsconfig.json",
  JSON.stringify({
    compilerOptions: {
      target: "esnext",
      module: "preserve",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      allowJs: true,
      strict: false,
      types: [],
      skipLibCheck: true,
      paths: {
        "react": react,
        "react/compiler-runtime": react,
        "react/jsx-runtime": react,
        "react/jsx-dev-runtime": react,
        "shared-runtime": ["./stand-in/shared-runtime.js"],
        "fbt": ["./stand-in/fbt.js"],
      },
    },
  }),
);
write(
  "build.ts",
  `const [entry, outfile, kind, minified] = process.argv.slice(2);
const result = await Bun.build({
  entrypoints: [entry],
  target: "bun",
  reactCompiler: kind !== "uncompiled",
  reactCompilerOutputMode: "client",
  minify: minified === "syntax" ? { syntax: true } : false,
  compile: { outfile, aot: kind === "aot" },
  throw: false,
});
for (const log of result.logs) if (log.level === "error") console.error(String(log));
process.exit(result.success ? 0 : 1);
`,
);
// What test/bundler/transpiler/react-compiler-fixtures-run/render-fixture.js does, for one fixture.
const mainOf = (fixture: string) => `import React, { at, nextRender, render, sizes } from "react";
import * as fixture from "./${fixture}";
import { ownTemporaryFolder } from "../harness/temporary-folders";
Function.prototype.toString = () => "[function]";
globalThis.React = React;
for (const [name, value] of Object.entries(React)) if (name.startsWith("use")) globalThis[name] = value;
const print = console.log;
console.log = console.warn = console.error = () => {};
const entry = fixture.FIXTURE_ENTRYPOINT;
const results =
  typeof entry?.fn !== "function"
    ? ["has no entry point"]
    : (entry.sequentialRenders ?? [entry.params ?? [], entry.params ?? []]).map(parameters => {
        nextRender();
        const args = Array.isArray(parameters) ? parameters : [parameters];
        try {
          return entry.isComponent === false || !/^[A-Z]/.test(entry.fn.name)
            ? ["returns", at("root", () => render(entry.fn(...args), "root"))]
            : ["returns", render(React.createElement(entry.fn, args[0]), "root")];
        } catch (error) {
          return ["throws", error instanceof ReferenceError ? error.message : (error?.constructor?.name ?? typeof error)];
        }
      });
print(JSON.stringify({ results, sizes }));
process.exit(0);
`;

const files = [...new Bun.Glob("*.{js,jsx,ts,tsx}").scanSync(fixtures)].sort().filter(file => {
  const source = readFileSync(join(fixtures, file), "utf8");
  return (
    source.includes("FIXTURE_ENTRYPOINT") &&
    !/@flow|from ['"](fbt|invariant|idx|react-relay|react-native-reanimated)['"]/.test(source) &&
    !doesNotEnd.has(file.replace(/\.\w+$/, "")) &&
    !needsAnOption.has(file.replace(/\.\w+$/, "")) &&
    !printsPositions.test(file) &&
    file.includes(positionals[0] ?? "")
  );
});

async function run(cmd: string[], cwd: string) {
  const child = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signal: child.signalCode };
}

const counts = { same: 0, different: 0, "not as without the compiler": 0, "type errors": 0, "neither builds": 0 };
const resultsOf = (printed: string) => (printed.startsWith("{") ? JSON.stringify(JSON.parse(printed).results) : printed);
async function compare(file: string) {
  const folder = join("fixtures", file.replace(/\.\w+$/, ""));
  const fixture = "fixture" + (extname(file) === ".js" ? ".jsx" : extname(file));
  const text = readFileSync(join(fixtures, file), "utf8");
  const declaration = /^((?:export default |export )?(?:async )?function \w+\([^\n]*\)[^\n{]*\{)$/gm;
  write(join(folder, fixture), values["as-written"] ? text : text.replace(declaration, '$1\n  "use memo";'));
  write(join(folder, "main.js"), mainOf(fixture));
  for (const minified of ["none", "syntax"]) {
    const printed: Record<string, string> = {};
    for (const kind of ["bundle", "aot", "uncompiled"]) {
      const executable = join(room, folder, kind);
      const build = [bun, "run", join(room, "build.ts"), join(room, folder, "main.js"), executable, kind, minified];
      const built = await run(build, room);
      if (built.exitCode !== 0) {
        printed[kind] = `not built: ${built.signal ?? ""} ${built.stderr.trim().split("\n")[0]}`;
        continue;
      }
      const ran = await run([executable], join(room, folder));
      printed[kind] = ran.exitCode === 0 ? ran.stdout.trim() : `exit ${ran.exitCode} ${ran.signal ?? ""} ${ran.stderr}`;
      rmSync(executable, { force: true });
    }
    const isBuilt = (kind: string) => !printed[kind].startsWith("not built: ");
    if (!isBuilt("bundle") && !isBuilt("aot")) counts["neither builds"]++;
    // Only --aot checks types, and the fixtures were not written to pass.
    else if (/^not built:  \w+: TS\d+: /.test(printed.aot)) counts["type errors"]++;
    else if (printed.bundle !== printed.aot) {
      counts.different++;
      console.log(`${file} (minify: ${minified})\n  bundle: ${printed.bundle.slice(0, 400)}\n  aot:    ${printed.aot.slice(0, 400)}`);
    } else if (resultsOf(printed.aot) !== resultsOf(printed.uncompiled) && !onlyTheSourceThrows.has(file.replace(/\.\w+$/, ""))) {
      counts["not as without the compiler"]++;
      console.log(`${file} (minify: ${minified})\n  compiled:   ${resultsOf(printed.aot).slice(0, 400)}\n  uncompiled: ${resultsOf(printed.uncompiled).slice(0, 400)}`);
    } else counts.same++;
  }
}

const queue = [...files];
const jobs = Number(values.jobs) || availableParallelism();
await Promise.all(
  Array.from({ length: jobs }, async () => {
    for (let file; (file = queue.shift()); ) await compare(file);
  }),
);
rmSync(room, { recursive: true, force: true });
console.log(`${files.length} fixtures at two minify settings:`, counts);
process.exit(counts.different || counts["not as without the compiler"] ? 1 : 0);
