// Runs TypeScript's own compiler and conformance tests as programs. The cases come from test/cli/check/typescript-go/bundle.zst,
// where `bun check` already compares its diagnostics with typescript-go's. Here every case that type-checks is run twice, with
// `bun run` and as a `bun build --compile --aot` executable, and both runs must end the same way: same exit status, same
// stdout, same error class. Most cases print nothing, so this mainly catches compiler crashes, build refusals and exceptions
// that only the compiled program throws.
//
//   bun test test/aot/typescript-cases                               every 50th case
//   AOT_TYPESCRIPT_CASES=all bun test test/aot/typescript-cases      all of them, about 9,000 (slow)
//   AOT_TYPESCRIPT_CASES=enumMerging bun test test/aot/typescript-cases    cases whose path contains the text
//   AOT_TYPESCRIPT_CASES_REPORT=/tmp/report ...    also writes what was unexpected to /tmp/report.<part>.json
//
// typescript-cases.known.json lists the cases that are expected to differ: "<outcome> | <reason>". The outcome "any" is for a case whose
// output is not deterministic.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { availableParallelism } from "os";
import { dirname, join } from "path";
import { unsupported, withoutDebugInformation } from "./run-programs";
import known from "./typescript-cases.known.json";

const selection = process.env.AOT_TYPESCRIPT_CASES ?? "";
const shardCount = 8;
const carrier = unsupported ? [] : withoutDebugInformation();
const casesRoot = "/_submodules/TypeScript/tests/cases/";

// Directives that need a different module system, extra inputs or a non-default library.
const skippedDirective =
  /^\s*\/\/\s*@(jsx|module\s*:\s*(amd|system|umd)|outfile|noLib|lib\s*:|allowJs|checkJs|emitDeclarationOnly|moduleResolution|paths|baseUrl|types\b|typeRoots)/im;
const booleanOptions = new Map(
  [
    "strict",
    "noImplicitAny",
    "strictNullChecks",
    "strictPropertyInitialization",
    "strictFunctionTypes",
    "strictBindCallApply",
    "noImplicitThis",
    "alwaysStrict",
    "useDefineForClassFields",
    "exactOptionalPropertyTypes",
    "noUncheckedIndexedAccess",
    "experimentalDecorators",
    "emitDecoratorMetadata",
    "useUnknownInCatchVariables",
    "noImplicitOverride",
    "noPropertyAccessFromIndexSignature",
    "allowUnreachableCode",
    "allowUnusedLabels",
    "noImplicitReturns",
    "noFallthroughCasesInSwitch",
    "noUnusedLocals",
    "noUnusedParameters",
    "preserveConstEnums",
    "isolatedModules",
    "verbatimModuleSyntax",
    "erasableSyntaxOnly",
  ].map(name => [name.toLowerCase(), name]),
);

function readCases(): [name: string, source: string][] {
  const bytes = Buffer.from(
    Bun.zstdDecompressSync(readFileSync(join(import.meta.dir, "../cli/check/typescript-go/bundle.zst"))),
  );
  const cases: [string, string][] = [];
  for (let at = 0; at < bytes.length;) {
    const end = bytes.indexOf(10, at);
    const header = bytes.toString("utf8", at + 4, end);
    const space = header.lastIndexOf(" ");
    const [path, length] = [header.slice(0, space), Number(header.slice(space + 1))];
    if (path.startsWith(casesRoot) && path.endsWith(".ts") && !path.endsWith(".d.ts")) {
      cases.push([path.slice(casesRoot.length), bytes.toString("utf8", end + 1, end + 1 + length)]);
    }
    at = end + 1 + length + 1;
  }
  return cases;
}

function compilerOptions(source: string) {
  const options: Record<string, unknown> = { types: [] };
  for (const [, name, value] of source.matchAll(/^\s*\/\/\s*@(\w+)\s*:\s*([^\r\n]*)/gm)) {
    const option = booleanOptions.get(name.toLowerCase());
    const first = value.split(",")[0].trim().toLowerCase();
    if (option && (first === "true" || first === "false")) options[option] = first === "true";
  }
  return options;
}

// Writes the case's files and returns the entry point, or undefined when the case has inputs other than TypeScript modules.
function writeCase(folder: string, source: string): string | undefined {
  const pieces = source.split(/^\s*\/\/\s*@filename\s*:\s*([^\r\n]+)\r?\n/im);
  let files: [string, string][] = [["main.ts", source]];
  if (pieces.length > 1) {
    files = [];
    for (let i = 1; i < pieces.length; i += 2) files.push([pieces[i].trim().replace(/^\/+/, ""), pieces[i + 1]]);
    if (
      files.some(([name]) => name.includes("..") || !/\.(ts|mts|cts)$/.test(name)) ||
      files.at(-1)![0].endsWith(".d.ts")
    )
      return;
  }
  for (const [name, text] of files) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    writeFileSync(join(folder, name), text);
  }
  const entryPoint = files.at(-1)![0];
  const included = files.map(([name]) => name).filter(name => name === entryPoint || name.endsWith(".d.ts"));
  writeFileSync(
    join(folder, "tsconfig.json"),
    JSON.stringify({ compilerOptions: compilerOptions(source), files: included }),
  );
  return entryPoint;
}

async function run(cmd: string[], cwd: string, timeout: number) {
  await using spawned = Bun.spawn({ cmd, cwd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout });
  const [stdout, stderr, exitCode] = await Promise.all([spawned.stdout.text(), spawned.stderr.text(), spawned.exited]);
  const timedOut = spawned.signalCode === "SIGTERM" || spawned.signalCode === "SIGKILL";
  return { stdout, stderr, exitCode, timedOut, signal: timedOut ? null : spawned.signalCode };
}

const errorClass = (text: string) => /\b((?:[A-Z][a-z]+)*Error)\b/.exec(text)?.[1] ?? "";

// "same", "skipped" (not judged), or a short description of how the compiled program departs from `bun run`.
async function judge(folder: string, source: string): Promise<string> {
  const entryPoint = writeCase(folder, source);
  if (!entryPoint) return "skipped";
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-threads=1",
      ...carrier,
      "./" + entryPoint,
      "--outfile",
      "./compiled",
    ],
    folder,
    120_000,
  );
  const said = built.stdout + built.stderr;
  if (built.signal || /\bpanic/.test(said)) return "the build crashed";
  if (built.timedOut) return "the build hangs";
  const interpreted = await run([bunExe(), "run", "./" + entryPoint], folder, 20_000);
  if (!existsSync(join(folder, isWindows ? "compiled.exe" : "compiled"))) {
    const refusal = /error: [^\n]*bun compile does not support ([^\n]*)/.exec(said);
    if (refusal) return interpreted.exitCode === 0 ? "unsupported: " + refusal[1].slice(0, 60) : "skipped";
    if (/error: internal/.test(said)) return "internal compiler error";
    return "skipped";
  }
  if (interpreted.timedOut) return "skipped";
  const compiled = await run(["./compiled"], folder, 40_000);
  if (compiled.signal) return "the program crashed: " + compiled.signal;
  if (compiled.timedOut) return "the program hangs";
  if ((compiled.exitCode === 0) !== (interpreted.exitCode === 0)) {
    return compiled.exitCode
      ? "throws " + errorClass(compiled.stderr)
      : "does not throw " + errorClass(interpreted.stderr);
  }
  if (compiled.stdout !== interpreted.stdout) return "different output";
  if (compiled.exitCode && errorClass(compiled.stderr) !== errorClass(interpreted.stderr)) {
    return `throws ${errorClass(compiled.stderr)} instead of ${errorClass(interpreted.stderr)}`;
  }
  return "same";
}

// These spread an iterator that never ends. `bun run` fills memory with it for as long as it is let, 10 GB and more.
const neverEnds = new Set(["conformance/es6/destructuring/iterableArrayPattern15.ts"]);

const cases = unsupported
  ? []
  : readCases()
      .filter(([, source]) => !skippedDirective.test(source))
      .filter(([name], index) => (selection === "all" ? true : selection ? name.includes(selection) : index % 50 === 0))
      .filter(([name]) => !neverEnds.has(name));

for (let shard = 0; shard < shardCount; shard++) {
  test.skipIf(!!unsupported)(
    `TypeScript's test cases end the same way compiled, part ${shard + 1} of ${shardCount}`,
    async () => {
      using root = tempDir("aot-typescript-cases", {});
      const mine = cases.filter((_, index) => index % shardCount === shard);
      const unexpected: Record<string, string> = {};
      let next = 0;
      const worker = async () => {
        while (next < mine.length) {
          const index = next++;
          const [name, source] = mine[index];
          const folder = join(String(root), String(index));
          mkdirSync(folder);
          const outcome = await judge(folder, source);
          rmSync(folder, { recursive: true, force: true });
          const expected = (known as Record<string, string>)[name]?.split(" | ")[0] ?? "same";
          if (outcome !== "skipped" && expected !== "any" && outcome !== expected) unexpected[name] = outcome;
        }
      };
      await Promise.all(Array.from({ length: availableParallelism() }, worker));
      const report = process.env.AOT_TYPESCRIPT_CASES_REPORT;
      if (report) writeFileSync(`${report}.${shard + 1}.json`, JSON.stringify(unexpected, null, 1));
      expect(unexpected).toEqual({});
    },
    selection === "all" ? 3_600_000 : 600_000,
  );
}
