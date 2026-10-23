import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Program } from "./compare";

export const repository = resolve(import.meta.dir, "../../..");

function filesUnder(folder: string, isWanted: (path: string) => boolean): string[] {
  if (!existsSync(folder)) throw new Error(`there is no folder ${folder}`);
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((one, other) => (one.name < other.name ? -1 : 1))) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (isWanted(path)) found.push(path);
    }
  };
  walk(folder);
  return found;
}

const slashes = (path: string) => path.replaceAll("\\", "/");

const startsProcesses = /child_process|cluster|worker_threads|\bWorker\b|execPath|execArgv|\bspawn|\bfork\b|\bexec(File)?(Sync)?\b|Bun\s*\.\s*\$|\$`|bunExe|bunRun/;

function markedIfTheyStartProcesses(programs: Program[]): Program[] {
  return programs.map(program =>
    !program.setAside && startsProcesses.test(program.files ? Object.values(program.files()).join("\n") : readFileSync(program.entry, "utf8")) ? { ...program, mayStartProcesses: true } : program,
  );
}

interface Metadata {
  includes: string[];
  flags: string[];
  isRejectedBeforeItRuns: boolean;
}

function metadataOf(text: string): Metadata {
  const yaml = /\/\*---(.*?)---\*\//s.exec(text)?.[1] ?? "";
  const list = (key: string) => {
    const inline = new RegExp(`^\\s*${key}:\\s*\\[(.*?)\\]`, "ms").exec(yaml);
    if (inline)
      return inline[1]
        .split(",")
        .map(item => item.trim())
        .filter(item => item);
    const listed = new RegExp(`^\\s*${key}:\\s*\\n((?:\\s+-\\s*.*\\n?)+)`, "m").exec(yaml);
    return listed
      ? listed[1]
          .trim()
          .split("\n")
          .map(item => item.trim().slice(1).trim())
      : [];
  };
  return { includes: list("includes"), flags: list("flags"), isRejectedBeforeItRuns: /negative:[^]*?phase:\s*(parse|resolution)/.test(yaml) };
}

function hostObject(text: string, isModule: boolean): string {
  const lines = ["var print = function (...values) { console.log(...values); };"];
  if (!text.includes("$262")) return lines.join("\n") + "\n";
  const members: string[] = [];
  if (text.includes("$262.global")) members.push("global: realm");
  if (text.includes("$262.gc")) members.push("gc() { Bun.gc(true); }");
  if (text.includes("detachArrayBuffer")) members.push("detachArrayBuffer(buffer) { buffer.transfer(); return null; }");
  if (text.includes("evalScript")) members.push("evalScript(text) { return evaluate(text); }");
  if (text.includes("createRealm")) {
    lines.push(isModule ? `import test262VM from "node:vm";` : `var test262VM = require("node:vm");`);
    members.push(`createRealm() { var context = test262VM.createContext({}); return test262Host(test262VM.runInContext("this", context), function (text) { return test262VM.runInContext(text, context); }); }`);
  }
  lines.push(`function test262Host(realm, evaluate) { return { ${members.join(", ")} }; }`);
  const needsGlobal = text.includes("$262.global");
  const needsEval = text.includes("evalScript");
  lines.push(`var $262 = test262Host(${needsGlobal ? "globalThis" : "undefined"}, ${needsEval ? "function (text) { return (0, eval)(text); }" : "undefined"});`);
  return lines.join("\n") + "\n";
}

export function test262(root: string): Program[] {
  const tests = join(root, "test");
  const harness = new Map<string, string>();
  const harnessFile = (name: string) => {
    if (!harness.has(name)) harness.set(name, readFileSync(join(root, "harness", name), "utf8"));
    return harness.get(name)!;
  };
  const programs: Program[] = [];
  for (const path of filesUnder(tests, path => path.endsWith(".js") && !path.includes("_FIXTURE"))) {
    const name = slashes(relative(tests, path));
    const { flags, isRejectedBeforeItRuns } = metadataOf(readFileSync(path, "utf8"));
    if (isRejectedBeforeItRuns) {
      programs.push({ corpus: "test262", name, entry: path, setAside: "must be rejected before it runs" });
      continue;
    }
    const isModule = flags.includes("module");
    const modes = flags.includes("raw") ? ["raw"] : isModule ? ["module"] : flags.includes("onlyStrict") ? ["strict"] : flags.includes("noStrict") ? ["sloppy"] : ["sloppy", "strict too"];
    for (const mode of modes) {
      const entry = isModule ? "test.mjs" : "test.cjs";
      programs.push({
        corpus: "test262",
        name: `${name} (${mode})`,
        entry,
        files: () => {
          const text = readFileSync(path, "utf8");
          if (mode === "raw") return { [entry]: text };
          const { includes } = metadataOf(text);
          const included = ["assert.js", "sta.js", ...(flags.includes("async") ? ["doneprintHandle.js"] : []), ...includes].map(harnessFile).join("\n");
          const files: Record<string, string> = { [entry]: `${mode.startsWith("strict") ? `"use strict";\n` : ""}${hostObject(included + text, isModule)}${included}\n${text}` };
          const waiting = [[path, text]];
          for (let next = waiting.pop(); next; next = waiting.pop()) {
            for (const [, specifier] of next[1].matchAll(/['"](\.{1,2}\/[^'"\n]*_FIXTURE[^'"\n]*)['"]/g)) {
              const fixture = resolve(dirname(next[0]), specifier);
              const beside = slashes(relative(dirname(path), fixture));
              if (beside.startsWith("..") || beside in files || !existsSync(fixture)) continue;
              files[beside] = readFileSync(fixture, "utf8");
              waiting.push([fixture, files[beside]]);
            }
          }
          return files;
        },
      });
    }
  }
  return programs;
}

const shellFunctions = `
var print = function (...values) { console.log(...values); };
var debug = print;
var testLoopCount = 2000;
var noInline = function () {}, neverInlineFunction = noInline, noDFG = noInline, noFTL = noInline, noOSRExitFuzzing = noInline, optimizeNextInvocation = noInline, ensureArrayStorage = noInline;
var gc = function () { Bun.gc(true); }, fullGC = gc, edenGC = gc;
var numberOfDFGCompiles = function () { return 0; }, reoptimizationRetryCount = numberOfDFGCompiles;
var isFinalTier = function () { return true; }, dfgTrue = function () { return false; }, ftlTrue = dfgTrue, isInt32 = function (value) { return (value | 0) === value; };
var preciseTime = function () { return performance.now() / 1000; };
var jscOptions = function () { return {}; };
var transferArrayBuffer = function (buffer) { buffer.transfer(); };
var version = function () { return 150; }, options = function () { return ""; }, quit = function () {};
var asyncTestStart = function () {}, asyncTestPassed = function () {};
`;

function shellFunctionsFor(text: string): string {
  const lines = [shellFunctions];
  if (text.includes("drainMicrotasks")) lines.push(`var drainMicrotasks = require("bun:jsc").drainMicrotasks;`);
  if (text.includes("createGlobalObject")) lines.push(`var createGlobalObject = function () { return require("node:vm").runInNewContext("globalThis"); };`);
  if (text.includes("runString")) lines.push(`var runString = function (text) { var context = require("node:vm").createContext({}); require("node:vm").runInContext(text, context); return require("node:vm").runInContext("globalThis", context); };`);
  if (text.includes("WScript")) lines.push(`var WScript = { Echo: print, LoadScriptFile: function () {}, Arguments: [], SetTimeout: setTimeout, ClearTimeout: clearTimeout };`);
  return lines.join("\n") + "\n";
}

function loadedBefore(root: string, folder: string, path: string, text: string): string {
  const before: string[] = [];
  if (folder === "mozilla") {
    const parts = relative(join(root, folder), dirname(path)).split(/[\\/]/);
    for (let depth = 1; depth <= parts.length; depth++) before.push(join(root, folder, ...parts.slice(0, depth), "shell.js"));
  }
  for (const [, loaded] of text.matchAll(/WScript\.LoadScriptFile\(\s*["']([^"']+)["']/g)) before.push(resolve(dirname(path), loaded.replace(/\\+/g, "/")));
  return before
    .filter(file => existsSync(file))
    .map(file => readFileSync(file, "utf8") + "\n")
    .join("");
}

export function jsTests(root: string, folders = ["stress", "es6", "microbenchmarks", "ChakraCore/test", "mozilla", "modules", "regexp"]): Program[] {
  const programs: Program[] = [];
  for (const folder of folders) {
    if (!existsSync(join(root, folder))) continue;
    const isWanted = (path: string) => /\.m?js$/.test(path) && !/[\\/]resources[\\/]|[\\/](shell|browser|template)\.js$|UnitTestFramework/.test(path);
    for (const path of filesUnder(join(root, folder), isWanted)) {
      const isModule = path.endsWith(".mjs") || folder === "modules";
      if (folder === "modules" && dirname(path) !== join(root, folder)) continue;
      const corpus = `JSTests/${folder.split("/")[0]}`;
      const name = slashes(relative(join(root, folder), path));
      if (isModule) programs.push({ corpus, name, entry: path });
      else
        programs.push({
          corpus,
          name,
          entry: "test.cjs",
          files: () => {
            const text = loadedBefore(root, folder, path, readFileSync(path, "utf8")) + readFileSync(path, "utf8");
            return { "test.cjs": shellFunctionsFor(text) + text };
          },
        });
    }
  }
  return markedIfTheyStartProcesses(programs);
}

function inPlace(corpus: string, folder: string, isWanted: (path: string) => boolean): Program[] {
  const root = join(repository, folder);
  return filesUnder(root, isWanted).map(path => ({ corpus, name: slashes(relative(root, path)), entry: path, mayStartProcesses: true }));
}

const isScript = (path: string) => /\.(js|mjs|cjs|ts|mts|cts|tsx|jsx)$/.test(path) && !path.endsWith(".d.ts");

export const nodeTests = () => [
  ...inPlace("node/parallel", "test/js/node/test/parallel", path => /[\\/]test-[^\\/]*\.m?js$/.test(path)),
  ...inPlace("node/sequential", "test/js/node/test/sequential", path => /[\\/]test-[^\\/]*\.m?js$/.test(path)),
];

export function bunTests(): Program[] {
  const standIn = JSON.stringify(join(import.meta.dir, "bun-test-stand-in.ts"));
  const programs: Program[] = [];
  for (const folder of ["bun", "node", "web"]) {
    const root = join(repository, "test/js", folder);
    for (const path of filesUnder(root, path => /\.test\.(ts|tsx|js|mjs)$/.test(path) && !/[\\/]test[\\/](parallel|sequential)[\\/]/.test(path))) {
      const entry = `copy${/\.[a-z]+$/.exec(path)![0]}`;
      programs.push({
        corpus: `bun-tests/${folder}`,
        name: slashes(relative(root, path)),
        entry,
        mayStartProcesses: true,
        files: () => ({
          [entry]: readFileSync(path, "utf8")
            .replace(/(["'])bun:test\1/g, standIn)
            .replace(/(\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])(\.{1,2}\/[^"'\n]*)\2/g, (_, before, __, specifier) => before + JSON.stringify(resolve(dirname(path), specifier))),
          "tsconfig.json": JSON.stringify({ extends: join(repository, "test/tsconfig.json") }),
        }),
      });
    }
  }
  return programs;
}

export const benches = () => inPlace("bench", "bench", path => isScript(path) && !/[\\/](fixtures?|site|install)[\\/]/.test(path));

export function documentedExamples(): Program[] {
  const root = join(repository, "docs");
  const extensions: Record<string, string> = { typescript: "ts", javascript: "js" };
  const programs: Program[] = [];
  for (const path of filesUnder(root, path => /\.mdx?$/.test(path))) {
    let number = 0;
    for (const [, language, text] of readFileSync(path, "utf8").matchAll(/^ *```(ts|tsx|js|jsx|mjs|cjs|typescript|javascript)\b[^\n]*\n(.*?)^ *```/gms)) {
      const entry = `example.${extensions[language] ?? language}`;
      programs.push({ corpus: "docs", name: `${slashes(relative(root, path))} ${++number}`, entry, files: () => ({ [entry]: text, "tsconfig.json": `{ "compilerOptions": { "strict": false, "noImplicitAny": false } }` }) });
    }
  }
  return markedIfTheyStartProcesses(programs);
}

export function aotPrograms(): Program[] {
  const root = join(repository, "test/aot/programs");
  const found: string[] = [];
  const walk = (folder: string) => {
    const entries = readdirSync(folder, { withFileTypes: true }).sort((one, other) => (one.name < other.name ? -1 : 1));
    const main = entries.find(entry => entry.isFile() && /^main\.(ts|tsx|js)$/.test(entry.name));
    if (main) return void found.push(join(folder, main.name));
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(folder, entry.name));
      else if (/\.(ts|tsx|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts") && folder !== root) found.push(join(folder, entry.name));
    }
  };
  walk(root);
  const programs = found.flatMap(path => {
    const beside = path.replace(/[\\/]main\.[a-z]+$/, "").replace(/\.[a-z]+$/, "");
    if (existsSync(beside + ".build-errors.txt") || existsSync(beside + ".todo.txt")) return [];
    const options: { build?: string[]; env?: Record<string, string>; skipInVariant?: Record<string, string> } = existsSync(beside + ".json") ? JSON.parse(readFileSync(beside + ".json", "utf8")) : {};
    // It says itself why it does not behave the same with --trim.
    if (options.skipInVariant?.["trimmed-runtime"]) return [];
    return [{ corpus: "aot-programs", name: slashes(relative(root, path)), entry: path, flags: options.build, env: options.env }];
  });
  return markedIfTheyStartProcesses(programs);
}

export function listed(paths: string[]): Program[] {
  return paths.map(path => ({ corpus: "listed", name: path, entry: resolve(path), mayStartProcesses: true }));
}
