// Run in a fresh process: LIB must be set before any reader or harness imports.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createLinker, parseArguments } from "../../../scripts/build/trim/link.ts";
import { coff } from "../../../scripts/build/trim/linker-coff.ts";

const [mode, folder, kind = "lib", tag = "normal"] = process.argv.slice(2);
const library = "bun_trim_private_search_fixture.lib";
const pathOf = (name: string) => join(folder!, name);
const compiler = Bun.which("clang")!;
const driver = Bun.which("clang-cl")!;
const originalLinker = Bun.which("lld-link")!;
const librarian = Bun.which("llvm-lib")!;
function run(command: string[], cwd = folder!) {
  // Match Link.log's byte-preserving latin1 representation, including UTF-8 paths.
  const result = spawnSync(command[0]!, command.slice(1), { cwd, encoding: "latin1" });
  if (result.error) throw result.error;
  return { exitCode: result.status, log: result.stdout + result.stderr };
}
function checked(command: string[], cwd = folder!) {
  const result = run(command, cwd);
  if (result.exitCode !== 0) throw new Error(JSON.stringify({ command, ...result }));
  return result;
}
const version = checked([originalLinker, "--version"]).log.match(/LLD (\d+)/)![1]!;
const resource = pathOf(`private-llvm/lib/clang/${version}/lib/windows`);
const valid = kind === "resource" ? resource : pathOf("valid-库 空格");
const shadow = pathOf("shadow");
const linker = kind === "resource" ? pathOf("private-llvm/bin/lld-link.exe") : originalLinker;

if (mode === "prepare") {
  mkdirSync(valid, { recursive: true });
  mkdirSync(shadow, { recursive: true });
  if (kind === "resource") {
    mkdirSync(pathOf("private-llvm/bin"), { recursive: true });
    copyFileSync(originalLinker, linker);
  }
  writeFileSync(
    pathOf("main.c"),
    "__declspec(dllexport) int left(void) { return 11; }\n__declspec(dllexport) int right(void) { return 29; }\nint probe(void); int main(void) { return probe(); }\n",
  );
  checked([
    compiler,
    "--target=x86_64-pc-windows-msvc",
    "-O0",
    "-ffreestanding",
    "-ffunction-sections",
    "-fno-stack-protector",
    "-c",
    "main.c",
    "-o",
    "main.obj",
  ]);
  for (const [directory, target] of [
    [valid, "left"],
    [shadow, "right"],
  ]) {
    writeFileSync(join(directory!, "shared.c"), `int ${target}(void); int probe(void) { return ${target}(); }\n`);
    checked(
      [
        compiler,
        "--target=x86_64-pc-windows-msvc",
        "-O0",
        "-ffreestanding",
        "-ffunction-sections",
        "-fno-stack-protector",
        "-c",
        "shared.c",
        "-o",
        "shared.obj",
      ],
      directory!,
    );
    checked([librarian, "/nologo", `/out:${library}`, "shared.obj"], directory!);
  }
  // The archive is deliberately a bare positional input, not /defaultlib:
  // /nodefaultlib must not suppress it, and an absolute input would bypass LIB.
  writeFileSync(pathOf("in.rsp"), `"${pathOf("main.obj")}"\n${library}\n`);
  writeFileSync(pathOf("not-a-directory"), "not a library search directory\n");
  console.log(JSON.stringify({ valid, shadow, library }));
  process.exit(0);
}

const commandPath = pathOf(`${tag}.command.json`);
const command: string[] =
  mode === "link" || mode === "negative-link"
    ? [
        driver,
        "/nologo",
        "-fuse-ld=lld",
        "/clang:-B" + dirname(linker),
        "@" + pathOf("in.rsp"),
        "/Fe" + pathOf(`${tag}.exe`),
        "/link",
        "/machine:x64",
        "/entry:main",
        "/nodefaultlib",
        "/subsystem:console",
        "/opt:ref",
        "/opt:icf",
        "/print-search-paths",
        "/map:" + pathOf(`${tag}.map`),
        "/lldmap:" + pathOf(`${tag}.lldmap`),
        ...(tag === "ignoreenv" ? ["/lldignoreenv"] : []),
      ]
    : JSON.parse(readFileSync(commandPath, "utf8"));
if (mode === "negative-link") {
  const result = run(command);
  if (result.exitCode === 0 || !result.log.includes(library)) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify({ missingLibrary: true }));
  process.exit(0);
}
if (mode === "link") {
  const { log } = checked(command);
  writeFileSync(commandPath, JSON.stringify(command));
  writeFileSync(pathOf(`${tag}.log`), log);
}
const execution = run([pathOf(`${tag}.exe`)]);
if (execution.exitCode !== 11) throw new Error(JSON.stringify({ actualProgram: execution }));
if (existsSync(pathOf(library))) throw new Error("bare archive unexpectedly exists in cwd");
const args = parseArguments([
  "bun",
  "link.ts",
  pathOf(`${tag}.work`),
  pathOf("unused-features.json"),
  pathOf("unused-builtins.json"),
  "--",
  ...command,
]);
const format = coff(createLinker(args).linker);
const read = () =>
  format.read({
    name: "second",
    executable: pathOf(`${tag}.exe`),
    map: pathOf(`${tag}.lldmap`),
    log: mode === "missing-trace" ? "" : readFileSync(pathOf(`${tag}.log`), "utf8"),
  });
if (mode === "missing-trace") {
  let message = "";
  try {
    read();
  } catch (error) {
    message = String(error);
  }
  if (!/LLD library search paths|print-search-paths/i.test(message))
    throw new Error("missing trace was not refused: " + message);
  console.log(JSON.stringify({ missingTraceRefused: true }));
  process.exit(0);
}
const result = read();
const graph = result.graph;
const main = graph.names.findIndex(names => names.includes("main"));
if (main < 0 || graph.isRoot[main] !== 1) throw new Error("entry point main is not a graph root");
const probe = graph.names.findIndex(names => names.includes("probe"));
if (probe < 0) throw new Error("archive member probe is missing");
const targets = Array.from(
  graph.successors.slice(graph.successorStart[probe], graph.successorStart[probe + 1]),
).flatMap(node => graph.names[node]!);
if (result.failures.length !== 0 || !targets.includes("left") || targets.includes("right"))
  throw new Error(JSON.stringify({ failures: result.failures, targets }));
if (!readFileSync(pathOf(`${tag}.map`), "utf8").includes("bun_trim_private_search_fixture:shared.obj"))
  throw new Error("map did not use the private archive member");
console.log(JSON.stringify({ failures: result.failures, targets }));
