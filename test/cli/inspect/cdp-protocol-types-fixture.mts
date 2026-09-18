// Run under node by bun-inspector-protocol.test.ts: typechecks src/js/internal/inspector/cdp.ts
// with the options of `tsc -p src/js` and prints the diagnostics as a JSON array of
// "file:line: message" strings. An optional argument is a file whose contents stand in for the
// protocol snapshot (packages/bun-inspector-protocol/src/protocol/jsc/index.d.ts) cdp.ts imports.
//
// builtins.d.ts declares the `$` intrinsics cdp.ts uses. What the real project layers on top of it,
// the build's codegen output that builtins.d.ts references and the @types auto-include (between
// them, the per-module typing of `require()`), is left out: the codegen output does not exist in a
// test checkout and none of it bears on the JSC side, so `require()` is declared loosely instead.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import ts from "typescript";

const repoRoot = join(import.meta.dirname, "../../..");
const jsDir = join(repoRoot, "src/js");
const configPath = join(jsDir, "tsconfig.json");
const builtinsPath = join(jsDir, "builtins.d.ts");
const snapshotPath = join(repoRoot, "packages/bun-inspector-protocol/src/protocol/jsc/index.d.ts");
// Only exists inside the compiler host below.
const requireStubPath = join(jsDir, "require.d.ts");
const snapshotReplacement = process.argv[2] === undefined ? undefined : readFileSync(process.argv[2], "utf8");

// TypeScript reports paths with forward slashes on every platform.
function samePath(a: string, b: string): boolean {
  return a.replaceAll("\\", "/") === b.replaceAll("\\", "/");
}

const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
const { options, fileNames } = ts.parseJsonConfigFileContent(
  { ...config, include: undefined, files: ["internal/inspector/cdp.ts", "builtins.d.ts"] },
  ts.sys,
  jsDir,
  { composite: false, types: [] },
  configPath,
);

const host = ts.createCompilerHost(options);
const { fileExists, readFile } = host;
host.fileExists = file => samePath(file, requireStubPath) || fileExists(file);
host.readFile = file => {
  if (samePath(file, requireStubPath)) return "declare function require(id: string): any;\n";
  if (samePath(file, snapshotPath) && snapshotReplacement !== undefined) return snapshotReplacement;
  const text = readFile(file);
  return samePath(file, builtinsPath) ? text?.replaceAll(/^\/\/\/ <reference .*$/gm, "") : text;
};

const program = ts.createProgram([...fileNames, requireStubPath], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program).map(({ file, start, messageText }) => {
  const where = file ? `${basename(file.fileName)}:${file.getLineAndCharacterOfPosition(start!).line + 1}: ` : "";
  return where + ts.flattenDiagnosticMessageText(messageText, "\n");
});
console.log(JSON.stringify(diagnostics));
