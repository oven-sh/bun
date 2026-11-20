/**
 * scripts/bench-json-rust.sh builds the `bun_parsers` unit tests and benches outside the build, and compiles
 * bun's Highway kernel files for them itself. What it repeats from the build is checked against the build here,
 * so a change that makes the two disagree fails on its own pull request and not at the next run of the script.
 * Source text only: no compiler or cargo runs.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Config } from "../../../scripts/build/config.ts";
import { highway } from "../../../scripts/build/deps/highway.ts";
import { bunOnlyFlags } from "../../../scripts/build/flags.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const script = read("scripts/bench-json-rust.sh");
/** The words of a `NAME=(...)` line of the script. */
const words = (name: string) => new RegExp(`^${name}=\\((.+)\\)$`, "m").exec(script)?.[1]!.split(" ") ?? [];

test("the kernels get the C++ dialect and the Highway targets the build gives them", () => {
  // gnu++23 on Linux and c++23 on macOS are one dialect for these files: they are compiled as both.
  const dialects = bunOnlyFlags
    .filter(f => f.lang === "cxx" && typeof f.flag === "string" && f.flag.startsWith("-std="))
    .map(f => (f.flag as string).replace("gnu++", "c++"));
  // highway's provides() reads nothing from the config.
  const targets = highway.provides({} as Config).defines!.map(define => `-D${define}`);
  expect(words("KERNEL_FLAGS")).toEqual([...new Set(dialects), ...targets]);
});

test("each highway kernel the Rust side imports has one definition in what the binaries link", () => {
  const imports = [...read("src/highway/lib.rs").matchAll(/^\s*fn (highway_\w+)\(/gm)].map(m => m[1]!);
  // The import list is one `extern "C"` block. Fewer names than it has today means the pattern stopped matching.
  expect(imports.length).toBeGreaterThanOrEqual(37);

  const definedIn = new Map<string, string[]>();
  const define = (name: string, file: string) => definedIn.set(name, [...(definedIn.get(name) ?? []), file]);
  // A kernel's definition starts a line with its return type. Calls are indented and helpers are `static`.
  for (const kernel of words("KERNELS")) {
    const file = `src/jsc/bindings/${kernel}.cpp`;
    for (const m of read(file).matchAll(/^(?!static\b)(?:extern "C" )?[\w*]+ \*?(highway_\w+)\(/gm))
      define(m[1]!, file);
  }
  // The shim file is compiled into the same binaries, so a stand-in there is a second definition of a kernel.
  const shims = "src/parsers/native_test_shims.rs";
  for (const m of read(shims).matchAll(/\bfn (highway_\w+)\(/g)) define(m[1]!, shims);

  const notOnce = imports.filter(name => definedIn.get(name)?.length !== 1);
  expect(Object.fromEntries(notOnce.map(name => [name, definedIn.get(name) ?? []]))).toEqual({});
});

test("the header that stands in for root.h defines root.h's include guard", () => {
  const guard = /^#ifndef (\w+)\n#define \1$/m.exec(read("src/jsc/bindings/root.h"))?.[1];
  const stub = /^ROOT_STUB=(\S+)$/m.exec(script)?.[1];
  expect({ guard, stub }).toEqual({ guard: expect.any(String), stub: expect.any(String) });
  expect(read(stub!)).toContain(`\n#define ${guard}\n`);
});
