/**
 * The per-crate Rust build (scripts/build/rust/) re-implements the parts of cargo that sit between a unit graph
 * and a rustc process: reading manifests (toml.ts), turning a unit into an argv/env (units.ts), and, at build time,
 * parsing build-script directives and rewriting rustc's dep-info into a ninja depfile (run.ts). These are the pure
 * pieces; each is checked against fixed input with the exact output expected.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Config } from "../../scripts/build/config.ts";
import {
  PLAN_VERSION,
  type MetadataPackage,
  type RustPlan,
  type UnitGraphUnit,
} from "../../scripts/build/rust/plan.ts";
import { parseBuildScriptOutput, rustcInvocation, timePass, writeDepfile } from "../../scripts/build/rust/run.ts";
import { parseToml } from "../../scripts/build/rust/toml.ts";
import {
  buildRustGraph,
  linkedRlibs,
  unitManifest,
  type ManifestContext,
  type RustUnit,
  type RustcUnitManifest,
} from "../../scripts/build/rust/units.ts";

describe("parseToml", () => {
  test("reads the value forms a Cargo.toml uses", () => {
    const doc = parseToml(
      [
        `cargo-features = ["public-dependency"]`,
        `[package]`,
        `name = "demo" # trailing comment`,
        `literal = 'C:\\path\\with\\backslashes'`,
        `escaped = "tab\\there \\u00e9"`,
        `count = 1_000`,
        `hex = 0xff`,
        `ratio = -1.5e2`,
        `enabled = true`,
        `multi = """`,
        `first`,
        `second"""`,
        `[lints.rust]`,
        `unexpected_cfgs = { level = "warn", priority = -1, check-cfg = ['cfg(a)', 'cfg(b, values("x"))'] }`,
        `[dependencies.dep]`,
        `version = "1"`,
        `[[bin]]`,
        `name = "one"`,
        `[[bin]]`,
        `name = "two"`,
        `[target.'cfg(windows)'.dependencies]`,
        `winapi = "0.3"`,
        `a.b.c = 1`,
      ].join("\n"),
    );
    expect(doc).toEqual({
      "cargo-features": ["public-dependency"],
      package: {
        name: "demo",
        literal: "C:\\path\\with\\backslashes",
        escaped: "tab\there \u00e9",
        count: 1000,
        hex: 255,
        ratio: -150,
        enabled: true,
        multi: "first\nsecond",
      },
      lints: {
        rust: {
          unexpected_cfgs: { level: "warn", priority: -1, "check-cfg": ["cfg(a)", 'cfg(b, values("x"))'] },
        },
      },
      dependencies: { dep: { version: "1" } },
      bin: [{ name: "one" }, { name: "two" }],
      target: { "cfg(windows)": { dependencies: { winapi: "0.3", a: { b: { c: 1 } } } } },
    });
  });

  test.each([
    ["a duplicate key", `a = 1\na = 2`],
    ["an unterminated string", `a = "open`],
    ["a number with a leading zero", `a = 012`],
    ["a number with a doubled underscore", `a = 1__0`],
    ["a bare value", `a = nope`],
    ["a missing value", `a =`],
    ["text after a value", `a = 1 2`],
  ])("rejects %s", (_, src) => {
    expect(() => parseToml(src, "fixture.toml")).toThrow(/fixture\.toml/);
  });
});

describe("parseBuildScriptOutput", () => {
  test("records every directive cargo acts on, in both spellings", () => {
    const out = parseBuildScriptOutput(
      [
        `ordinary output is ignored`,
        `cargo:rustc-link-lib=static=foo`,
        `cargo::rustc-link-search=native=/opt/lib`,
        `cargo:rustc-link-arg=-Wl,--all`,
        `cargo:rustc-link-arg-bins=-Wl,--bins`,
        `cargo:rustc-link-arg-bin=my-bin=-Wl,--one`,
        `cargo:rustc-link-arg-cdylib=-Wl,--cdylib`,
        `cargo:rustc-cfg=has_thing`,
        `cargo::rustc-check-cfg=cfg(has_thing)`,
        `cargo:rustc-env=KEY=value=with=equals`,
        `cargo:rerun-if-changed=build.rs`,
        `cargo:rerun-if-env-changed=CC`,
        `cargo:warning=careful`,
        `cargo::error=broken`,
        `cargo::metadata=include=/opt/include`,
        `cargo:root=/old/style/metadata`,
      ].join("\n"),
    );
    expect(out).toEqual({
      linkLibs: ["static=foo"],
      linkSearch: ["native=/opt/lib"],
      linkArgs: [
        ["all", "-Wl,--all"],
        ["bins", "-Wl,--bins"],
        ["bin=my-bin", "-Wl,--one"],
        ["cdylib", "-Wl,--cdylib"],
      ],
      cfgs: ["has_thing"],
      checkCfgs: ["cfg(has_thing)"],
      env: [["KEY", "value=with=equals"]],
      metadata: [
        ["include", "/opt/include"],
        ["root", "/old/style/metadata"],
      ],
      rerunIfChanged: ["build.rs"],
      rerunIfEnvChanged: ["CC"],
      warnings: ["careful"],
      errors: ["broken"],
      outDirFiles: [],
    });
  });

  test("turns a malformed directive into a warning instead of dropping it", () => {
    const out = parseBuildScriptOutput([`cargo:no-equals-sign`, `cargo:rustc-link-arg-bin=missing-the-arg`].join("\n"));
    expect(out.warnings).toEqual([
      "invalid directive `cargo:no-equals-sign`",
      "invalid rustc-link-arg-bin `cargo:rustc-link-arg-bin=missing-the-arg`",
    ]);
    expect(out.linkArgs).toEqual([]);
  });
});

/** A rustc unit manifest with only what run.ts's pure functions read. */
function manifestIn(dir: string, over: Partial<RustcUnitManifest>): RustcUnitManifest {
  return {
    kind: "lib",
    crateName: "demo",
    rustc: "rustc",
    cwd: dir,
    args: ["--crate-name", "demo"],
    env: {},
    output: join(dir, "deps", "libdemo-0123.rlib"),
    rmeta: join(dir, "deps", "libdemo-0123.rmeta"),
    rmetaNinjaName: join("deps", "libdemo-0123.rmeta"),
    binDestination: undefined,
    linkArgSelectors: ["all"],
    depInfo: join(dir, "deps", "demo-0123.d"),
    depfile: join(dir, "deps", "demo-0123.d.ninja"),
    buildScriptOutput: undefined,
    depBuildScriptOutputs: [],
    phases: undefined,
    libraryPath: { variable: "LD_LIBRARY_PATH", prepend: [] },
    ...over,
  };
}

describe("writeDepfile", () => {
  test("keeps the rule for this edge's output, makes paths absolute, drops the rest", () => {
    using dir = tempDir("rust-depfile", {});
    const root = String(dir);
    mkdirSync(join(root, "deps"));
    const unit = manifestIn(root, {});
    writeFileSync(
      unit.depInfo,
      [
        `${unit.output}: src/lib.rs src/with\\ space.rs ${join(root, "deps", "libdep-9.rmeta")}`,
        ``,
        `${unit.rmeta}: src/lib.rs src/with\\ space.rs`,
        ``,
        `${unit.depInfo}: src/lib.rs`,
        ``,
        `src/lib.rs:`,
        `src/with\\ space.rs:`,
        ``,
        `# env-dep:CARGO_PKG_NAME=demo`,
      ].join("\n"),
    );
    writeDepfile(unit);
    const abs = (p: string) => join(root, p).replace(/ /g, "\\ ");
    expect(readFileSync(unit.depfile, "utf8")).toBe(
      [
        `${unit.output}: ${abs("src/lib.rs")} ${abs("src/with space.rs")} ${join(root, "deps", "libdep-9.rmeta")}`,
        `${abs("src/lib.rs")}:`,
        `${abs("src/with space.rs")}:`,
        ``,
      ].join("\n"),
    );
  });

  test("refuses dep-info with no rule for the output: ninja would never rebuild the crate", () => {
    using dir = tempDir("rust-depfile-norule", {});
    const root = String(dir);
    mkdirSync(join(root, "deps"));
    const unit = manifestIn(root, {});
    writeFileSync(unit.depInfo, `${join(root, "deps", "libother.rlib")}: src/lib.rs\n`);
    expect(() => writeDepfile(unit)).toThrow(/has no rule for/);
  });
});

describe("timePass", () => {
  test("reads a `-Z time-passes` line as a phase that ends now, and leaves every other line alone", () => {
    const before = Date.now();
    const phase = timePass(`time: {"pass":"type_check_crate","time":1.5,"rss_start":1,"rss_end":2}`)!;
    expect(phase.name).toBe("type_check_crate");
    expect(phase.endMs).toBeGreaterThanOrEqual(before);
    expect(phase.endMs - phase.startMs).toBe(1500);
    // A diagnostic, an artifact notice, and rustc's text form of the same flag.
    expect(timePass(`{"$message_type":"diagnostic","rendered":"warning: time: {"}`)).toBeUndefined();
    expect(timePass(`{"$message_type":"artifact","emit":"metadata"}`)).toBeUndefined();
    expect(timePass(`time:   0.001; rss:   46MB ->   49MB (   +2MB)\tparse_crate`)).toBeUndefined();
  });
});

describe("rustcInvocation", () => {
  const scriptOutput = {
    ...parseBuildScriptOutput(
      [
        `cargo:rustc-link-search=native=/own`,
        `cargo:rustc-link-lib=foo`,
        `cargo:rustc-link-arg=--all`,
        `cargo:rustc-link-arg-bins=--bins`,
        `cargo:rustc-link-arg-bin=my-bin=--mine`,
        `cargo:rustc-link-arg-bin=other-bin=--theirs`,
        `cargo:rustc-cfg=from_script`,
        `cargo:rustc-env=FROM_SCRIPT=1`,
      ].join("\n"),
    ),
  };

  test("a library gets the script's search paths, libs, cfgs and env, and only the link args for every target", () => {
    using dir = tempDir("rust-invocation-lib", { "own.json": JSON.stringify(scriptOutput) });
    const dep = { ...parseBuildScriptOutput(`cargo:rustc-link-search=/from/dependency`) };
    writeFileSync(join(String(dir), "dep.json"), JSON.stringify(dep));
    const { argv, env } = rustcInvocation(
      manifestIn(String(dir), {
        buildScriptOutput: join(String(dir), "own.json"),
        depBuildScriptOutputs: [join(String(dir), "dep.json")],
      }),
    );
    expect(argv).toEqual([
      "--crate-name",
      "demo",
      ...["-L", "native=/own", "-L", "/from/dependency", "-l", "foo", "-C", "link-arg=--all", "--cfg", "from_script"],
    ]);
    expect(env.FROM_SCRIPT).toBe("1");
  });

  test("a bin also gets the link args addressed to bins and to it by name", () => {
    using dir = tempDir("rust-invocation-bin", { "own.json": JSON.stringify(scriptOutput) });
    const { argv } = rustcInvocation(
      manifestIn(String(dir), {
        kind: "bin",
        rmeta: undefined,
        rmetaNinjaName: undefined,
        linkArgSelectors: ["all", "bins", "bin=my-bin"],
        buildScriptOutput: join(String(dir), "own.json"),
      }),
    );
    expect(argv.filter(a => a.startsWith("link-arg="))).toEqual([
      "link-arg=--all",
      "link-arg=--bins",
      "link-arg=--mine",
    ]);
  });
});

describe("buildRustGraph + unitManifest", () => {
  const triple = "x86_64-pc-windows-msvc";
  const profile: UnitGraphUnit["profile"] = {
    name: "shim",
    opt_level: "z",
    lto: "true",
    codegen_backend: null,
    codegen_units: 1,
    debuginfo: 0,
    split_debuginfo: null,
    debug_assertions: false,
    overflow_checks: false,
    rpath: false,
    incremental: false,
    panic: "abort",
    strip: { resolved: "symbols" },
  };
  const pkg = (name: string, source: string | null, manifest: string): MetadataPackage => ({
    id: `${source ?? "path+file:///ws"}#${name}@1.2.3`,
    name,
    version: "1.2.3",
    manifest_path: manifest,
    links: null,
    authors: [],
    description: null,
    homepage: null,
    repository: null,
    license: null,
    license_file: null,
    readme: null,
    rust_version: null,
    edition: "2024",
    features: {},
    source,
  });
  const registry = pkg(
    "dep-a",
    "registry+https://github.com/rust-lang/crates.io-index",
    "/cargo/registry/dep-a/Cargo.toml",
  );
  const local = pkg("my-bin", null, "/ws/src/my-bin/Cargo.toml");
  const unit = (p: MetadataPackage, kind: "lib" | "bin", deps: UnitGraphUnit["dependencies"]): UnitGraphUnit => ({
    pkg_id: p.id,
    target: {
      kind: [kind],
      crate_types: [kind],
      name: p.name,
      src_path: kind === "bin" ? "/ws/src/my-bin/main.rs" : "/cargo/registry/dep-a/src/lib.rs",
      edition: "2024",
    },
    profile,
    platform: triple,
    mode: "build",
    features: [],
    dependencies: deps,
  });
  const info = (t: string) => ({
    triple: t,
    cfg: ["windows", 'target_os="windows"'],
    fileNames: {
      rlib: ["lib", ".rlib"],
      "proc-macro": ["", ".dll"],
      bin: ["", ".exe"],
    } as RustPlan["target"]["fileNames"],
    splitDebuginfo: [],
  });
  const planWith = (rustflags: string[]): RustPlan => ({
    version: PLAN_VERSION,
    plannedWith: {
      cwd: "/ws",
      cargo: "cargo",
      rustc: "rustc",
      host: triple,
      sysroot: "/toolchain",
      triple,
      rustflags,
      buildScripts: [],
      args: [],
      env: {},
    },
    rustc: {
      path: "/toolchain/bin/rustc",
      version: "1.99.0-nightly",
      commitHash: "abc",
      host: triple,
      sysroot: "/toolchain",
    },
    unitGraph: {
      version: 1,
      units: [
        unit(registry, "lib", []),
        unit(local, "bin", [{ index: 0, extern_crate_name: "dep_a", public: false, noprelude: false }]),
      ],
      roots: [1],
    },
    packages: { [registry.id]: registry, [local.id]: local },
    lintSets: [],
    lints: {},
    profileRoots: { shim: "release" },
    publicDependency: [],
    workspaceRoot: "/ws",
    host: info(triple),
    target: info(triple),
  });
  const context = (graph: ReturnType<typeof buildRustGraph>, timeTrace = false): ManifestContext => ({
    cfg: { ci: false, debug: false, buildDir: "/build", host: { os: "windows" }, timeTrace } as Config,
    graph,
    baseEnv: { BUN_CODEGEN_DIR: "/build/codegen" },
    linker: { host: "link.exe", target: "link.exe" },
    cargo: "cargo",
    rustdoc: "rustdoc",
    binDestination: "/build/codegen/my-bin.exe",
  });

  // The whole command line, in order: cargo's position for each group of flags is part of what is reproduced
  // (the target rustflags come after everything cargo generates).
  const targetDir = join("/build/rust-target/shim", triple);
  const searchPaths = [
    "-L",
    `dependency=${join(targetDir, "deps")}`,
    "-L",
    `dependency=${join("/build/rust-target/shim", "host", "deps")}`,
  ];
  const diagnostics = ["--error-format=json", "--json=diagnostic-rendered-ansi,artifacts,future-incompat"];
  const checkCfg = ["--check-cfg", "cfg(docsrs,test)", "--check-cfg", "cfg(feature, values())"];
  const BIN_ARGS = (bin: RustUnit, dep: RustUnit) => [
    ...["--crate-name", "my_bin", "--edition=2024", join("src", "my-bin", "main.rs")],
    ...diagnostics,
    ...["--crate-type", "bin", `--emit=dep-info=${join(targetDir, "my_bin.d")},link`],
    ...["-C", "opt-level=z", "-C", "panic=abort", "-C", "lto", "-C", "codegen-units=1"],
    ...checkCfg,
    ...["-C", `metadata=${bin.symbolHash}`, "--out-dir", targetDir, "--target", triple],
    ...["-C", "linker=link.exe", "-C", "strip=symbols"],
    ...searchPaths,
    // A link reads the dependency's object code from its rlib and, as the rlib does not embed it, its metadata
    // from the rmeta.
    ...["--extern", `dep_a=${dep.output}`, "--extern", `dep_a=${dep.rmeta}`],
    ...["-Cpanic=immediate-abort", "-Z", "binary-dep-depinfo"],
  ];
  const DEP_ARGS = (dep: RustUnit) => [
    ...["--crate-name", "dep_a", "--edition=2024", "/cargo/registry/dep-a/src/lib.rs"],
    ...diagnostics,
    ...["--crate-type", "lib", `--emit=dep-info=${join(targetDir, "deps", `dep_a-${dep.hash}.d`)},metadata,link`],
    ...["-Z", "embed-metadata=no"],
    ...["-C", "opt-level=z", "-C", "panic=abort", "-C", "linker-plugin-lto", "-C", "codegen-units=1"],
    ...checkCfg,
    ...["-C", `metadata=${dep.symbolHash}`, "-C", `extra-filename=-${dep.hash}`],
    ...["--out-dir", join(targetDir, "deps"), "--target", triple],
    ...["-C", "linker=link.exe", "-C", "strip=symbols"],
    ...searchPaths,
    ...["--cap-lints", "allow", "-Cpanic=immediate-abort", "-Z", "binary-dep-depinfo"],
  ];

  test("a bin root is named after its crate, runs the LTO, links the rlibs, and is copied under its target's name", () => {
    const graph = buildRustGraph(planWith(["-Cpanic=immediate-abort"]), "/build/rust-target/shim");
    const [dep, bin] = graph.units;
    expect(graph.root).toBe(bin);
    expect(bin.kind).toBe("bin");
    expect(bin.output).toBe(join("/build/rust-target/shim", triple, "my_bin.exe"));
    expect(dep.output).toBe(join("/build/rust-target/shim", triple, "deps", `libdep_a-${dep.hash}.rlib`));

    const m = unitManifest(context(graph), bin) as RustcUnitManifest;
    expect(m.kind).toBe("bin");
    expect(m.binDestination).toBe("/build/codegen/my-bin.exe");
    expect(m.rmetaNinjaName).toBeUndefined();
    expect(m.linkArgSelectors).toEqual(["all", "bins", "bin=my-bin"]);
    expect(m.env.CARGO_BIN_NAME).toBe("my-bin");
    expect(m.env.CARGO_PRIMARY_PACKAGE).toBe("1");
    expect(m.args).toEqual(BIN_ARGS(bin, dep));

    const depManifest = unitManifest(context(graph), dep) as RustcUnitManifest;
    expect(depManifest.binDestination).toBeUndefined();
    expect(depManifest.rmetaNinjaName).toBe(join("rust-target/shim", triple, "deps", `libdep_a-${dep.hash}.rmeta`));
    expect(depManifest.linkArgSelectors).toEqual(["all"]);
    expect(depManifest.args).toEqual(DEP_ARGS(dep));
  });

  test("a library root's link takes the target libraries, with one panic runtime and no host code", () => {
    // What a `-Zbuild-std` graph looks like: std depends on both panic runtimes, and a proc-macro brings host-only crates.
    const names = ["panic_abort", "panic_unwind", "std", "macro_dep", "my_macro", "my-root"] as const;
    const pkgs = Object.fromEntries(names.map(name => [name, pkg(name, null, `/ws/src/${name}/Cargo.toml`)]));
    const dep = (index: number, name: string) => ({ index, extern_crate_name: name, public: false, noprelude: false });
    const lib = (name: (typeof names)[number], platform: string | null, deps: UnitGraphUnit["dependencies"]) => ({
      ...unit(pkgs[name]!, "lib", deps),
      platform,
    });
    const procMacro: UnitGraphUnit = {
      ...unit(pkgs.my_macro!, "lib", [dep(3, "macro_dep")]),
      target: { ...unit(pkgs.my_macro!, "lib", []).target, kind: ["proc-macro"], crate_types: ["proc-macro"] },
      platform: null,
    };
    const base = planWith([]);
    const plan = (panic: "abort" | "unwind"): RustPlan => ({
      ...base,
      unitGraph: {
        version: 1,
        units: [
          lib("panic_abort", triple, []),
          lib("panic_unwind", triple, []),
          lib("std", triple, [dep(0, "panic_abort"), dep(1, "panic_unwind")]),
          lib("macro_dep", null, []),
          procMacro,
          lib("my-root", triple, [dep(2, "std"), dep(4, "my_macro")]),
        ].map(u => ({ ...u, profile: { ...u.profile, panic } })),
        roots: [5],
      },
      packages: Object.fromEntries(Object.values(pkgs).map(p => [p.id, p])),
    });

    const abort = buildRustGraph(plan("abort"), "/build/rust-target");
    expect(abort.root.kind).toBe("lib");
    // The root is named like every other library: by its crate and its hash.
    expect(abort.root.output).toBe(join("/build/rust-target", triple, "deps", `libmy_root-${abort.root.hash}.rlib`));
    expect(linkedRlibs(abort).map(u => u.crateName)).toEqual(["my_root", "std", "panic_abort"]);

    const unwind = buildRustGraph(plan("unwind"), "/build/rust-target");
    expect(linkedRlibs(unwind).map(u => u.crateName)).toEqual(["my_root", "std", "panic_unwind"]);
  });

  test("--time-trace=on has rustc report its passes, to a file beside the unit's output", () => {
    const graph = buildRustGraph(planWith(["-Cpanic=immediate-abort"]), "/build/rust-target/shim");
    const [dep] = graph.units;
    expect((unitManifest(context(graph), dep) as RustcUnitManifest).phases).toBeUndefined();

    const traced = unitManifest(context(graph, true), dep) as RustcUnitManifest;
    expect(traced.args).toEqual([...DEP_ARGS(dep), "-Z", "time-passes", "-Z", "time-passes-format=json"]);
    expect(traced.phases).toBe(`${dep.output}.phases.json`);
  });

  test("target rustflags change where an artifact is written but not how its symbols are mangled", () => {
    const plain = buildRustGraph(planWith([]), "/build/rust-target/shim").units[0];
    const flagged = buildRustGraph(planWith(["-Ctarget-cpu=native"]), "/build/rust-target/shim").units[0];
    expect(flagged.hash).not.toBe(plain.hash);
    expect(flagged.symbolHash).toBe(plain.symbolHash);
  });
});
