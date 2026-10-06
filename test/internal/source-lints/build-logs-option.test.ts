/**
 * The build's `logs` option (scripts/build/config.ts: on by default in debug
 * builds, set by the `release-assertions` profile and `bun run build:logs`,
 * overridable with `--logs=on|off`) decides whether `scoped_log!` /
 * `BUN_DEBUG_<scope>=1` logging is compiled into the Rust side. It reaches
 * Rust as `bun_core::Environment::ENABLE_LOGS`, through pieces that have to
 * agree with each other, pinned here:
 *
 *   - scripts/build/buildOptionsRs.ts emits `ENABLE_LOGS` into build_options.rs
 *     as a `cfg!(...)`, and scripts/build/rust.ts passes that `--cfg` exactly
 *     when `cfg.logs` is set (it used to be `cfg!(bun_debug)`, which made the
 *     option dead: a release build configured with logs had none, a debug
 *     build configured without still logged);
 *   - Cargo.toml registers the cfg so a bare `cargo check` doesn't warn;
 *   - a release build with logs keeps `#[track_caller]` locations, which the
 *     `mark_binding()` style of logger prints (`-Zlocation-detail=none` would
 *     turn them into `<redacted>:0`);
 *   - the loggers in src gate on `ENABLE_LOGS`, not on `IS_DEBUG`, otherwise
 *     a non-debug build configured with logs still compiles them out.
 *
 * Pure config evaluation plus a source scan: no compiler is involved.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { generateBuildOptionsRs } from "../../../scripts/build/buildOptionsRs.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../../scripts/build/config.ts";
import { getProfile } from "../../../scripts/build/profiles.ts";
import { cargoBuildInvocation } from "../../../scripts/build/rust.ts";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");

/** A fully-populated fake toolchain; nothing here is ever executed. */
function mockToolchain(): Toolchain {
  return {
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
    rustLlvmVersion: "22.1.4",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/llvm/bin/llvm-strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
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
}

/**
 * A linux-x64 target resolves on every host once it is told where its sysroot
 * is (the path is only recorded, never opened).
 */
function linuxConfig(partial: PartialConfig, buildDir: string): Config {
  return resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildDir, linuxSysroot: buildDir, ...partial },
    mockToolchain(),
  );
}

function rustflags(cfg: Config): string[] {
  return cargoBuildInvocation(cfg).env.CARGO_ENCODED_RUSTFLAGS?.split("\x1f") ?? [];
}

/** The right-hand side of `pub const ENABLE_LOGS: bool = ...;` in the build_options.rs generated for `cfg`. */
function generatedEnableLogs(cfg: Config): string {
  const source = readFileSync(generateBuildOptionsRs(cfg), "utf8");
  const match = /^pub const ENABLE_LOGS: bool = (.+);$/m.exec(source);
  if (!match) throw new Error(`build_options.rs has no ENABLE_LOGS constant:\n${source}`);
  return match[1];
}

/** The name inside `cfg!(...)`, or undefined when the constant is a plain literal. */
function cfgName(expr: string): string | undefined {
  return /^cfg!\((\w+)\)$/.exec(expr)?.[1];
}

/**
 * What `bun_core::Environment::ENABLE_LOGS` evaluates to in the cargo build
 * rust.ts emits for `cfg`: the generated constant, resolved against the
 * rustflags of that same build.
 */
function rustEnableLogs(cfg: Config): boolean {
  const expr = generatedEnableLogs(cfg);
  if (expr === "true" || expr === "false") return expr === "true";
  const name = cfgName(expr);
  if (name === undefined) throw new Error(`unexpected ENABLE_LOGS initializer: ${expr}`);
  const flags = rustflags(cfg);
  // rustc's unexpected_cfgs lint needs the cfg declared in the same build
  // that may set it, whether or not this configuration sets it.
  expect(flags).toContain(`--check-cfg=cfg(${name})`);
  return flags.includes(`--cfg=${name}`);
}

describe("ENABLE_LOGS follows the logs option", () => {
  const cases: { name: string; partial: PartialConfig; logs: boolean }[] = [
    // The profile's doc comment promises "Release + assertions + logs".
    { name: "release-assertions profile", partial: getProfile("release-assertions"), logs: true },
    // `bun run build:logs`.
    { name: "release --logs=on", partial: { buildType: "Release", logs: true }, logs: true },
    { name: "debug --logs=off", partial: { buildType: "Debug", logs: false }, logs: false },
    { name: "debug (default on)", partial: { buildType: "Debug" }, logs: true },
    { name: "release (default off)", partial: { buildType: "Release" }, logs: false },
    // release-asan / the CI asan lane: assertions on, logs stay off.
    {
      name: "release-asan (default off)",
      partial: { buildType: "Release", asan: true, assertions: true },
      logs: false,
    },
  ];

  for (const { name, partial, logs } of cases) {
    test(`${name}: rust ENABLE_LOGS is ${logs}`, () => {
      using dir = tempDir("build-logs-option", {});
      const cfg = linuxConfig(partial, String(dir));
      // The option itself resolves as documented; what is under test is
      // whether the Rust build sees that value.
      expect(cfg.logs).toBe(logs);
      expect(rustEnableLogs(cfg)).toBe(logs);
    });
  }

  test("logs is independent of the Debug-build cfg", () => {
    using dir = tempDir("build-logs-option", {});
    const releaseWithLogs = rustflags(linuxConfig({ buildType: "Release", logs: true }, String(dir)));
    expect(releaseWithLogs).not.toContain("--cfg=bun_debug");
    const debugWithoutLogs = rustflags(linuxConfig({ buildType: "Debug", logs: false }, String(dir)));
    expect(debugWithoutLogs).toContain("--cfg=bun_debug");
  });

  test("a release build with logs keeps the call-site locations its loggers print", () => {
    using dir = tempDir("build-logs-option", {});
    const locationDetail = (partial: PartialConfig) =>
      rustflags(linuxConfig(partial, String(dir))).includes("-Zlocation-detail=none");
    expect({
      release: locationDetail({ buildType: "Release" }),
      "release --logs=on": locationDetail({ buildType: "Release", logs: true }),
      "release-assertions": locationDetail(getProfile("release-assertions")),
    }).toEqual({
      release: true,
      "release --logs=on": false,
      "release-assertions": false,
    });
  });

  test("the cfg build_options.rs reads is registered for bare cargo in Cargo.toml", () => {
    using dir = tempDir("build-logs-option", {});
    const name = cfgName(generatedEnableLogs(linuxConfig({ buildType: "Debug" }, String(dir))));
    if (name === undefined) return; // a literal needs no registration
    const cargoToml = readFileSync(resolve(repoRoot, "Cargo.toml"), "utf8");
    const unexpectedCfgs = /^unexpected_cfgs\s*=.*$/m.exec(cargoToml)?.[0];
    expect(unexpectedCfgs).toBeDefined();
    expect(unexpectedCfgs).toContain(`'cfg(${name})'`);
  });
});

describe("the loggers in src gate on ENABLE_LOGS", () => {
  /** `//` comments blanked out (newlines kept, so line numbers survive). */
  const stripComments = (source: string) => source.replace(/\/\/[^\n]*/g, "");

  /** Body of `macro_rules! <name> { ... }` in `source`, up to the first line that is just `}`. */
  function macroBody(source: string, name: string): string {
    const match = new RegExp(String.raw`^macro_rules! ${name} \{\n([\s\S]*?)^\}`, "m").exec(source);
    if (!match) throw new Error(`macro_rules! ${name} not found`);
    return match[1];
  }

  // `<CONST> && scope.is_visible()`: one `if` condition, however rustfmt
  // wraps it, since `;` and `{` cannot occur inside it.
  const guardOn = (constant: string, flags = "") =>
    new RegExp(String.raw`\b${constant}\b[^;{]*\.is_visible\(\)`, flags);

  test("scoped_log!, syslog! and mark_binding! check ENABLE_LOGS before the scope", () => {
    const macros = [
      { file: "src/bun_core/output.rs", name: "scoped_log" },
      { file: "src/sys/lib.rs", name: "syslog" },
      { file: "src/bun_core/Global.rs", name: "mark_binding" },
    ];
    for (const { file, name } of macros) {
      const body = macroBody(stripComments(readFileSync(resolve(repoRoot, file), "utf8")), name);
      expect(body, `${name}! in ${file}`).toMatch(guardOn("ENABLE_LOGS"));
      expect(body, `${name}! in ${file}`).not.toMatch(/\bIS_DEBUG\b/);
    }
  });

  test("no logger guard keys on IS_DEBUG", () => {
    // `IS_DEBUG && scope.is_visible()` compiles the log out of every non-debug
    // build, including the ones configured with logs. Gate on ENABLE_LOGS
    // instead, or just call scoped_log!, which does.
    const offenders: string[] = [];
    const guard = guardOn("IS_DEBUG", "g");
    for (const rel of new Bun.Glob("src/**/*.rs").scanSync({ cwd: repoRoot })) {
      const raw = readFileSync(resolve(repoRoot, rel), "utf8");
      if (!raw.includes(".is_visible()")) continue;
      const source = stripComments(raw);
      for (const match of source.matchAll(guard)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${rel.replaceAll("\\", "/")}:${line}`);
      }
    }
    expect(offenders.sort()).toEqual([]);
  });
});
