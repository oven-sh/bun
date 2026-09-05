import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The bun executable exports a small set of symbols: the N-API and libuv
// surface that native addons link against, the v8 and node C++ shims, and the
// helpers that the lldb scripts in misctools/lldb call by name. Each POSIX
// linker reads that set from its own file:
//
//   src/symbols.txt          macOS, `-exported_symbols_list`. One Mach-O name
//                            per line. A Mach-O name is the C or Itanium
//                            mangled name with one more leading underscore:
//                            `_uv_close`, `__ZN2v87Isolate10GetCurrentEv`.
//   src/linker.lds           Linux and FreeBSD, `--version-script`. ELF names,
//                            globs such as `napi*`, and demangled globs such as
//                            `v8::*` inside the `extern "C++"` block.
//                            `local: *` hides everything else. (FreeBSD also
//                            passes src/linker-freebsd.lds, which adds two libc
//                            symbols that are not part of bun's surface.)
//
// The linker does not report a name that one list has and the other lacks: the
// symbol is simply not exported on that platform. This lint keeps the two lists
// in step. (src/symbols.def, the Windows list, differs on purpose: it exports
// the real libuv, and the C++ shims are exported with dllexport.)

const srcDir = path.resolve(import.meta.dir, "..", "..", "..", "src");
const read = (name: string) => readFileSync(path.join(srcDir, name), "utf8");

/** Exported on macOS only. The Mach-O header symbol has no ELF counterpart. */
const machoOnly = new Set(["__mh_execute_header"]);

function parseExportedSymbolsList(text: string): string[] {
  return text
    .split("\n")
    .map(line => line.replace(/#.*/, "").trim())
    .filter(Boolean);
}

interface VersionScript {
  /** Entries of the `global:` section that name one ELF symbol. */
  names: Set<string>;
  /** Entries with a wildcard, matched against ELF symbol names. */
  globs: string[];
  /** Entries of the `extern "C++"` block, matched against demangled names. */
  cxxGlobs: string[];
}

function splitEntries(section: string): string[] {
  return section
    .split(";")
    .map(entry => entry.trim())
    .filter(Boolean);
}

function parseVersionScript(file: string): VersionScript {
  const text = read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/#.*/g, "");
  const globalStart = text.indexOf("global:");
  const localStart = text.indexOf("local:");
  if (globalStart === -1 || localStart < globalStart) {
    throw new Error(`${file}: expected a 'global:' section followed by a 'local:' section`);
  }

  const cxxGlobs: string[] = [];
  const globalSection = text
    .slice(globalStart + "global:".length, localStart)
    .replace(/extern\s+"C\+\+"\s*\{([^}]*)\}\s*;?/g, (_, block: string) => {
      for (const entry of splitEntries(block)) {
        if (!entry.includes("*")) {
          throw new Error(`${file}: this lint only understands globs in the extern "C++" block, got '${entry}'`);
        }
        cxxGlobs.push(entry);
      }
      return "";
    });

  const names = new Set<string>();
  const globs: string[] = [];
  for (const entry of splitEntries(globalSection)) {
    if (!/^[\w.$*?]+$/.test(entry)) throw new Error(`${file}: cannot parse the entry '${entry}'`);
    if (entry.includes("*") || entry.includes("?")) globs.push(entry);
    else names.add(entry);
  }
  return { names, globs, cxxGlobs };
}

function globToRegExp(glob: string): RegExp {
  const source = Array.from(glob, ch =>
    ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.$+^(){}|[\]\\]/, "\\$&"),
  );
  return new RegExp(`^${source.join("")}$`);
}

/**
 * The scope and name of an Itanium mangled nested name, without parameters:
 * `_ZNK2v85Value6IsTrueEv` becomes `v8::Value::IsTrue`. That is what the
 * namespace globs of the `extern "C++"` block match against. Every other shape
 * of name gives null.
 */
function qualifiedName(elfName: string): string | null {
  const prefix = /^_ZNK?(?=\d)/.exec(elfName);
  if (prefix === null) return null;
  const parts: string[] = [];
  let rest = elfName.slice(prefix[0].length);
  while (/^\d/.test(rest)) {
    const length = /^\d+/.exec(rest)![0];
    const end = length.length + Number(length);
    if (end > rest.length) return null;
    parts.push(rest.slice(length.length, end));
    rest = rest.slice(end);
  }
  return parts.join("::");
}

function exportsName(script: VersionScript, elfName: string): boolean {
  if (script.names.has(elfName)) return true;
  if (script.globs.some(glob => globToRegExp(glob).test(elfName))) return true;
  const qualified = qualifiedName(elfName);
  return qualified !== null && script.cxxGlobs.some(glob => globToRegExp(glob).test(qualified));
}

const symbolsTxt = parseExportedSymbolsList(read("symbols.txt"));
const elf = parseVersionScript("linker.lds");

test("the lists parse into something to compare", () => {
  expect(symbolsTxt.length).toBeGreaterThan(0);
  expect(symbolsTxt.filter(name => !name.startsWith("_"))).toEqual([]);
  expect(elf.names.size).toBeGreaterThan(0);
  expect(elf.globs.length).toBeGreaterThan(0);
  expect(elf.cxxGlobs.length).toBeGreaterThan(0);
  // A bare `*` in the global section would export everything, and the checks
  // below would pass for any symbols.txt.
  expect(elf.globs).not.toContain("*");
});

test("src/linker.lds exports every symbol src/symbols.txt exports", () => {
  const missing = symbolsTxt
    .filter(machoName => !machoOnly.has(machoName))
    .map(machoName => machoName.slice(1))
    .filter(elfName => !exportsName(elf, elfName))
    .map(elfName => `_${elfName} is in src/symbols.txt but nothing in src/linker.lds exports ${elfName}`);
  expect(missing).toEqual([]);
});

test("src/symbols.txt exports every symbol src/linker.lds names one by one", () => {
  const machoNames = new Set(symbolsTxt);
  const missing = Array.from(elf.names)
    .filter(elfName => !machoNames.has(`_${elfName}`))
    .map(elfName => `${elfName} is in src/linker.lds but _${elfName} is not in src/symbols.txt`);
  expect(missing).toEqual([]);
});
