// scripts/jsc-exception-lint's checker over the C++ of --aot: the engine's aot/{runtime,object,builtins} and the files of src/jsc/bindings that call into AOT::.
// The checker models JSC's exception-scope validator (BUN_JSC_validateExceptionChecks=1, which CI's sanitizer lane sets) over the control flow of every function, so it also sees the paths that no test runs.
// Its own driver, run.ts, wants a prebuilt engine. Here the engine is compiled from its sources, and the compile database of the build names every unit.
//
// What a run needs to mean anything. Each of these, left out, gave a list that looked like a result:
// - clang's own headers (-resource-dir): the checker does not stand in the toolchain.
// - ASSERT_ENABLED=1: RETURN_IF_EXCEPTION looks at the exception on every path only through EXCEPTION_ASSERT. In a release the checker sees no check.
// - No precompiled header of a release, and not the generated header that stands for it either: that one begins with `#pragma clang system_header`,
//   and the checker passes over what is spelled in a system header, which ExceptionScope.h then is.
// - The unified units of the engine: a single file leans on what stands earlier in its unit, and a body that does not parse reads as one that cannot throw.
// So every run ends with a red control: exception-scope-lint-control.cpp.
import { spawn } from "bun";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

type Entry = { directory: string; file: string; arguments: string[] };
type Finding = {
  file: string;
  function: string;
  callee: string;
  kind: string;
  message: string;
};

const repository = resolve(import.meta.dir, "../../..");
const checkerFolder = join(repository, "scripts/jsc-exception-lint");
const control = join(import.meta.dir, "exception-scope-lint-control.cpp");

async function run(cmd: string[]) {
  const child = spawn({ cmd, cwd: repository, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

async function buildChecker(llvm: string, folder: string) {
  const source = join(checkerFolder, "jsc-exception-lint.cpp");
  const checker = join(folder, "jsc-exception-lint");
  if (existsSync(checker) && statSync(checker).mtimeMs >= statSync(source).mtimeMs) return checker;
  const libraries = readdirSync(join(llvm, "lib"));
  const words = async (word: string) => (await run([join(llvm, "bin/llvm-config"), word])).stdout.trim().split(/\s+/);
  // A toolchain without a shared libLLVM links the archives. llvm-config names system libraries where they lay on the machine that built it.
  const linked = libraries.some(name => /^libLLVM(-[\d.]+)?\.so/.test(name))
    ? ["-lclang-cpp", "-lLLVM", `-Wl,-rpath,${llvm}/lib`]
    : [
        "-fuse-ld=lld",
        "-Wl,--start-group",
        ...libraries
          .filter(
            name =>
              /^libclang[A-Z]\w*\.a$/.test(name) &&
              !/Plugin|Daemon|Doc|IncludeFixer|Tidy|Interpreter|Handle|Repl/.test(name),
          )
          .map(name => join(llvm, "lib", name)),
        "-Wl,--end-group",
        ...(await words("--libs")),
        ...(await words("--system-libs")).map(word => word.replace(/^\/.*\/lib(\w+)\.(a|so)$/, "-l$1")),
      ];
  const defines = ["_GNU_SOURCE", "__STDC_CONSTANT_MACROS", "__STDC_FORMAT_MACROS", "__STDC_LIMIT_MACROS"].map(
    name => "-D" + name,
  );
  const flags = ["-std=c++17", "-O2", "-fno-rtti", "-fno-exceptions", `-I${llvm}/include`, ...defines];
  const built = await run([join(llvm, "bin/clang++"), ...flags, source, "-o", checker, `-L${llvm}/lib`, ...linked]);
  if (built.exitCode) throw new Error("the checker does not build:\n" + built.stderr.slice(-3000));
  return checker;
}

function writeDatabase(buildFolder: string, folder: string) {
  const entries: Entry[] = JSON.parse(readFileSync(join(buildFolder, "compile_commands.json"), "utf8"));
  for (const entry of entries) {
    const at = entry.arguments.indexOf("-include-pch");
    if (at >= 0) {
      const generated = readFileSync(resolve(entry.directory, entry.arguments[at + 1].replace(/\.pch$/, "")), "utf8");
      entry.arguments.splice(at, 2, "-include", /#include ["<](\/[^">]+)/.exec(generated)![1]);
    }
    entry.arguments.splice(1, 0, "-DASSERT_ENABLED=1");
  }
  const like = entries.find(entry => entry.file.endsWith("/bindings/BunPlugin.cpp"))!;
  const asControl = like.arguments.map(word => (word.endsWith("BunPlugin.cpp") ? control : word));
  writeFileSync(
    join(folder, "compile_commands.json"),
    JSON.stringify([...entries, { ...like, file: control, arguments: asControl }]),
  );
  return entries.map(entry => entry.file);
}

/** One line for each place where a call is made, or a function left, while a check is owed, and both sides reach a function that declares a scope. */
export async function findPlacesThatOweCheck(buildFolder: string, llvm: string) {
  const folder = join(buildFolder, "exception-scope-lint");
  mkdirSync(folder, { recursive: true });
  const checker = await buildChecker(llvm, folder);
  const files = writeDatabase(buildFolder, folder);
  const resources = (await run([join(llvm, "bin/clang++"), "-print-resource-dir"])).stdout.trim();
  const front = [checker, "-p", folder, `--extra-arg=-resource-dir=${resources}`, "--extra-arg=-Wno-everything"];
  front.push(`--nothrow=${join(checkerFolder, "nothrow.txt")}`);

  const text = (file: string) => readFileSync(file, "utf8");
  const units = (names: string) => new RegExp(`UnifiedSource-(${names})-\\d+\\.cpp$`);
  const ofEngine = files.filter(
    file =>
      units("runtime|API|heap|bytecode|jit|root|interpreter|builtins").test(file) ||
      /\/JavaScriptCore\/(runtime|heap|interpreter)\/[^/]+\.cpp$/.test(file),
  );
  const ofCompiler = files.filter(
    file => units("aot").test(file) && /aot\/(runtime|object|builtins)\//.test(text(file)),
  );
  const ofBindings = files.filter(file => /\/src\/jsc\/bindings\/.*\.cpp$/.test(file) && text(file).includes("AOT::"));
  const engine = files
    .map(file => /^(.*\/Source\/JavaScriptCore\/)(?:runtime|heap|aot)\//.exec(file)?.[1])
    .find(Boolean)!;
  const sources = ofBindings[0].replace(/\/src\/jsc\/bindings\/.*/, "/src/");

  // A body that does not parse reads as one that cannot throw: the checker is blind there.
  const unitsWithErrors = new Set<string>();
  async function overEach(list: string[], words: (index: number) => string[]) {
    const waiting = [...list.entries()];
    const printed: string[] = [];
    const worker = async () => {
      for (let next = waiting.shift(); next; next = waiting.shift()) {
        const { stdout, stderr } = await run([...front, ...words(next[0]), next[1]]);
        if (/ error: /.test(stderr)) unitsWithErrors.add(basename(next[1]));
        printed.push(stdout);
      }
    };
    await Promise.all(Array.from({ length: Math.min(16, cpus().length) }, worker));
    return printed.join("");
  }
  const summaries: string[] = [];
  async function summarize(label: string, list: string[], under: string, kept: number) {
    const parts = join(folder, label);
    rmSync(parts, { recursive: true, force: true });
    mkdirSync(parts);
    const imports = summaries.map(file => `--import-summaries=${file}`);
    await overEach(list, index => [
      "--only-under=NEVER",
      `--export-under=${under}`,
      ...imports,
      `--export-summaries=${join(parts, index + ".tsv")}`,
    ]);
    const lines = new Set(readdirSync(parts).flatMap(name => text(join(parts, name)).split("\n")));
    const known = [...lines].filter(line => line && line.split("\t")[2] !== "unknown").sort();
    writeFileSync(parts + ".tsv", known.join("\n") + "\n");
    summaries.length = kept;
    summaries.push(parts + ".tsv");
  }
  // A round follows calls into other units one level further.
  await summarize("engine-1", ofEngine, engine, 0);
  await summarize("engine-2", ofEngine, engine, 0);
  await summarize("compiler-1", ofCompiler, engine + "aot/", 1);
  await summarize("compiler-2", ofCompiler, engine + "aot/", 1);
  await summarize("bindings-1", ofBindings, sources, 2);
  const imports = summaries.map(file => `--import-summaries=${file}`);
  const parse = (printed: string): Finding[] =>
    printed
      .split("\n")
      .filter(line => line.startsWith("{"))
      .map(line => JSON.parse(line));
  const report = async (list: string[], under: string) =>
    parse(await overEach(list, () => [`--only-under=${under}`, ...imports, "--json"]));
  const inControl = await report([control], dirname(control) + "/");
  const reported = (name: string) => inControl.some(finding => finding.function.endsWith("::" + name));
  if (!reported("unchecked") || reported("checked"))
    throw new Error(
      `the red control failed: unchecked ${reported("unchecked")}, checked ${reported("checked")}: this run says nothing`,
    );

  // The checker takes whatever has a JSGlobalObject* in its signature, and every indirect call, for something that may throw. Only what reaches a declared scope by the calls it recorded counts here.
  const known = new Map<string, [string, string][]>();
  for (const line of summaries.flatMap(file => text(file).split("\n"))) {
    const [, name, kind, , , why] = line.split("\t");
    if (why === undefined) continue;
    const bare = name.replace(/\/\d+$/, "");
    known.set(bare, [...(known.get(bare) ?? []), [kind, why]]);
  }
  const answers = new Map<string, boolean>();
  function reachesScope(name: string | undefined, depth = 0): boolean {
    if (!name || depth > 8 || !known.has(name)) return false;
    if (answers.has(name)) return answers.get(name)!;
    answers.set(name, false);
    const answer = known
      .get(name)!
      .some(
        ([kind, why]) =>
          (kind === "maythrow" && why.startsWith("declares a ThrowScope")) ||
          (kind !== "nothrow" && reachesScope(/^calls (.+?) at /.exec(why)?.[1], depth + 1)),
      );
    answers.set(name, answer);
    return answer;
  }
  const isOurs = (finding: Finding, earlier: string) =>
    /\/aot\//.test(finding.file) ||
    /AOT::/.test(earlier + finding.callee) ||
    /Compiled|AOT|aot|Mock|mock/.test(finding.function);
  const places = new Set<string>();
  for (const finding of [...(await report(ofCompiler, engine + "aot/")), ...(await report(ofBindings, sources))]) {
    const earlier = /(?:pending after|after) (.+?) \([\w./-]+:\d+\)/.exec(finding.message)?.[1] ?? "";
    const later = finding.callee.split(" (")[0];
    const counts =
      finding.kind === "unchecked-exit"
        ? reachesScope(later)
        : /^(pending-call|scope-while-pending)$/.test(finding.kind) && reachesScope(earlier) && reachesScope(later);
    if (counts && isOurs(finding, earlier))
      places.add(`${basename(finding.file)} | ${finding.function} | ${finding.kind} | ${earlier} > ${later}`);
  }
  return {
    places: [...places].sort(),
    unitsWithErrors: [...unitsWithErrors].sort(),
    units: ofEngine.length + ofCompiler.length + ofBindings.length,
  };
}

if (import.meta.main) {
  const [buildFolder, llvm] = process.argv.slice(2);
  const { places, unitsWithErrors, units } = await findPlacesThatOweCheck(resolve(buildFolder), resolve(llvm));
  console.error(`${units} units, did not parse whole: [${unitsWithErrors}], ${places.length} places`);
  console.log(places.join("\n"));
}
