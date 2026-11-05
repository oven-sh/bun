import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// A Bun built with ENABLE_AOT=0 takes every name of `JSC::AOT` that its C++ uses outside `#if ENABLE(AOT)` from
// src/jsc/bindings/BunWithoutAOT.h. Most lanes build with the compiler and never compile that header's body, so a call
// site that gets no stand-in there stops only the builds without it.

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const header = "src/jsc/bindings/BunWithoutAOT.h";
const broughtByIncludesOfHeader = new Set(["Image"]);

type Use = { name: string; at: string };

type Region = "with" | "without" | "either";

function readRegions(text: string): { line: string; number: number; region: Region }[] {
  const onlyWithCompiler = new Set<string>();
  const asks = (condition: string) =>
    /(?<!!\s*)\bENABLE\(AOT\)/.test(condition) ||
    [...onlyWithCompiler].some(macro => new RegExp(`(?<!!\\s*)\\b${macro}\\b`).test(condition));
  const regions: Region[] = [];
  const lines: { line: string; number: number; region: Region }[] = [];
  text.split("\n").forEach((line, index) => {
    const directive = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif|define)\b(.*)$/.exec(line);
    const isWithCompiler = regions.includes("with");
    switch (directive?.[1]) {
      case "if":
      case "ifdef":
      case "ifndef":
        regions.push(asks(directive[2]) ? "with" : /!\s*ENABLE\(AOT\)/.test(directive[2]) ? "without" : "either");
        return;
      case "elif":
      case "else":
        if (regions.at(-1) === "with") regions[regions.length - 1] = "without";
        else if (regions.at(-1) === "without" && directive[1] === "else") regions[regions.length - 1] = "with";
        return;
      case "endif":
        regions.pop();
        return;
      case "define": {
        const defined = /^\s*(\w+)\s+1\s*$/.exec(directive[2]);
        if (defined && isWithCompiler) onlyWithCompiler.add(defined[1]);
        return;
      }
    }
    const region = isWithCompiler ? "with" : regions.includes("without") ? "without" : "either";
    lines.push({ line, number: index + 1, region });
  });
  return lines;
}

function usesOutsideGuard(file: string, text: string): Use[] {
  const aliases = new Set<string>();
  const uses: Use[] = [];
  for (const { line, number, region } of readRegions(text)) {
    if (region === "with") continue;
    const at = `${file}:${number}`;
    const code = line.replace(/\/\/.*$/, "");
    const alias = /\bnamespace\s+(\w+)\s*=\s*(?:JSC::)?AOT(?:::\w+)*\s*;/.exec(code);
    if (alias) aliases.add(alias[1]);
    if (/\busing\s+namespace\s+(?:JSC::)?AOT\b/.test(code)) uses.push({ name: "(every name: using namespace)", at });
    const opened = new RegExp(`(?<![\\w:])(?:JSC::)?(?:${["AOT", ...aliases].join("|")})((?:::\\w+)+)`, "g");
    for (const [, path] of code.matchAll(opened)) {
      const names = path.split("::").filter(Boolean);
      for (const name of broughtByIncludesOfHeader.has(names[0]) ? names.slice(0, 1) : names) uses.push({ name, at });
    }
  }
  return uses;
}

test("the reading follows guards, their #else, the macros that only they define, aliases and nested names", () => {
  const text = [
    "AOT::first();",
    "#if ENABLE(AOT)",
    "AOT::guarded();",
    "#define HAS_IT 1",
    "#else",
    "AOT::second();",
    "#define HAS_IT 0",
    "#endif",
    "#if HAS_IT && OS(LINUX)",
    "AOT::behindMacro();",
    "#endif",
    "#if !ENABLE(AOT)",
    "AOT::third();",
    "#endif",
    "// AOT::inComment();",
    "namespace Walk = JSC::AOT::PropertyWalk;",
    "Walk::visit(Walk::Result::Done);",
    "using namespace JSC::AOT;",
    "JSC::AOT::Image::isRegistered();",
  ].join("\n");
  expect(usesOutsideGuard("file.cpp", text)).toEqual([
    { name: "first", at: "file.cpp:1" },
    { name: "second", at: "file.cpp:6" },
    { name: "third", at: "file.cpp:13" },
    { name: "PropertyWalk", at: "file.cpp:16" },
    { name: "visit", at: "file.cpp:17" },
    { name: "Result", at: "file.cpp:17" },
    { name: "Done", at: "file.cpp:17" },
    { name: "(every name: using namespace)", at: "file.cpp:18" },
    { name: "Image", at: "file.cpp:19" },
  ]);
});

test("every name of JSC::AOT that is used outside #if ENABLE(AOT) has a stand-in in BunWithoutAOT.h", async () => {
  const standIns = new Set(readFileSync(path.join(repoRoot, header), "utf8").match(/\b[A-Za-z_]\w*\b/g));
  const lacking: string[] = [];
  let scanned = 0;
  let found = 0;
  for await (const rel of new Glob("**/*.{h,cpp,mm}").scan({ cwd: path.join(repoRoot, "src") })) {
    const file = path.join("src", rel).replaceAll("\\", "/");
    if (file === header || file.startsWith("src/aot/")) continue;
    scanned++;
    for (const { name, at } of usesOutsideGuard(file, readFileSync(path.join(repoRoot, file), "utf8"))) {
      found++;
      if (!standIns.has(name) && !broughtByIncludesOfHeader.has(name)) lacking.push(`${at}: AOT::${name}`);
    }
  }
  expect(scanned).toBeGreaterThan(500);
  expect(found).toBeGreaterThan(50);
  expect(lacking.sort()).toEqual([]);
});

// The linker's half: a function that Rust imports in every build needs a definition in every build. Some linkers drop the
// callers first and never ask; others stop.
test("every function that Rust imports in every build is defined outside #if ENABLE(AOT) too", async () => {
  const definedIn = new Map<string, Set<Region>>();
  for await (const rel of new Glob("**/*.{h,cpp,mm}").scan({ cwd: path.join(repoRoot, "src") })) {
    const file = path.join("src", rel).replaceAll("\\", "/");
    if (file.startsWith("src/aot/")) continue;
    const text = readFileSync(path.join(repoRoot, file), "utf8");
    if (!text.includes('extern "C"')) continue;
    for (const { line, region } of readRegions(text)) {
      const name = /^\s*extern "C"\s+(?!\{)[^;(]*?\b(\w+)\s*\(/.exec(line)?.[1];
      if (!name || line.trimEnd().endsWith(";")) continue;
      if (!definedIn.has(name)) definedIn.set(name, new Set());
      definedIn.get(name)!.add(region);
    }
  }
  const isInEveryBuild = (file: string) => !file.startsWith("src/aot/") || /^src\/aot\/(interface|absent)\//.test(file);
  const lacking: string[] = [];
  for await (const rel of new Glob("**/*.rs").scan({ cwd: path.join(repoRoot, "src") })) {
    const file = path.join("src", rel).replaceAll("\\", "/");
    if (!isInEveryBuild(file)) continue;
    const text = readFileSync(path.join(repoRoot, file), "utf8");
    if (!text.includes('extern "C" {')) continue;
    for (const [, block] of text.matchAll(/extern "C" \{([\s\S]*?)\n\s*\}/g)) {
      for (const [, name] of block.matchAll(/\bfn\s+(\w+)/g)) {
        const regions = definedIn.get(name);
        if (regions?.size === 1 && regions.has("with")) lacking.push(`${file}: ${name}`);
      }
    }
  }
  const onBothSides = [...definedIn.values()].filter(regions => regions.has("with") && regions.has("without")).length;
  expect(onBothSides).toBeGreaterThan(30);
  expect(lacking.sort()).toEqual([]);
}, 60_000);
