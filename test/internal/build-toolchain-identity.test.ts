/**
 * The build directory's tool identity files (scripts/build/tools.ts).
 *
 * ninja names a tool by path, so a compiler replaced behind a stable path (a package manager's `current` link)
 * leaves every command line unchanged and the old compiler's objects in place. Each file records what one tool
 * says it is; an edge takes the files of the tools it runs as inputs.
 */
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { cc, cxx, link, nasm } from "../../scripts/build/compile.ts";
import type { Config } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { type IdentifiedTool, toolIdentity, toolIdentityFile, writeToolIdentities } from "../../scripts/build/tools.ts";

/** A stand-in tool: answers `--version` the way the real one does. */
const tool = (...lines: string[]) => `#!/bin/sh\n${lines.map(l => `echo '${l}'`).join("\n")}\n`;

// The stand-ins are shell scripts; on Windows a tool has to be an .exe.
test.skipIf(isWindows)("a tool's identity is the line of its --version output that carries the version", () => {
  using dir = tempDir("tool-identity-line", {
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

test.skipIf(isWindows)("a file changes when its tool's path resolves to another tool, and only then", () => {
  using dir = tempDir("tool-identity", {
    "v21/clang": tool("clang version 21.1.8 (https://github.com/llvm/llvm-project 2078da43e25a)"),
    "v23/clang": tool("clang version 23.1.1 (https://github.com/llvm/llvm-project 6dfe1677ab8d)"),
    "ld.lld": tool("LLD 23.1.1 (compatible with GNU linkers)"),
  });
  const root = String(dir);
  for (const name of ["v21/clang", "v23/clang", "ld.lld"]) chmodSync(join(root, name), 0o755);
  // What an in-place upgrade looks like: the path the build knows stays, what it points at changes.
  const current = join(root, "current");
  symlinkSync(join(root, "v21"), current, "dir");
  const clang = join(current, "clang");
  const cfg = {
    buildDir: join(root, "build"),
    cc: clang,
    cxx: clang,
    hostCc: clang,
    ld: join(root, "ld.lld"),
  } as Config;
  const read = (name: "cc" | "cxx" | "hostCc" | "ld") => readFileSync(toolIdentityFile(cfg, name), "utf8");

  writeToolIdentities(cfg);
  // Nothing of this machine in it: the same tool gives the same file anywhere.
  expect(read("cc")).toBe("clang version 21.1.8 (https://github.com/llvm/llvm-project 2078da43e25a)\n");
  expect(read("cxx")).toBe(read("cc"));
  expect(read("hostCc")).toBe(read("cc"));
  expect(read("ld")).toBe("LLD 23.1.1 (compatible with GNU linkers)\n");
  // No nasm on this platform: no file, and no edge that would name one.
  expect(existsSync(toolIdentityFile(cfg, "nasm"))).toBe(false);

  // Same tools: every file is left alone, so nothing that depends on one rebuilds.
  const written = (["cc", "cxx", "hostCc", "ld"] as const).map(name => statSync(toolIdentityFile(cfg, name)).mtimeMs);
  writeToolIdentities(cfg);
  expect((["cc", "cxx", "hostCc", "ld"] as const).map(name => statSync(toolIdentityFile(cfg, name)).mtimeMs)).toEqual(
    written,
  );

  rmSync(current);
  symlinkSync(join(root, "v23"), current, "dir");
  writeToolIdentities(cfg);
  expect(read("cc")).toBe("clang version 23.1.1 (https://github.com/llvm/llvm-project 6dfe1677ab8d)\n");
  // The linker was not replaced: its file is untouched, and what only it produced stays.
  expect(statSync(toolIdentityFile(cfg, "ld")).mtimeMs).toBe(written[3]);
});

test("an edge takes the identity of the tools it runs, and of no other", () => {
  using dir = tempDir("tool-identity-edges", {});
  const buildDir = String(dir);
  const cfg = {
    buildDir,
    cwd: buildDir,
    windows: false,
    objSuffix: ".o",
    exeSuffix: "",
    host: { os: "linux" },
    nasm: "/fake/nasm",
    ld: "/fake/ld.lld",
  } as Config;
  const n = new Ninja({ buildDir });
  // Each rule's text names the variables its edges bind, which `n.rule()` checks.
  n.rule("cc", { command: "clang $cflags -c $in -o $out" });
  n.rule("cxx", { command: "clang++ $cxxflags -c $in -o $out" });
  n.rule("nasm", { command: "nasm $nasmflags -o $out $in" });
  n.rule("link", { command: "clang++ $in $ldflags -o $out" });
  n.rule("mkdir_stamp", { command: "mkdir -p $dir && touch $out" });
  cc(n, cfg, "a.c", { flags: [] });
  cxx(n, cfg, "b.cpp", { flags: [] });
  nasm(n, cfg, "c.asm", { flags: [] });
  link(n, cfg, "exe", ["obj/a.c.o"], { flags: [], libs: [] });

  const statements = n
    .toString()
    .replace(/\$\n\s*/g, "")
    .split("\n");
  // As build.ninja spells them: relative to the build directory, with the host's separator.
  const identity = (tool: IdentifiedTool) => n.rel(toolIdentityFile(cfg, tool));
  const identityFiles = (["cc", "cxx", "hostCc", "nasm", "ld"] as const).map(identity);
  const identitiesOf = (rule: string): string[] => {
    const edge = statements.find(line => line.startsWith("build ") && line.includes(`: ${rule} `));
    // build <outputs>: <rule> <inputs> | <implicit inputs> || <order-only inputs>
    const implicitInputs = edge?.slice(edge.indexOf(": ")).split(" || ")[0]!.split(" | ")[1] ?? "";
    return implicitInputs.split(" ").filter(path => identityFiles.includes(path));
  };
  expect(identitiesOf("cc")).toEqual([identity("cc")]);
  expect(identitiesOf("cxx")).toEqual([identity("cxx")]);
  expect(identitiesOf("nasm")).toEqual([identity("nasm")]);
  expect(identitiesOf("link")).toEqual([identity("cxx"), identity("ld")]);
});
