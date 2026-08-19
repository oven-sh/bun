/**
 * Incremental behaviour of the Windows .bin/ shim edge in scripts/build/rust.ts
 * (rule `rust_shim`, emitted for windows targets).
 *
 * The edge's declared output is a per-build-dir stamp; the source-tree exe it
 * copies the freshly built PE over (src/install/windows-shim/bun_shim_impl.exe,
 * one path shared by every windows build dir) is one of its implicit inputs,
 * so a sibling build dir overwriting the exe re-runs it. It is therefore an
 * edge that rewrites one of its own inputs, and ninja (1.11+) records a
 * non-restat edge's mtime as the time its command started: the exe copied
 * during the command is newer than that, so the stamp is dirty again on the
 * build right after every real shim rebuild, which re-runs cargo for the shim
 * and then for bun_bin (whose edge has the stamp as an input). The rule has to
 * be `restat` so that the recorded mtime is the stamp's own, taken after the
 * copy.
 *
 * The graph under test is what registerRustRules() + emitRust() emit, pointed
 * at a scratch repo and at a cargo stand-in that writes the PE where cargo
 * would. Driving it takes ninja itself, node (the build's own wrapper runtime,
 * see the build test) and a non-windows host: the stand-in is a shell script,
 * and the rule's shell dialect follows the host.
 *
 * The build test fails without the restat only under ninja 1.11+, the driver
 * on the debian, ubuntu and macOS lanes and on developer machines. Alpine's
 * `ninja` is samurai, which logs every edge's post-command mtime and so never
 * had the extra rebuild, but it is a driver bun's build runs under, so the
 * test runs there too and checks that the restat rule still converges and
 * still notices the sibling's overwrite under it. Accordingly, nothing is read
 * from the driver beyond what both implementations print. The emission test
 * at the end runs everywhere.
 */
import { which } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, nodeExe, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { emitRust, registerRustRules, rustTarget } from "../../scripts/build/rust.ts";
import { quote } from "../../scripts/build/shell.ts";

// The build test skips where either is missing (test-only lanes without a
// build toolchain); it also skips on Windows hosts, see the header.
const ninjaExe = which("ninja");
const node = nodeExe();

/** A fully-populated fake toolchain; resolveConfig never spawns any of these (the build test overrides jsRuntime). */
function mockToolchain(overrides: Partial<Toolchain>): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang-cl",
    cxx: "/fake/llvm/bin/clang-cl",
    hostCc: undefined,
    hostCxx: undefined,
    clangVersion: "21.1.8",
    clangResourceDir: "/fake/llvm/lib/clang/21",
    ar: "/fake/llvm/bin/llvm-lib",
    ranlib: undefined,
    ld: "/fake/llvm/bin/lld-link",
    ld64Lld: undefined,
    rustLld: undefined,
    rustLlvmVersion: "22.1.4",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/llvm/bin/llvm-strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    dsymutil: undefined,
    bun: "/fake/bin/bun",
    jsRuntime: "/fake/bin/node",
    esbuild: "/fake/bin/esbuild",
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: undefined,
    cargoHome: undefined,
    rustupHome: undefined,
    msvcLinker: undefined,
    rc: "/fake/llvm/bin/llvm-rc",
    mt: undefined,
    nasm: undefined,
    ...overrides,
  };
}

/** The shim edge's inputs, minus the exe (emitRust() pre-creates it). The build test fills in the cargo script. */
const fixtureTree = {
  "repo/Cargo.toml": "[workspace]\n",
  "repo/src/install/windows-shim/bun_shim_impl.rs": "// stands in for the shim crate\n",
  "vendor/lolhtml/.ref": "",
  "toolchain/cargo": "",
};

interface ShimGraph {
  cfg: Config;
  ninja: Ninja;
  /** The cargo stand-in's path (resolveConfig only stores it; it is also one of the edge's inputs). */
  cargo: string;
  /** Where the stand-in writes the PE: cargo's output path for `--profile shim`. */
  shimSrc: string;
  /** The source-tree exe the edge copies the PE over, and one of its inputs. */
  shimDest: string;
  /** The edge's declared output. */
  shimStamp: string;
}

/**
 * Emit the rust edges for a windows target (host arch) into `<dir>/build`,
 * with `<dir>/repo` (from `fixtureTree`) standing in for the source tree, so
 * the exe the edge writes lands in the scratch dir and not in this checkout.
 */
function emitShimGraph(dir: string, toolchain: Partial<Toolchain> = {}): ShimGraph {
  const repo = join(dir, "repo");
  const cargo = join(dir, "toolchain", "cargo");
  const buildDir = join(dir, "build");
  const cfg: Config = {
    ...resolveConfig(
      // winsysroot is only consulted when cross-compiling, and then only
      // spliced into flags; nothing probes it.
      { os: "windows", buildType: "Debug", buildDir, winsysroot: join(dir, "winsysroot") },
      mockToolchain({ cargo, ...toolchain }),
    ),
    cwd: repo,
  };
  expect(cfg.windows).toBe(true);

  const ninja = new Ninja({ buildDir });
  registerRustRules(ninja, cfg);
  emitRust(ninja, cfg, {
    codegenInputs: [],
    codegenOrderOnly: [],
    rustSources: [join(repo, "src", "install", "windows-shim", "bun_shim_impl.rs"), join(repo, "Cargo.toml")],
    vendorStamps: [join(dir, "vendor", "lolhtml", ".ref")],
  });

  const shimOutDir = join(buildDir, "rust-target", rustTarget(cfg), "shim");
  return {
    cfg,
    ninja,
    cargo,
    shimSrc: join(shimOutDir, "bun_shim_impl.exe"),
    shimDest: join(repo, "src", "install", "windows-shim", "bun_shim_impl.exe"),
    shimStamp: join(shimOutDir, "bun_shim_impl.stamp"),
  };
}

const slash = (p: string) => p.replaceAll("\\", "/");

/** Unwrap `$\n` continuations so each rule / build statement is one line followed by its bindings. */
const ninjaLines = (text: string) => text.replace(/ \$\n +/g, " ").split("\n");

/** The indented `key = value` bindings following line `start`, up to the blank line ninja.ts emits after every block. */
function bindingsAfter(lines: string[], start: number): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) {
    const m = /^ {2}(\w+) = (.*)$/.exec(lines[i]!);
    if (m !== null) bindings[m[1]!] = m[2]!;
  }
  return bindings;
}

/** Bindings of `rule <name>`. */
function rule(text: string, name: string): Record<string, string> {
  const lines = ninjaLines(text);
  const start = lines.indexOf(`rule ${name}`);
  if (start === -1) throw new Error(`no rule ${name} in:\n${text}`);
  return bindingsAfter(lines, start);
}

/** The edge producing `output` (buildDir-relative, `/`-separated), which has no explicit inputs. */
function edge(
  text: string,
  output: string,
): { rule: string; implicitInputs: string[]; bindings: Record<string, string> } {
  const lines = ninjaLines(text);
  const prefix = `build ${output}: `;
  const start = lines.findIndex(line => slash(line).startsWith(prefix));
  if (start === -1) throw new Error(`no edge producing ${output} in:\n${text}`);
  // `<rule> | <implicit inputs...>` (`|| <order-only>` never follows on this edge)
  const [ruleName = "", implicit = ""] = slash(lines[start]!).slice(prefix.length).split(" | ");
  return {
    rule: ruleName,
    implicitInputs: implicit.split(" ").filter(p => p.length > 0),
    bindings: bindingsAfter(lines, start),
  };
}

/**
 * Drives the stamp edge with the `ninja` on PATH. It is run from the build dir
 * and asked for the stamp itself rather than via `-C` and the `bun-shim`
 * phony: `-C` makes samurai announce the directory on stderr, and samurai 1.2
 * crashes on a dry run that reaches a pending edge through a phony.
 */
function shimDriver(buildDir: string, shimStamp: string) {
  const target = slash(relative(buildDir, shimStamp));
  const run = (...flags: string[]) => {
    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [ninjaExe!, ...flags, target],
      cwd: buildDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
  };
  return {
    build: () => run(),
    /**
     * What the next build would do, per a dry run with `-d explain`. Both
     * implementations print each edge they would run as its description
     * behind a NINJA_STATUS-dependent prefix (the rust_shim rule's is "cargo
     * bun_shim_impl → <exe>"), and one `explain` line per reason on stderr
     * (ninja: "ninja explain: recorded mtime of .../bun_shim_impl.stamp older
     * than most recent input .../bun_shim_impl.exe"), so a failing assertion
     * shows the reason. A clean graph yields neither; ninja's "no work to do"
     * and samurai's "nothing to do" notes are the only other output.
     */
    nextBuild: () => {
      const { stdout, stderr, exitCode } = run("-n", "-d", "explain");
      expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
      return {
        runsEdge: stdout.includes("cargo bun_shim_impl"),
        explain: stderr.split("\n").filter(line => line.includes("explain")),
      };
    },
  };
}

describe("rust_shim edge", () => {
  test.skipIf(isWindows || ninjaExe === null || node === null)(
    "the build after a shim build is a no-op, and a sibling build dir overwriting the exe still re-runs it",
    async () => {
      using dir = tempDir("build-rust-shim-edge", fixtureTree);
      // The rule command runs scripts/build/stream.ts through cfg.jsRuntime,
      // i.e. whatever configured the build. This is the form configure.ts
      // produces under node, which is what CI builds run with; bunExe() works
      // too, but a debug build takes seconds to start stream.ts, and this
      // test starts it twice.
      const jsRuntime = `${quote(node!, false)} --experimental-strip-types`;
      const { cfg, ninja, cargo, shimSrc, shimDest, shimStamp } = emitShimGraph(String(dir), { jsRuntime });
      const { buildDir } = cfg;

      // `cargo build -p bun_shim_impl ...` stand-in: links the PE on the first
      // call and, like cargo's fingerprinting would, does nothing after that.
      const pe = `MZ shim for ${rustTarget(cfg)}\n`;
      writeFileSync(
        cargo,
        `#!/bin/sh\nout=${quote(shimSrc, false)}\n[ -e "$out" ] || { mkdir -p "$(dirname "$out")" && printf '%s\\n' ${quote(pe.trimEnd(), false)} > "$out"; }\n`,
      );
      chmodSync(cargo, 0o755);
      await ninja.write();
      const stampEdge = edge(ninja.toString(), slash(relative(buildDir, shimStamp)));
      expect(stampEdge.bindings).toMatchObject({ shim_src: quote(shimSrc, false), shim_dest: quote(shimDest, false) });
      // emitRust() pre-creates the 0-byte placeholder so the input exists.
      expect(readFileSync(shimDest, "utf8")).toBe("");
      const driver = shimDriver(buildDir, shimStamp);

      // Fresh build dir: builds the PE and copies it over the placeholder.
      expect(driver.build()).toMatchObject({ exitCode: 0 });
      expect(readFileSync(shimDest, "utf8")).toBe(pe);
      expect(existsSync(shimStamp)).toBe(true);

      // Nothing has changed since, so the next build has nothing to do. Without
      // restat, ninja recorded the command's start time for the stamp, the
      // copy above postdates it, and the edge (then bun_bin's) runs once more.
      expect(driver.nextBuild()).toEqual({ runsEdge: false, explain: [] });

      // A build dir for another arch/profile copies its own PE over the shared
      // exe, after this dir's stamp. This dir has to notice and put its PE
      // back, or its bun would embed the other arch's shim.
      writeFileSync(shimDest, "MZ shim copied by a sibling build dir\n");
      const afterStamp = new Date(statSync(shimStamp).mtimeMs + 1_000);
      utimesSync(shimDest, afterStamp, afterStamp);
      const overwritten = driver.nextBuild();
      expect(overwritten.runsEdge).toBe(true);
      expect(overwritten.explain.join("\n")).toContain("bun_shim_impl.stamp");

      expect(driver.build()).toMatchObject({ exitCode: 0 });
      expect(readFileSync(shimDest, "utf8")).toBe(pe);
      // That rebuild rewrote the exe during the command just like the fresh
      // build did, and has to converge the same way.
      expect(driver.nextBuild()).toEqual({ runsEdge: false, explain: [] });
    },
  );

  test("the rule is restat, and the exe it rewrites stays an input of the stamp", () => {
    using dir = tempDir("build-rust-shim-edge", fixtureTree);
    const { cfg, ninja, shimDest, shimStamp } = emitShimGraph(String(dir));
    const text = ninja.toString();

    // restat is what makes ninja record the stamp's post-copy mtime. The exe
    // staying an input is the sibling-build-dir invalidation described in the
    // rule's comment; dropping it would also make the next build a no-op,
    // at the cost of embedding a stale exe.
    expect(rule(text, "rust_shim").restat).toBe("1");
    const stamp = edge(text, slash(relative(cfg.buildDir, shimStamp)));
    expect(stamp.rule).toBe("rust_shim");
    expect(stamp.implicitInputs).toContain(slash(relative(cfg.buildDir, shimDest)));
  });
});
