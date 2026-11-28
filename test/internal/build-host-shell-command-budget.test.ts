/**
 * A codegen command on a Windows host runs through `cmd /c`, and cmd.exe refuses a command line over 8191 characters.
 * The list of every `.bind.ts` file did not fit (#48301). So configure writes that list to a file (writeBindgenSources
 * in scripts/build/codegen.ts), the two steps that read it take `--sources=@<file>` (listOption in
 * src/codegen/helpers.ts), and Ninja.build() holds every `hostShell` rule's edges to HOST_SHELL_COMMAND_BUDGET on
 * every host: CI builds the Windows binaries on Linux, so no build of CI runs the `cmd /c` text. The real rules are
 * registered here (`configure`), so on a Windows test machine the text the guard measures is cmd.exe's.
 */
import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readFileSync, statSync, utimesSync } from "node:fs";
import { resolve } from "node:path";

import {
  crateOf,
  emitBindgen,
  registerCodegenRules,
  writeBindgenSources,
  type CodegenOutputs,
} from "../../scripts/build/codegen.ts";
import { registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { HOST_SHELL_COMMAND_BUDGET, Ninja, expand, readManifest } from "../../scripts/build/ninja.ts";
import { quote } from "../../scripts/build/shell.ts";
import type { Sources } from "../../scripts/glob-sources.ts";
import { listOption } from "../../src/codegen/helpers.ts";

describe("listOption", () => {
  test("splits an inline list at commas and drops empty entries", () => {
    expect(listOption("a=1,b=2,,")).toEqual(["a=1", "b=2"]);
    expect(listOption("")).toEqual([]);
  });

  test("reads @<file> as one entry per line, with or without a carriage return", () => {
    using dir = tempDir("list-option", {
      "sources.txt": "bun_jsc=/a/fmt_jsc.bind.ts\nbun_runtime=/b/node_os.bind.ts\n",
      "crlf.txt": "bun_jsc=C:\\a\\fmt_jsc.bind.ts\r\nbun_runtime=C:\\b\\node_os.bind.ts\r\n\r\n",
    });
    expect(listOption(`@${resolve(String(dir), "sources.txt")}`)).toEqual([
      "bun_jsc=/a/fmt_jsc.bind.ts",
      "bun_runtime=/b/node_os.bind.ts",
    ]);
    expect(listOption(`@${resolve(String(dir), "crlf.txt")}`)).toEqual([
      "bun_jsc=C:\\a\\fmt_jsc.bind.ts",
      "bun_runtime=C:\\b\\node_os.bind.ts",
    ]);
  });
});

describe("Ninja.build with a hostShell rule", () => {
  /** A graph with two rules of the same text, one marked as needing a shell. */
  function graph(buildDir: string): Ninja {
    const n = new Ninja({ buildDir });
    n.rule("codegen", { command: "cd $cwd && node $args", description: "gen $desc", hostShell: true });
    n.rule("codegen_bun", { command: "cd $cwd && bun $args", description: "gen $desc" });
    return n;
  }
  const edge = (rule: "codegen" | "codegen_bun", buildDir: string, args: string) => ({
    outputs: [resolve(buildDir, "codegen", "out.h")],
    rule,
    inputs: [],
    vars: { cwd: buildDir, desc: "out.h", args },
  });

  test("refuses an edge whose command is over the budget, and says which variable is long", () => {
    using dir = tempDir("host-shell-budget", {});
    const args = "--sources=" + Buffer.alloc(HOST_SHELL_COMMAND_BUDGET, "x").toString();
    expect(() => graph(String(dir)).build(edge("codegen", String(dir), args))).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(resolve(String(dir), "codegen", "out.h")),
        hint: expect.stringContaining(`$args is ${args.length} characters`),
      }),
    );
  });

  test("accepts the same edge within the budget, and on a rule without the flag at any length", () => {
    using dir = tempDir("host-shell-budget-ok", {});
    const long = "--sources=" + Buffer.alloc(HOST_SHELL_COMMAND_BUDGET, "x").toString();
    expect(() => graph(String(dir)).build(edge("codegen", String(dir), "--sources=@list.txt"))).not.toThrow();
    expect(() => graph(String(dir)).build(edge("codegen_bun", String(dir), long))).not.toThrow();
  });

  test("a rule whose text is cmd /c has to carry the flag", () => {
    using dir = tempDir("host-shell-budget-flag", {});
    const graph = () => new Ninja({ buildDir: String(dir) });
    expect(() => graph().rule("copy_exe", { command: 'cmd /c "copy /Y $in $out"' })).toThrow("without hostShell");
    expect(() => graph().rule("copy_exe", { command: 'cmd /c "copy /Y $in $out"', hostShell: true })).not.toThrow();
  });

  test("counts $in and $out", () => {
    using dir = tempDir("host-shell-budget-in-out", {});
    const n = new Ninja({ buildDir: String(dir) });
    n.rule("copy_exe", { command: "cp $in $out", hostShell: true });
    const name = Buffer.alloc(100, "f").toString();
    const inputs = Array.from({ length: 64 }, (_, i) => resolve(String(dir), `${name}${i}`));
    expect(() => n.build({ outputs: [resolve(String(dir), "out")], rule: "copy_exe", inputs })).toThrow(
      "over the budget",
    );
  });
});

/** A fully-populated fake toolchain. */
function mockToolchain(): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    hostCc: undefined,
    hostCxx: undefined,
    clangVersion: "23.1.1",
    clangResourceDir: "/fake/llvm/lib/clang/23",
    ar: "/fake/llvm/bin/llvm-ar",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLlvmVersion: "23.1.1",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    nm: "/fake/llvm/bin/llvm-nm",
    readobj: "/fake/llvm/bin/llvm-readobj",
    objdump: "/fake/llvm/bin/llvm-objdump",
    cxxfilt: "/fake/llvm/bin/llvm-cxxfilt",
    dsymutil: "/fake/llvm/bin/dsymutil",
    bun: bunExe(),
    jsRuntime: quote(bunExe(), process.platform === "win32"),
    esbuild: "/fake/bin/esbuild",
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: undefined,
    cargoHome: undefined,
    rustupHome: undefined,
    msvcLinker: undefined,
    rc: undefined,
    nasm: undefined,
  };
}

/** A linux-x64 debug target in `buildDir`, with the codegen rules registered, as in build-codegen-declared-outputs.test.ts. */
function configure(buildDir: string): { cfg: Config; n: Ninja; o: CodegenOutputs; dirStamp: string } {
  const cfg = resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir },
    mockToolchain(),
  );
  const n = new Ninja({ buildDir });
  registerDirStamps(n, cfg);
  registerCodegenRules(n, cfg);
  const o: CodegenOutputs = {
    all: [],
    generatedTypes: [],
    rustInputs: [],
    cppSources: [],
    cppHeaders: [],
    cppAll: [],
    builtinTableSources: [],
    internalModulesAsm: resolve(cfg.codegenDir, "InternalModuleRegistryConstants.S"),
    internalModulesBin: resolve(cfg.codegenDir, "InternalModuleRegistryConstants.bin"),
    bundledHelpers: resolve(cfg.codegenDir, "runtime.out.js"),
    rootInstall: resolve(buildDir, "stamps", "install.stamp"),
  };
  return { cfg, n, o, dirStamp: resolve(cfg.codegenDir, ".dir") };
}

describe("the list of .bind.ts files", () => {
  test("is one <crate>=<path> line per file, kept as it is when nothing changed", () => {
    using dir = tempDir("bindgen-sources", {});
    const path = resolve(String(dir), "bindgen-sources.txt");
    const root = resolve(import.meta.dir, "..", "..");
    const bindgen = [resolve(root, "src/jsc/fmt_jsc.bind.ts"), resolve(root, "src/runtime/node/node_os.bind.ts")];

    const list = writeBindgenSources(path, bindgen);

    expect(list).toEqual({
      path,
      crates: new Map([
        [bindgen[0]!, "bun_jsc"],
        [bindgen[1]!, "bun_runtime"],
      ]),
    });
    expect(readFileSync(path, "utf8")).toBe(`bun_jsc=${bindgen[0]}\nbun_runtime=${bindgen[1]}\n`);
    // Unchanged content keeps its mtime, so the edges that read the list stay clean.
    const earlier = new Date("2020-01-01T00:00:00Z");
    utimesSync(path, earlier, earlier);
    writeBindgenSources(path, bindgen);
    expect(statSync(path).mtime).toEqual(earlier);
  });

  /** Every `.bind.ts` under src/, as glob-sources.ts finds them for emitBindgen. */
  function repoBindFiles(cfg: Config): string[] {
    return Array.from(new Bun.Glob("src/**/*.bind.ts").scanSync({ cwd: cfg.cwd }), p => resolve(cfg.cwd, p)).sort();
  }

  test("on the command line, as it was, it fails configure on the real codegen rules", () => {
    using dir = tempDir("bindgen-sources-inline", {});
    const { cfg, n } = configure(String(dir));
    const bindgen = repoBindFiles(cfg);
    const inline = `--sources=${bindgen.map(src => `${crateOf(src)}=${src}`).join(",")}`;
    expect(inline.length).toBeGreaterThan(HOST_SHELL_COMMAND_BUDGET);
    for (const rule of ["codegen", "codegen_bun"] as const) {
      expect(() =>
        n.build({
          outputs: [resolve(cfg.codegenDir, `${rule}.h`)],
          rule,
          inputs: bindgen,
          vars: { cwd: cfg.cwd, desc: rule, args: inline },
        }),
      ).toThrow("over the budget");
    }
  });

  test("leaves the bindgen command within the budget for every .bind.ts of the repository", () => {
    using dir = tempDir("bindgen-sources-repo", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));
    const bindgen = repoBindFiles(cfg);
    expect(bindgen.length).toBeGreaterThan(100);
    const bindgenSources = writeBindgenSources(resolve(String(dir), "bindgen-sources.txt"), bindgen);

    emitBindgen({
      n,
      cfg,
      sources: { bindgen, bindgenCodegen: [] } as Partial<Sources> as Sources,
      o,
      dirStamp,
      bindgenSources,
    });

    const manifest = readManifest(n.toString());
    const edge = manifest.edges.find(edge =>
      edge.outputs.includes(n.rel(resolve(cfg.codegenDir, "GeneratedBindings+Tables.h"))),
    )!;
    expect(edge.bindings.args).toContain(`--sources=@${bindgenSources.path}`);
    expect(edge.bindings.args).not.toContain(".bind.ts");
    expect(edge.implicitInputs).toContain(n.rel(bindgenSources.path));
    // The command as this host's rule text expands it: cmd.exe's own on a Windows machine.
    const command = expand(manifest.rules.get("codegen")!.command, name =>
      name === "in" ? edge.inputs.join(" ") : name === "out" ? edge.outputs.join(" ") : (edge.bindings[name] ?? ""),
    );
    expect(command.length).toBeLessThanOrEqual(HOST_SHELL_COMMAND_BUDGET);
    expect(
      readFileSync(bindgenSources.path, "utf8")
        .split("\n")
        .filter(line => line !== ""),
    ).toHaveLength(bindgen.length);
  });
});
