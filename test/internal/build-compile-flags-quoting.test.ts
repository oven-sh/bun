/**
 * scripts/build writes every compile flag twice: shell-quoted into the
 * `$cflags`/`$cxxflags` variable of a build.ninja edge, and as one entry of
 * the `arguments` argv in compile_commands.json. The flag tables therefore
 * hold the argument exactly as clang receives it (`REPORTED_NODEJS_VERSION="1.2.3"`)
 * and compile.ts quotes it while writing build.ninja.
 *
 * The tables used to hold shell-escaped text (`REPORTED_NODEJS_VERSION=\"1.2.3\"`)
 * that compile.ts joined verbatim. ninja runs through sh, so the build was
 * fine, but the same strings landed in compile_commands.json, whose readers
 * (clangd, clang-tidy, anything replaying an entry) hand argv to clang as-is:
 *
 *   <command line>:11:34: error: missing terminating '"' character
 *     #define REPORTED_NODEJS_VERSION \"1.2.3\"
 *
 * These tests run the real flag tables, compile.ts, a direct dep and a
 * nested-cmake dep through a Ninja instance and read back both files, then
 * split the emitted variables with the host's real splitter (sh, or a Win32
 * argv parser on Windows) and compare against the compile_commands.json
 * argv. Nothing is compiled, so they run on every host; CI builds Windows
 * by cross-compiling on Linux, so the Windows test shards are the only place
 * the Windows-host quoting meets a Windows parser automatically.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cc, cxx, pch, registerCompileRules, registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { computeDepFlags, computeFlags } from "../../scripts/build/flags.ts";
import { Ninja, type CompileCommand } from "../../scripts/build/ninja.ts";
import { quote, quoteArgs } from "../../scripts/build/shell.ts";
import { registerDepRules, resolveDep, type Dependency } from "../../scripts/build/source.ts";

/** A fully-populated fake toolchain; nothing in these tests spawns any of it. */
const toolchain: Toolchain = {
  cc: "/fake/llvm/bin/clang",
  cxx: "/fake/llvm/bin/clang++",
  hostCc: undefined,
  hostCxx: undefined,
  clangVersion: "21.1.8",
  clangResourceDir: "/fake/llvm/lib/clang/21",
  ar: "/fake/llvm/bin/llvm-ar",
  ranlib: "/fake/llvm/bin/llvm-ranlib",
  ld: "/fake/llvm/bin/ld.lld",
  ld64Lld: undefined,
  rustLld: undefined,
  rustLlvmVersion: undefined,
  rustSysroot: undefined,
  rustHostTriple: undefined,
  strip: "/fake/bin/strip",
  llvmStrip: undefined,
  dsymutil: undefined,
  bun: "/fake/bin/bun",
  jsRuntime: "/fake/bin/bun",
  esbuild: "/fake/bin/esbuild",
  ccache: undefined,
  cmake: "/fake/bin/cmake",
  cargo: undefined,
  cargoHome: undefined,
  rustupHome: undefined,
  msvcLinker: undefined,
  rc: undefined,
  mt: undefined,
  nasm: undefined,
};

/** Debug config for the test host with the versions that end up in string defines pinned. */
function configFor(buildDir: string): Config {
  return resolveConfig(
    {
      buildDir,
      buildType: "Debug",
      assertions: true,
      ci: false,
      nodejsVersion: "1.2.3",
      nodejsV8Version: "4.5.6-node.7",
    },
    toolchain,
  );
}

/**
 * A direct (compiled in our own graph) dep using every flag shape source.ts
 * assembles itself: all three `defines` value types, `includes`, the -I for
 * its generated header, and the host codegen tool's `toolDefines`.
 */
function syntheticDep(srcDir: string): Dependency {
  return {
    name: "synth",
    source: () => ({ kind: "local", path: srcDir }),
    build: () => ({
      kind: "direct",
      sources: ["synth.c"],
      includes: ["inc"],
      defines: { SYNTH_NAME: "a b", SYNTH_LEVEL: 2, SYNTH_STATIC: true },
      headers: { "config.h": "#define SYNTH_CONFIG 1\n" },
      codegen: { tool: "synth-gen.c", toolDefines: { GEN_BANNER: "gen tool" }, args: ["$out"], output: "gen.h" },
    }),
    provides: () => ({ libs: [], includes: ["inc"] }),
  };
}

/**
 * A nested-cmake dep. Its flags reach the compiler through one more layer:
 * they are pasted into CMAKE_<LANG>_FLAGS, which cmake copies into the inner
 * build's commands, and that whole -D argument is itself one word of the
 * outer cmake command line. The C and C++ extras differ so that the two
 * languages' lines cannot be swapped without a test noticing.
 */
const SYNTHCM_EXTRA = { C: '-DSYNTHCM_C="a b"', CXX: '-DSYNTHCM_CXX="c d"' };

function syntheticCmakeDep(srcDir: string): Dependency {
  return {
    name: "synthcm",
    source: () => ({ kind: "local", path: srcDir }),
    build: () => ({
      kind: "nested-cmake",
      args: {},
      pic: true,
      extraCFlags: [SYNTHCM_EXTRA.C],
      extraCxxFlags: [SYNTHCM_EXTRA.CXX],
    }),
    provides: () => ({ libs: ["synthcm"], includes: [] }),
  };
}

/** The dep_configure edge of the nested-cmake dep, as compile_commands.json-style buildDir-relative output. */
const SYNTHCM_CONFIGURE_OUTPUT = join("deps", "synthcm", "CMakeCache.txt");

/** The quoting flavour of the machine running this test file: what a real configure here would emit. */
const hostOs = isWindows ? "windows" : "linux";

/** An argv entry that still carries shell syntax: an escaped quote or a posix quote character. */
const SHELL_SYNTAX = /\\"|'/;

interface Emitted {
  cfg: Config;
  ninja: string;
  compileCommands: CompileCommand[];
  /** The argv given to pch()/cxx()/cc() for bun's own sources, assembled the way bun.ts does. */
  bunFlags: string[];
}

/**
 * Emit the PCH, one bun C++ edge using it, one bun C edge and both synthetic
 * deps, then write build.ninja + compile_commands.json like configure does.
 * The build dir (and the dep source trees inside it) contains a space so the
 * paths need quoting too. `hostOs` selects the quoting flavour the emitters
 * apply; the target stays the test host's so the real tables are used.
 */
async function emit(hostOs: "linux" | "windows"): Promise<Emitted> {
  using dir = tempDir("build-flags", {
    "build dir/synth/synth.c": "",
    "build dir/synth/synth-gen.c": "",
    "build dir/synthcm/CMakeLists.txt": "",
  });
  const resolved = configFor(join(String(dir), "build dir"));
  const cfg: Config = {
    ...resolved,
    host: { ...resolved.host, os: hostOs, exeSuffix: hostOs === "windows" ? ".exe" : "" },
  };

  const flags = computeFlags(cfg);
  const bunFlags = [...flags.cxxflags, `-I${cfg.buildDir}`, ...flags.defines.map(d => `-D${d}`)];

  const n = new Ninja({ buildDir: cfg.buildDir });
  registerDirStamps(n, cfg);
  registerCompileRules(n, cfg);
  registerDepRules(n, cfg);

  const { pch: pchFile, wrapperHeader } = pch(n, cfg, "src/jsc/bindings/root-pch.h", { flags: bunFlags });
  cxx(n, cfg, "src/jsc/bindings/BunProcess.cpp", { flags: bunFlags, pch: pchFile, pchHeader: wrapperHeader });
  cc(n, cfg, "src/example.c", { flags: bunFlags });
  resolveDep(n, cfg, syntheticDep(join(cfg.buildDir, "synth")), new Map());
  resolveDep(n, cfg, syntheticCmakeDep(join(cfg.buildDir, "synthcm")), new Map());
  await n.write();

  const ninja = readFileSync(join(cfg.buildDir, "build.ninja"), "utf8");
  const compileCommands: CompileCommand[] = JSON.parse(
    readFileSync(join(cfg.buildDir, "compile_commands.json"), "utf8"),
  );
  return { cfg, ninja, compileCommands, bunFlags };
}

/**
 * Value of variable `name` on the edge producing `output` (buildDir-relative,
 * as compile_commands.json records it), unescaped the way ninja substitutes
 * it into the command. Outputs here contain no characters ninja escapes.
 */
function edgeVar(ninja: string, output: string, name: string): string {
  const lines = ninja.replace(/ \$\n +/g, " ").split("\n");
  const start = lines.findIndex(l => l.startsWith(`build ${output}:`) || l.startsWith(`build ${output} |`));
  if (start === -1) throw new Error(`no edge builds ${output}:\n${ninja}`);
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) {
    const m = /^  (\w+) = (.*)$/.exec(lines[i]!);
    if (m && m[1] === name) return m[2]!.replaceAll("$$", "$");
  }
  throw new Error(`edge for ${output} sets no ${name}:\n${lines.slice(start, start + 8).join("\n")}`);
}

function entryFor(compileCommands: CompileCommand[], file: string): CompileCommand & { output: string } {
  const entry = compileCommands.find(e => e.file.endsWith(file));
  if (entry?.output === undefined) throw new Error(`no compile_commands.json entry with an output for ${file}`);
  return entry as CompileCommand & { output: string };
}

/** The flags part of an entry: drop the compiler, the PCH pair compile() appends, and `-c <src> -o <out>`. */
function entryFlags(entry: CompileCommand): string[] {
  const args = entry.arguments.slice(1, entry.arguments.lastIndexOf("-c"));
  const pchAt = args.indexOf("-include-pch");
  return pchAt === -1 ? args : args.slice(0, pchAt);
}

/**
 * Word-split a build.ninja variable value the way the command it is spliced
 * into gets split on this machine. On unix that is ninja's `sh -c`. On
 * Windows ninja spawns the tool directly and the tool parses the command
 * line itself; bun does that with CommandLineToArgvW, so handing it the raw
 * text via windowsVerbatimArguments runs the variable through a real Win32
 * argv parser (one of the family that split the `""` spelling this build
 * system used to emit).
 */
async function hostWords(value: string): Promise<string[]> {
  await using proc = isWindows
    ? Bun.spawn({
        // `--` keeps bun from reading the flag words as its own options.
        cmd: [bunExe(), "-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", value],
        windowsVerbatimArguments: true,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      })
    : Bun.spawn({ cmd: ["sh", "-c", `printf '%s\\n' ${value}`], stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return isWindows ? JSON.parse(stdout) : stdout.slice(0, -1).split("\n");
}

describe("compile flags are bare argv in compile_commands.json and quoted only in build.ninja", () => {
  test("flags.ts holds the string defines as clang receives them", () => {
    using dir = tempDir("build-flags", {});
    const cfg = configFor(String(dir));
    const { cflags, cxxflags, defines } = computeFlags(cfg);

    expect(defines).toContain('REPORTED_NODEJS_VERSION="1.2.3"');
    expect(defines).toContain('REPORTED_NODEJS_V8_VERSION="4.5.6-node.7"');
    expect(defines).toContain(`BUN_DYNAMIC_JS_LOAD_PATH="${join(cfg.buildDir, "js").replaceAll("\\", "/")}"`);
    expect([...cflags, ...cxxflags, ...defines].filter(f => SHELL_SYNTAX.test(f))).toEqual([]);
  });

  test("compile_commands.json carries the argv verbatim for bun sources and direct deps", async () => {
    const { cfg, compileCommands, bunFlags } = await emit("linux");

    const bunProcess = entryFor(compileCommands, "BunProcess.cpp");
    expect(bunProcess.directory).toBe(cfg.buildDir);
    expect(bunProcess.arguments).toEqual([
      cfg.cxx,
      ...bunFlags,
      "-include-pch",
      join("pch", "root-pch.h.hxx.pch"),
      "-c",
      join(cfg.cwd, "src/jsc/bindings/BunProcess.cpp"),
      "-o",
      join(cfg.buildDir, "obj/src/jsc/bindings/BunProcess.cpp" + cfg.objSuffix),
    ]);
    expect(bunProcess.arguments).toContain('-DREPORTED_NODEJS_VERSION="1.2.3"');
    expect(entryFlags(entryFor(compileCommands, "example.c"))).toEqual(bunFlags);

    expect(entryFlags(entryFor(compileCommands, "synth.c"))).toEqual(
      expect.arrayContaining([
        `-I${join(cfg.buildDir, "synth/inc")}`,
        '-DSYNTH_NAME="a b"',
        "-DSYNTH_LEVEL=2",
        "-DSYNTH_STATIC",
        `-I${join(cfg.buildDir, "deps/synth")}`,
      ]),
    );
    expect(compileCommands.flatMap(e => e.arguments).filter(a => SHELL_SYNTAX.test(a))).toEqual([]);
  });

  test("this host splits every build.ninja flags variable back into exactly that argv", async () => {
    const { cfg, ninja, compileCommands, bunFlags } = await emit(hostOs);

    for (const file of ["BunProcess.cpp", "example.c", "synth.c"]) {
      const entry = entryFor(compileCommands, file);
      const words = await hostWords(edgeVar(ninja, entry.output, file.endsWith(".cpp") ? "cxxflags" : "cflags"));
      expect(words).toEqual(entryFlags(entry));
    }
    // The PCH has no compile_commands.json entry. It must see the same argv
    // as the TUs that include it, or clang rejects it over a define mismatch.
    expect(await hostWords(edgeVar(ninja, join("pch", "root-pch.h.hxx.pch"), "cxxflags"))).toEqual(bunFlags);
    // The dep's codegen tool is compiled by source.ts's own dep_host_cc rule.
    expect(
      await hostWords(edgeVar(ninja, join("deps", "synth", `codegen-tool${cfg.host.exeSuffix}`), "flags")),
    ).toEqual(["-w", '-DGEN_BANNER="gen tool"']);
    // Nested cmake: splitting the configure command yields cmake one
    // -DCMAKE_<LANG>_FLAGS=<fragment> argument per language, and the inner
    // build later splits <fragment> itself. (-fPIC: the dep sets pic, which
    // emitNestedCmake only translates into a flag for non-Windows targets.)
    const depFlags = computeDepFlags(cfg);
    const cmakeArgs = await hostWords(edgeVar(ninja, SYNTHCM_CONFIGURE_OUTPUT, "args"));
    for (const [lang, globals] of [
      ["C", depFlags.cflags],
      ["CXX", depFlags.cxxflags],
    ] as const) {
      const prefix = `-DCMAKE_${lang}_FLAGS=`;
      const fragments = cmakeArgs.filter(a => a.startsWith(prefix));
      expect(fragments).toHaveLength(1);
      expect(await hostWords(fragments[0]!.slice(prefix.length))).toEqual([
        ...globals,
        ...(cfg.windows ? [] : ["-fPIC"]),
        SYNTHCM_EXTRA[lang],
      ]);
    }
  });

  test("unix hosts single-quote exactly the arguments that need it", async () => {
    const { cfg, ninja, compileCommands } = await emit("linux");
    const cxxflags = edgeVar(ninja, entryFor(compileCommands, "BunProcess.cpp").output, "cxxflags");
    const cflags = edgeVar(ninja, entryFor(compileCommands, "synth.c").output, "cflags");

    expect(cxxflags).toContain(` '-I${cfg.buildDir}' `);
    expect(cxxflags).toContain(` '-DREPORTED_NODEJS_VERSION="1.2.3"' -DREPORTED_NODEJS_ABI_VERSION=`);
    expect(cflags).toContain(` '-I${join(cfg.buildDir, "synth/inc")}' `);
    expect(cflags).toContain(` '-DSYNTH_NAME="a b"' -DSYNTH_LEVEL=2 -DSYNTH_STATIC `);
  });

  test("windows hosts use Win32 argv quoting, which every tool's argv parser reads the same way", async () => {
    const { cfg, ninja, compileCommands } = await emit("windows");
    const cxxflags = edgeVar(ninja, entryFor(compileCommands, "BunProcess.cpp").output, "cxxflags");
    const cflags = edgeVar(ninja, entryFor(compileCommands, "synth.c").output, "cflags");

    expect(cxxflags).toContain(` "-I${cfg.buildDir}" `);
    expect(cxxflags).toContain(` "-DREPORTED_NODEJS_VERSION=\\"1.2.3\\"" -DREPORTED_NODEJS_ABI_VERSION=`);
    expect(cflags).toContain(` "-DSYNTH_NAME=\\"a b\\"" -DSYNTH_LEVEL=2 -DSYNTH_STATIC `);
    expect(edgeVar(ninja, join("deps", "synth", "codegen-tool.exe"), "flags")).toBe(`-w "-DGEN_BANNER=\\"gen tool\\""`);
    // Nested cmake composes two layers: the fragment's own `\"` escapes are
    // themselves escaped inside the outer "-DCMAKE_<LANG>_FLAGS=..." word.
    const cmakeArgs = edgeVar(ninja, SYNTHCM_CONFIGURE_OUTPUT, "args");
    expect(cmakeArgs).toContain(String.raw` \"-DSYNTHCM_C=\\\"a b\\\"\""`);
    expect(cmakeArgs).toContain(String.raw` \"-DSYNTHCM_CXX=\\\"c d\\\"\""`);
    // Only the build.ninja side changes with the host; the argv is the same.
    expect(compileCommands.flatMap(e => e.arguments).filter(a => SHELL_SYNTAX.test(a))).toEqual([]);
    expect(entryFlags(entryFor(compileCommands, "synth.c"))).toContain('-DSYNTH_NAME="a b"');
  });
});

describe("shell.ts quote()", () => {
  test("passes plain flags and paths through unquoted on both hosts", () => {
    for (const arg of ["-O2", "-DFOO=1", "-IC:\\bun\\src", "/clang:-march=armv8-a+crc", "--sysroot=/opt/x"]) {
      expect(quote(arg, false)).toBe(arg);
      expect(quote(arg, true)).toBe(arg);
    }
  });

  test("posix: single-quotes, escaping embedded single quotes", () => {
    expect(quoteArgs(['-DX="a b"', "-I/tmp/build dir", "it's", ""], false)).toBe(
      `'-DX="a b"' '-I/tmp/build dir' 'it'\\''s' ''`,
    );
  });

  test('windows: double-quotes, \\" for quotes, and doubles only the backslashes that precede a quote', () => {
    expect(
      ['-DX="a b"', '-DEMPTY=""', "-IC:\\build dir\\inc", "-IC:\\build dir\\", '-DP="C:\\x y\\"', ""].map(a =>
        quote(a, true),
      ),
    ).toEqual([
      `"-DX=\\"a b\\""`,
      `"-DEMPTY=\\"\\""`,
      `"-IC:\\build dir\\inc"`,
      `"-IC:\\build dir\\\\"`,
      `"-DP=\\"C:\\x y\\\\\\""`,
      `""`,
    ]);
  });
});
