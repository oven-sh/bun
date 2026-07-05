/**
 * Regression tests for the `-C metadata` pin — scripts/build/rustc-metadata-shim.rs
 * and its wiring in scripts/build/rust.ts.
 *
 * Cargo folds the `-C metadata` of every dependency into a unit's own, and rustc
 * hashes that into the `Cs…` disambiguator every v0 symbol carries. Without the
 * wrapper, a dependency-edge edit anywhere below a crate renames every symbol
 * that crate defines — `bun_runtime`, with ~100 direct workspace deps, was
 * renamed by nearly every commit.
 *
 * The graph assertion is configure-time only and runs everywhere. The
 * behavioural ones drive the wrapper `bun bd` already built, so they need a
 * build directory; CI's test lanes run a downloaded binary and skip them. (The
 * build-rust lanes are what prove the wrapper compiles and cargo runs through
 * it on every platform — no need to rebuild it from a test.)
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveConfig, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { emitRust, registerRustRules } from "../../scripts/build/rust.ts";

test("the wrapper is built before cargo and reaches its env", () => {
  /** A fully-populated fake toolchain — resolveConfig never spawns any of these. */
  const toolchain: Toolchain = {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    clangVersion: "21.1.8",
    clangResourceDir: "/fake/llvm/lib/clang/21",
    ar: "/fake/llvm/bin/llvm-ar",
    ranlib: "/fake/llvm/bin/llvm-ranlib",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLld: undefined,
    rustLlvmVersion: "22.1.4",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    dsymutil: "/fake/llvm/bin/dsymutil",
    bun: "/fake/bin/bun",
    jsRuntime: "/fake/bin/bun",
    esbuild: "/fake/bin/esbuild",
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: "/fake/rust/bin/cargo",
    cargoHome: "/fake/.cargo",
    rustupHome: "/fake/.rustup",
    msvcLinker: undefined,
    rc: undefined,
    mt: undefined,
    nasm: undefined,
  };
  const cfg = resolveConfig({ os: "linux", arch: "x64", buildType: "Debug" }, toolchain);
  const n = new Ninja({ buildDir: cfg.buildDir });
  registerRustRules(n, cfg);
  emitRust(n, cfg, { codegenInputs: [], codegenOrderOnly: [], rustSources: [], vendorStamps: [] });
  // ninja wraps long build lines with a trailing `$`; join them back up.
  const graph = n.toString().replace(/\$\n\s+/g, " ");

  // `.exe` on a Windows host: the wrapper is a host executable, and the host
  // isn't the linux target asked for above.
  expect(graph).toMatch(/^build rustc-metadata-shim(\.exe)?: rustc_metadata_shim \S*rustc-metadata-shim\.rs\b/m);
  // `_WORKSPACE_`, not plain RUSTC_WRAPPER: registry crates keep cargo's
  // collision-proof hash, only our own crates get a pinned one.
  expect(graph).toContain("--env=RUSTC_WORKSPACE_WRAPPER=");
  expect(graph).not.toContain("--env=RUSTC_WRAPPER=");

  const cargoEdge = graph.split("\n").find(line => line.startsWith("build ") && line.includes("libbun_rust.a:"));
  expect(cargoEdge).toBeDefined();
  // Implicit inputs come after the `|` — cargo can't run before the wrapper exists.
  expect(cargoEdge!.split("|")[1]).toContain("rustc-metadata-shim");
});

// emitRust() drops the wrapper in the build directory, which is where the bun
// under test lives when it came from `bun bd`. A downloaded binary has no build
// directory next to it, so CI's test lanes skip: they have no business invoking
// a rust toolchain, and on a rustup proxy the first call downloads a channel.
const shim = join(dirname(process.execPath), `rustc-metadata-shim${isWindows ? ".exe" : ""}`);

describe.skipIf(!existsSync(shim))("rustc metadata shim", () => {
  let fakeRustc = "";

  beforeAll(() => {
    // Not disposed: bun:test has no `using` for suite-scoped fixtures, and the
    // OS reaps its own temp dir.
    const dir = tempDir("rustc-metadata-shim", { "fake-rustc.ts": `console.log(process.argv.slice(2).join("\\n"))` });
    fakeRustc = join(String(dir), "fake-rustc.ts");
  });

  /** Run the wrapper; returns the argv it would have handed the real rustc. */
  async function argvFor(args: string[], pkg = "bun_runtime") {
    await using proc = Bun.spawn({
      // The wrapper's first argument is always rustc's path — that's cargo's contract.
      cmd: [shim, bunExe(), fakeRustc, ...args],
      env: { ...bunEnv, CARGO_PKG_NAME: pkg },
      stderr: "pipe",
    });
    // stderr is drained so the pipe can't fill, but not asserted empty — a debug
    // or ASAN bun writes benign noise there. It does carry the wrapper's own
    // failure message, so surface it when the exit code is wrong.
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`wrapper exited ${exitCode}\n${stderr}`);
    return stdout.split("\n").filter(Boolean);
  }

  const unit = ["--crate-name", "bun_runtime", "--crate-type", "lib", "--target", "x86_64-unknown-linux-gnu"];

  test.concurrent("two dependency-graph states collapse to the same metadata", async () => {
    // The only difference is cargo's dependency hash — exactly what moves when a
    // crate anywhere below this one gains or loses a dependency. `extra-filename`
    // must survive: it keys cargo's on-disk artifact names.
    const before = [...unit, "-C", "extra-filename=-4e6e51e9e0da5e6b", "-C", "metadata=4e6e51e9e0da5e6b", "lib.rs"];
    const after = [...unit, "-C", "extra-filename=-9c1d0ab7735ffd12", "-C", "metadata=9c1d0ab7735ffd12", "lib.rs"];

    expect(await argvFor(before)).toEqual(
      before.map(arg => (arg.startsWith("metadata=") ? "metadata=bun.bun_runtime" : arg)),
    );
    expect(await argvFor(after)).toEqual(
      after.map(arg => (arg.startsWith("metadata=") ? "metadata=bun.bun_runtime" : arg)),
    );
  });

  test.concurrent("distinct packages keep distinct metadata", async () => {
    expect(await argvFor([...unit, "-C", "metadata=aaaa"], "bun_core")).toContain("metadata=bun.bun_core");
  });

  test.concurrent("an invocation without -C metadata passes through untouched", async () => {
    // cargo probes the wrapper with `-vV` / `--print` before it compiles anything.
    expect(await argvFor(["-vV"])).toEqual(["-vV"]);
    expect(await argvFor(["--print", "cfg"])).toEqual(["--print", "cfg"]);
  });
});
