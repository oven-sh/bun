/**
 * The build directory's toolchain identity file (scripts/build/toolchain-identity.ts).
 *
 * ninja names a tool by path, so a compiler replaced behind a stable path (a package manager's `current` link)
 * leaves every command line unchanged and the old compiler's objects in place. The file records what each tool
 * says it is; the edges that run a tool take it as an input.
 */
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { cc } from "../../scripts/build/compile.ts";
import type { Config } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { toolchainIdentityPath, writeToolchainIdentity } from "../../scripts/build/toolchain-identity.ts";
import { toolIdentity } from "../../scripts/build/tools.ts";

/** The fields the identity file and the edge helper below read. */
function configWith(buildDir: string, tools: Partial<Config>): Config {
  return { buildDir, cwd: buildDir, windows: false, objSuffix: ".o", nasm: undefined, ...tools } as Config;
}

/** A stand-in tool: answers `--version` the way the real one does. */
const tool = (...lines: string[]) => `#!/bin/sh\n${lines.map(l => `echo '${l}'`).join("\n")}\n`;

// The stand-ins are shell scripts; on Windows a tool has to be an .exe.
test.skipIf(isWindows)("a tool's identity is the line of its --version output that carries the version", () => {
  using dir = tempDir("toolchain-identity-line", {
    "clang": tool(
      "clang version 23.1.1 (https://github.com/llvm/llvm-project 6dfe1677ab8d)",
      "Target: x86_64-unknown-linux-gnu",
      "InstalledDir: /somewhere/on/this/machine/bin",
    ),
    "llvm-ar": tool("LLVM (http://llvm.org/):", "  LLVM version 23.1.1", "  Optimized build."),
    "silent": tool("usage: silent <file>"),
  });
  for (const name of ["clang", "llvm-ar", "silent"]) chmodSync(join(String(dir), name), 0o755);

  expect(toolIdentity(join(String(dir), "clang"))).toBe(
    "clang version 23.1.1 (https://github.com/llvm/llvm-project 6dfe1677ab8d)",
  );
  expect(toolIdentity(join(String(dir), "llvm-ar"))).toBe("LLVM version 23.1.1");
  expect(() => toolIdentity(join(String(dir), "silent"))).toThrow("Cannot tell which");
  expect(() => toolIdentity(join(String(dir), "missing"))).toThrow("Cannot tell which");
});

test.skipIf(isWindows)("the file changes when the path resolves to another compiler, and only then", () => {
  using dir = tempDir("toolchain-identity", {
    "v21/clang": tool("clang version 21.1.8 (https://github.com/llvm/llvm-project 2078da43e25a)"),
    "v23/clang": tool("clang version 23.1.1 (https://github.com/llvm/llvm-project 6dfe1677ab8d)"),
    "ld.lld": tool("LLD 23.1.1 (compatible with GNU linkers)"),
  });
  const root = String(dir);
  for (const name of ["v21/clang", "v23/clang", "ld.lld"]) chmodSync(join(root, name), 0o755);
  // What an in-place upgrade looks like: the path the build knows stays, what it points at changes.
  const current = join(root, "current");
  symlinkSync(join(root, "v21"), current, "dir");
  const cfg = configWith(join(root, "build"), {
    cc: join(current, "clang"),
    cxx: join(current, "clang"),
    ld: join(root, "ld.lld"),
  });
  mkdirSync(cfg.buildDir);

  const identity = writeToolchainIdentity(cfg);
  expect(identity).toBe(toolchainIdentityPath(cfg));
  // Nothing of this machine in it: the same toolchain gives the same file anywhere.
  expect(readFileSync(identity, "utf8")).toBe(
    [
      "cc: clang version 21.1.8 (https://github.com/llvm/llvm-project 2078da43e25a)",
      "cxx: clang version 21.1.8 (https://github.com/llvm/llvm-project 2078da43e25a)",
      "ld: LLD 23.1.1 (compatible with GNU linkers)",
      "",
    ].join("\n"),
  );

  // Same toolchain: the file is left alone, so nothing that depends on it rebuilds.
  const written = statSync(identity).mtimeMs;
  writeToolchainIdentity(cfg);
  expect(statSync(identity).mtimeMs).toBe(written);

  rmSync(current);
  symlinkSync(join(root, "v23"), current, "dir");
  writeToolchainIdentity(cfg);
  expect(readFileSync(identity, "utf8")).toBe(
    [
      "cc: clang version 23.1.1 (https://github.com/llvm/llvm-project 6dfe1677ab8d)",
      "cxx: clang version 23.1.1 (https://github.com/llvm/llvm-project 6dfe1677ab8d)",
      "ld: LLD 23.1.1 (compatible with GNU linkers)",
      "",
    ].join("\n"),
  );
});

test("a compile edge takes the identity file as an input", () => {
  using dir = tempDir("toolchain-identity-edges", {});
  const cfg = configWith(String(dir), {});
  const n = new Ninja({ buildDir: cfg.buildDir });
  n.rule("cc", { command: "clang $cflags -c $in -o $out" });
  n.rule("mkdir_stamp", { command: "mkdir -p $dir && touch $out" });
  cc(n, cfg, "a.c", { flags: ["-O2"] });

  const edge = n
    .toString()
    .replace(/\$\n\s*/g, "")
    .split("\n")
    .find(line => line.startsWith("build ") && line.includes(": cc "));
  // build <outputs>: <rule> <inputs> | <implicit inputs> || <order-only inputs>
  const implicitInputs = edge?.slice(edge.indexOf(": ")).split(" || ")[0]!.split(" | ")[1];
  expect(implicitInputs?.split(" ")).toContain("toolchain-identity.txt");
});
