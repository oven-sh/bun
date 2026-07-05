/**
 * `RUSTC_WORKSPACE_WRAPPER` regression tests — scripts/build/rustc-metadata-shim.rs
 * and its wiring in scripts/build/rust.ts.
 *
 * Cargo folds the `-C metadata` of every dependency into a unit's own, and rustc
 * hashes that into the `Cs…` disambiguator every v0 symbol carries. Without the
 * wrapper, a dependency-edge edit anywhere below a crate renames every symbol
 * that crate defines — `bun_runtime`, at the top of the dependency cone, gets
 * renamed by nearly every commit. The wrapper replaces the value with one that
 * depends only on the unit's own identity.
 *
 * The graph assertions are configure-time only and run everywhere. The
 * behavioural ones compile the wrapper, so they need a rust toolchain.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

import { type Config, type PartialConfig, resolveConfig, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { emitRust, registerRustRules } from "../../scripts/build/rust.ts";

const shimSource = join(import.meta.dirname, "..", "..", "scripts", "build", "rustc-metadata-shim.rs");

/** A fully-populated fake toolchain — resolveConfig never spawns any of these. */
function mockToolchain(): Toolchain {
  return {
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
}

/** The ninja graph `emitRust` produces for a plain linux build. */
function rustGraph(partial: PartialConfig = {}): string {
  const cfg: Config = resolveConfig({ os: "linux", arch: "x64", buildType: "Debug", ...partial }, mockToolchain());
  const n = new Ninja({ buildDir: cfg.buildDir });
  registerRustRules(n, cfg);
  emitRust(n, cfg, { codegenInputs: [], codegenOrderOnly: [], rustSources: [], vendorStamps: [] });
  return n.toString();
}

describe("rustc metadata shim: build graph", () => {
  test("the wrapper is built from its source and reaches cargo's env", () => {
    const graph = rustGraph();
    expect(graph).toContain("rule rustc_metadata_shim");
    expect(graph).toMatch(/^build rustc-metadata-shim: rustc_metadata_shim \S*rustc-metadata-shim\.rs$/m);
    // `_WORKSPACE_`, not plain RUSTC_WRAPPER: registry crates keep cargo's
    // collision-proof hash, only our own crates get a pinned one.
    expect(graph).toContain("--env=RUSTC_WORKSPACE_WRAPPER=");
    expect(graph).not.toContain("--env=RUSTC_WRAPPER=");
  });

  test("cargo cannot run before the wrapper exists", () => {
    // ninja wraps long build lines with a trailing `$`; join them back up.
    const cargoEdge = rustGraph()
      .replace(/\$\n\s+/g, " ")
      .split("\n")
      .find(line => line.startsWith("build ") && line.includes("libbun_rust.a:"));
    expect(cargoEdge).toBeDefined();
    // Implicit inputs come after the `|`.
    expect(cargoEdge!.split("|")[1]).toContain("rustc-metadata-shim");
  });
});

// Compiling the wrapper needs rustc. It sits next to cargo on both rustup and
// distro installs — the same assumption registerRustRules() makes.
const rustc = Bun.which("rustc");

describe.skipIf(rustc === null)("rustc metadata shim: rewriting", () => {
  /** Compile the wrapper, next to a fake `rustc` that just echoes its argv. */
  async function compileShim(dir: string) {
    const shim = join(dir, "shim");
    await using proc = Bun.spawn({
      cmd: [rustc!, "--edition", "2024", "-Copt-level=0", "-o", shim, shimSource],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return shim;
  }

  /** Run the wrapper; returns the argv it would have handed the real rustc. */
  async function argvFor(dir: string, shim: string, args: string[], pkg = "bun_runtime") {
    await using proc = Bun.spawn({
      // The wrapper's first argument is always rustc's path — that's cargo's contract.
      cmd: [shim, bunExe(), join(dir, "fake-rustc.ts"), ...args],
      env: { ...bunEnv, CARGO_PKG_NAME: pkg, CARGO_PKG_VERSION: "0.0.0" },
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    return stdout.split("\n").filter(Boolean);
  }

  /** The `-C metadata=…` value the wrapper handed down. */
  function metadataOf(argv: string[]): string | undefined {
    for (let i = 0; i + 1 < argv.length; i++) {
      if (argv[i] === "-C" && argv[i + 1]!.startsWith("metadata=")) return argv[i + 1]!.slice("metadata=".length);
    }
    return undefined;
  }

  function fixture() {
    return tempDir("rustc-metadata-shim", {
      "fake-rustc.ts": `console.log(process.argv.slice(2).join("\\n"));`,
    });
  }

  const unit = [
    "--crate-name",
    "bun_runtime",
    "--edition=2024",
    "--crate-type",
    "lib",
    "--cfg",
    'feature="default"',
    "--target",
    "x86_64-unknown-linux-gnu",
  ];
  const pinned = "bun/bun_runtime@0.0.0/x86_64-unknown-linux-gnu/lib/default";

  test("two dependency-graph states collapse to the same metadata", async () => {
    using dir = fixture();
    const shim = await compileShim(String(dir));
    // The only difference is cargo's dependency hash — exactly what moves when a
    // crate anywhere below this one gains or loses a dependency.
    const before = await argvFor(String(dir), shim, [...unit, "-C", "metadata=4e6e51e9e0da5e6b"]);
    const after = await argvFor(String(dir), shim, [...unit, "-C", "metadata=9c1d0ab7735ffd12"]);

    expect(metadataOf(before)).toBe(pinned);
    expect(metadataOf(after)).toBe(pinned);
  });

  test("distinct units keep distinct metadata", async () => {
    using dir = fixture();
    const shim = await compileShim(String(dir));
    const pin = async (args: string[], pkg?: string) => metadataOf(await argvFor(String(dir), shim, args, pkg));

    const runtime = await pin([...unit, "-C", "metadata=aaaa"]);
    const core = await pin([...unit, "-C", "metadata=aaaa"], "bun_core");
    const features = await pin([...unit, "--cfg", 'feature="show_crash_trace"', "-C", "metadata=aaaa"]);
    // Build scripts compile for the host, so no `--target` reaches rustc.
    const buildScript = await pin(
      ["--crate-name", "build_script_build", "--crate-type", "bin", "-C", "metadata=aaaa"],
      "bun_core",
    );

    expect(runtime).toBe(pinned);
    expect(buildScript).toBe("bun/bun_core@0.0.0/host/bin/");
    expect(new Set([runtime, core, features, buildScript]).size).toBe(4);
  });

  test("only -C metadata is rewritten; everything else passes through", async () => {
    using dir = fixture();
    const shim = await compileShim(String(dir));
    const args = [...unit, "-C", "extra-filename=-4e6e51e9e0da5e6b", "-C", "metadata=4e6e51e9e0da5e6b", "lib.rs"];

    // `extra-filename` keys cargo's on-disk artifact names — leaving it alone is
    // what keeps two dependency-graph states from clobbering each other's rlibs.
    expect(await argvFor(String(dir), shim, args)).toEqual(
      args.map(arg => (arg === "metadata=4e6e51e9e0da5e6b" ? `metadata=${pinned}` : arg)),
    );
  });

  test("an invocation without -C metadata passes through untouched", async () => {
    using dir = fixture();
    const shim = await compileShim(String(dir));
    // cargo probes the wrapper with `-vV` / `--print` before it compiles anything.
    expect(await argvFor(String(dir), shim, ["-vV"])).toEqual(["-vV"]);
    expect(await argvFor(String(dir), shim, ["--print", "cfg"])).toEqual(["--print", "cfg"]);
  });
});
