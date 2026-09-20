/**
 * The build directory's toolchain identity file (scripts/build/toolchain-identity.ts).
 *
 * ninja names a tool by path, so a compiler replaced behind a stable path (a package manager's `current` link)
 * leaves every command line unchanged and the old compiler's objects in place. The file records what each tool
 * path resolves to; the edges that run a tool take it as an input.
 */
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { ar, cc } from "../../scripts/build/compile.ts";
import type { Config } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { toolchainIdentityPath, writeToolchainIdentity } from "../../scripts/build/toolchain-identity.ts";

/** The fields the identity file and the two edge helpers below read. */
function configWith(buildDir: string, tools: Partial<Config>): Config {
  return {
    buildDir,
    cwd: buildDir,
    windows: false,
    objSuffix: ".o",
    nasm: undefined,
    rc: undefined,
    ...tools,
  } as Config;
}

test("the identity changes when a tool's path resolves to another file, and only then", () => {
  using dir = tempDir("toolchain-identity", {
    "v1/clang": "compiler, version one",
    "v2/clang": "compiler, version two, a different size",
    "ar": "archiver",
  });
  const root = String(dir);
  // What an in-place upgrade looks like: the path the build knows stays, what it points at changes.
  const current = join(root, "current");
  symlinkSync(join(root, "v1"), current, isWindows ? "junction" : "dir");
  const cfg = configWith(join(root, "build"), {
    cc: join(current, "clang"),
    cxx: join(current, "clang"),
    ar: join(root, "ar"),
    ld: "", // macOS: clang finds the linker itself
  });
  mkdirSync(cfg.buildDir);

  const identity = writeToolchainIdentity(cfg);
  expect(identity).toBe(toolchainIdentityPath(cfg));
  const before = readFileSync(identity, "utf8");
  expect(before.split("\n").map(line => line.split(" ")[0])).toEqual(["cc", "cxx", "ar", ""]);
  expect(before).toContain(join("v1", "clang"));

  // Same toolchain: the file is left alone, so nothing that depends on it rebuilds.
  const written = statSync(identity).mtimeMs;
  writeToolchainIdentity(cfg);
  expect(statSync(identity).mtimeMs).toBe(written);
  expect(readFileSync(identity, "utf8")).toBe(before);

  rmSync(current, { recursive: false, force: true });
  symlinkSync(join(root, "v2"), current, isWindows ? "junction" : "dir");
  writeToolchainIdentity(cfg);
  const after = readFileSync(identity, "utf8");
  expect(after).not.toBe(before);
  expect(after).toContain(join("v2", "clang"));
  // The archiver did not change, and its line says so.
  expect(after.split("\n")[2]).toBe(before.split("\n")[2]);
});

test("edges that run a tool take the identity file as an input", () => {
  using dir = tempDir("toolchain-identity-edges", {});
  const cfg = configWith(String(dir), {});
  const n = new Ninja({ buildDir: cfg.buildDir });
  n.rule("cc", { command: "clang $cflags -c $in -o $out" });
  n.rule("ar", { command: "llvm-ar rcs $out $in" });
  n.rule("mkdir_stamp", { command: "mkdir -p $dir && touch $out" });

  const object = cc(n, cfg, "a.c", { flags: ["-O2"] });
  ar(n, cfg, "liba.a", [object]);

  const edges = n
    .toString()
    .replace(/\$\n\s*/g, "")
    .split("\n")
    .filter(line => line.startsWith("build ") && / (cc|ar) /.test(line));
  expect(edges.length).toBe(2);
  for (const edge of edges) {
    // build <outputs>: <rule> <inputs> | <implicit inputs> || <order-only inputs>
    const implicitInputs = edge.slice(edge.indexOf(": ")).split(" || ")[0]!.split(" | ")[1];
    expect(implicitInputs?.split(" ")).toContain("toolchain-identity.txt");
  }
});
