import { afterAll, afterEach, describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMusl, isWindows, nodeExe, tempDir } from "harness";
import { appendFileSync, chmodSync, copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  candidateBuilds,
  orderFileEligible,
  type BuildLookups,
  type OrderFileContext,
} from "../../../../scripts/build/ci.ts";
import type { Config } from "../../../../scripts/build/config.ts";
import {
  linkDepends,
  linkerFlags,
  linkerMapOutputs,
  linkerMapPath,
  orderFilePath,
  symbolMapPath,
  usesOrderFile,
  writesLinkerMap,
} from "../../../../scripts/build/flags.ts";
import { slash } from "../../../../scripts/build/shell.ts";
import {
  demangleRust,
  generateOrderFile,
  hintNames,
  NO_PROXY_SETTINGS,
  readFeatures,
  readHintList,
  readNameList,
  readTextSymbols,
  readTrace,
  resolveHints,
  runCommandAsync,
  runGroup,
  sameCode,
  writeStarts as writeStartsFile,
  type GroupPolicy,
} from "../../../../scripts/orderfile/generate.ts";
import { busiestFirst, traceHints } from "../../../../scripts/orderfile/hints.ts";
import { selfSignedCertificate } from "../../../../scripts/orderfile/self-signed.ts";
import {
  linkerMapFor,
  parseChunkStarts,
  parseSymbolMap,
  symbolMapFor,
} from "../../../../scripts/orderfile/windows-symbols.ts";

/**
 * `<buildDir>/linker.order` lists the functions bun executes while starting up
 * so they land together at the front of `.text`, which is worth ~12 MB of
 * resident binary pages on a `bun -e 'console.log(1)'`: lld
 * `--symbol-ordering-file` on linux, Apple ld `-order_file` on macOS, lld-link
 * `/order` on windows (see scripts/orderfile/generate.ts).
 *
 * Nothing in the build fails if this wiring rots. All three linkers skip names
 * they cannot resolve, so a dropped flag silently gives the RSS back instead of
 * breaking the link. Nothing in CI looks at where the functions landed, so these
 * checks are what notices.
 */
const cfg = (overrides: Partial<Config> = {}) =>
  ({
    linux: true,
    darwin: false,
    abi: "gnu",
    arch: "x64",
    arm64: false,
    release: true,
    asan: false,
    valgrind: false,
    windows: false,
    freebsd: false,
    canary: true,
    mode: "archive-link",
    crossTarget: undefined,
    canRunOnHost: true,
    host: { os: "linux" },
    buildDir: "/tmp/build",
    cacheDir: "/tmp/build/cache",
    cwd: "/repo",
    ...overrides,
  }) as Config;

const darwinArm64 = { linux: false, darwin: true, abi: undefined, arm64: true } as Partial<Config>;
/** Both windows lanes cross-compile from linux, so neither can run what it links. */
const windowsX64 = {
  linux: false,
  windows: true,
  abi: undefined,
  crossTarget: "x86_64-pc-windows-msvc",
  canRunOnHost: false,
} as Partial<Config>;
const windowsArm64 = {
  ...windowsX64,
  arch: "aarch64",
  arm64: true,
  crossTarget: "aarch64-pc-windows-msvc",
} as Partial<Config>;

/** Everything the link command line gets from linkerFlags for this config (an entry without `when` always applies). */
const appliedLinkerFlags = (config: Config): string[] =>
  linkerFlags
    .filter(flag => !flag.when || flag.when(config))
    .flatMap(flag => (typeof flag.flag === "function" ? flag.flag(config) : flag.flag))
    .flat();

/** A build on Buildkite: of main or of a pull request, the order file comes from main either way. */
const ctx = (overrides: Partial<OrderFileContext> = {}): OrderFileContext => ({
  buildkite: true,
  buildUrl: "https://buildkite.com/bun/bun/builds/68425",
  mainBranch: "main",
  buildNumber: 68425,
  ...overrides,
});

describe("symbol ordering file", () => {
  it("is enabled for the linux release link", () => {
    expect(usesOrderFile(cfg())).toBe(true);
  });

  it("is enabled for the macOS arm64 release link, cross-compiled or not", () => {
    expect(usesOrderFile(cfg(darwinArm64))).toBe(true);
    // The darwin build lane cross-compiles from linux; ld64.lld takes
    // -order_file too, so it still links with an inherited one.
    expect(usesOrderFile(cfg({ ...darwinArm64, crossTarget: "arm64-apple-macosx" }))).toBe(true);
  });

  it("is enabled for both windows release links", () => {
    // Neither lane can trace what it links (see windowsX64); each inherits the
    // file its trace-order step traced on the matching test fleet.
    expect(usesOrderFile(cfg(windowsX64))).toBe(true);
    expect(usesOrderFile(cfg(windowsArm64))).toBe(true);
  });

  it("is disabled where it cannot work or is not wanted", () => {
    expect(usesOrderFile(cfg({ release: false }))).toBe(false); // debug: startup RSS is not what a debug build is for
    expect(usesOrderFile(cfg({ ...windowsX64, release: false }))).toBe(false);
    expect(usesOrderFile(cfg({ asan: true }))).toBe(false); // tracer swaps .text
    expect(usesOrderFile(cfg({ valgrind: true }))).toBe(false);
    // Both of these would otherwise attempt a trace that can never succeed and
    // annotate every build about it.
    expect(usesOrderFile(cfg({ abi: "musl" }))).toBe(false); // static: no LD_PRELOAD
    expect(usesOrderFile(cfg({ abi: "android" }))).toBe(false); // cross: cannot run the binary
    // darwin x64: the tracer is arm64-only, so nothing ever seeds the chain.
    expect(usesOrderFile(cfg({ ...darwinArm64, arm64: false }))).toBe(false);
    expect(usesOrderFile(cfg({ linux: false, freebsd: true, abi: undefined }))).toBe(false);
  });

  it("lives in the build directory, never the source tree", () => {
    // A committed order file rots silently. It is a build artifact.
    expect(orderFilePath(cfg())).toBe(join("/tmp/build", "linker.order"));
  });

  it("is passed to lld on the linux release link", () => {
    const config = cfg();
    const applied = appliedLinkerFlags(config);

    expect(applied).toContain(`-Wl,--symbol-ordering-file=${orderFilePath(config)}`);
    // Without this, a stale entry is a hard link error rather than a skipped symbol.
    expect(applied).toContain("-Wl,--no-warn-symbol-ordering");
    expect(applied.join(" ")).not.toContain("-order_file");
  });

  it("is passed to Apple ld on the macOS arm64 release link", () => {
    const config = cfg(darwinArm64);
    const applied = appliedLinkerFlags(config);

    expect(applied).toContain(`-Wl,-order_file,${orderFilePath(config)}`);
    expect(applied.join(" ")).not.toContain("--symbol-ordering-file");
  });

  it("is passed to lld-link on both windows release links, along with the maps that name its entries", () => {
    for (const config of [cfg(windowsX64), cfg(windowsArm64)]) {
      const applied = appliedLinkerFlags(config);

      expect(applied).toContain(`/order:@${slash(orderFilePath(config))}`);
      // LNK4037, once per name the inherited file has that this build no longer
      // does: the windows spelling of --no-warn-symbol-ordering above.
      expect(applied).toContain("/ignore:4037");
      // The PE has no symbol table, so these are what the trace-order step turns
      // addresses back into names with (windows-symbols.ts) — the listing for the
      // names, lld's own map for which of them start a function.
      expect(applied).toContain(`/map:${slash(symbolMapPath(config))}`);
      expect(applied).toContain(`/lldmap:${slash(linkerMapPath(config))}`);
      expect(applied.join(" ")).not.toMatch(/--symbol-ordering-file|-order_file/);
    }
  });

  it("is not passed on a debug or sanitizer link", () => {
    for (const config of [cfg({ release: false }), cfg({ asan: true }), cfg({ ...windowsX64, release: false })]) {
      const applied = appliedLinkerFlags(config).join(" ");
      expect(applied).not.toMatch(/--symbol-ordering-file|-order_file|\/order:/);
    }
  });

  it("is a link dependency, so a new one relinks", () => {
    // Inheriting one, or `bun run orderfile` writing one: the link is the only
    // edge whose input changed.
    for (const config of [cfg(), cfg(darwinArm64), cfg(windowsX64), cfg(windowsArm64)]) {
      expect(linkDepends(config)).toContain(orderFilePath(config));
    }
    expect(linkDepends(cfg({ release: false }))).not.toContain(orderFilePath(cfg({ release: false })));
    expect(linkDepends(cfg({ ...windowsX64, release: false }))).not.toContain(orderFilePath(cfg(windowsX64)));
  });
});

describe("linker maps", () => {
  it("are written exactly where linkerMapOutputs() says, which is what declares them to ninja and ships them", () => {
    // bun.ts declares the maps as the link's outputs and ci.ts packs them from
    // that list, while the flags that write them live in each platform's entry;
    // the trace-order step on windows reads them out of the profile zip, so the
    // two drifting apart there means silently unordered windows builds.
    const configs = {
      linux: cfg(),
      "linux asan": cfg({ asan: true }),
      "linux debug": cfg({ release: false }),
      "macOS arm64": cfg(darwinArm64),
      "windows x64": cfg(windowsX64),
      "windows arm64": cfg(windowsArm64),
      "windows debug": cfg({ ...windowsX64, release: false }),
    };
    const written = Object.fromEntries(
      Object.entries(configs).map(([name, config]) => {
        const flags = appliedLinkerFlags(config).join(" ");
        const maps = linkerMapOutputs(config);
        // Each declared map is named by some flag (as given, or slashed for
        // lld-link), and a config that declares none has no map flag at all.
        const everyMapWritten = maps.every(map => flags.includes(map) || flags.includes(slash(map)));
        const anyMapFlag = /bun-profile\.(linker-)?map\b/.test(flags);
        return [name, everyMapWritten && anyMapFlag === maps.length > 0];
      }),
    );
    expect(written).toEqual(Object.fromEntries(Object.keys(configs).map(name => [name, true])));

    const declared = Object.fromEntries(
      Object.entries(configs).map(([name, config]) => [
        name,
        linkerMapOutputs(config).map(map => map.split(/[\\/]/).at(-1)),
      ]),
    );
    expect(declared).toEqual({
      linux: ["bun-profile.linker-map"],
      "linux asan": [],
      "linux debug": [],
      "macOS arm64": ["bun-profile.linker-map"],
      "windows x64": ["bun-profile.linker-map", "bun-profile.map"],
      "windows arm64": ["bun-profile.linker-map", "bun-profile.map"],
      "windows debug": [],
    });
    expect(Object.entries(configs).map(([, config]) => writesLinkerMap(config))).toEqual(
      Object.entries(declared).map(([, maps]) => maps.length > 0),
    );
  });

  it("are named after the binary they describe, on both sides", () => {
    // The link writes them next to the binary (flags.ts); the generator, handed
    // only the binary, looks for the same names next to it.
    const exe = join("/tmp/build", "bun-profile.exe");
    expect([linkerMapFor(exe), symbolMapFor(exe)]).toEqual([
      linkerMapPath(cfg(windowsX64)),
      symbolMapPath(cfg(windowsX64)),
    ]);
  });
});

describe("deciding whether a build links with an inherited order file", () => {
  // No build traces its own binary: a target's trace-order step (.buildkite/ci.ts)
  // publishes the file after each main build, and every later build inherits it.
  it("every build does: release or canary, a pull request's too, whether or not the host can run the target", () => {
    expect(orderFileEligible(cfg(), ctx())).toBe(true);
    expect(orderFileEligible(cfg({ canary: false }), ctx())).toBe(true);
    expect(orderFileEligible(cfg({ canRunOnHost: false } as Partial<Config>), ctx())).toBe(true);
  });

  it("a build whose target has no order file never does", () => {
    expect(orderFileEligible(cfg({ abi: "musl" }), ctx())).toBe(false);
  });

  it("nothing happens off Buildkite", () => {
    expect(orderFileEligible(cfg(), ctx({ buildkite: false }))).toBe(false);
  });
});

describe("finding an earlier build to inherit from", () => {
  const pipeline = "https://buildkite.com/bun/bun";

  /** Walk back from build #1000 on main. `main` lists the branch's earlier builds; every other number is a PR's. */
  async function walk({
    main,
    newestPassed,
    from = {},
    // Buildkite repeats the request's query on the Location it answers with.
    location = (build: number) => `${pipeline}/builds/${build}?branch=main&state=passed`,
  }: {
    main: number[];
    newestPassed?: number;
    from?: Partial<OrderFileContext>;
    location?: (build: number) => string;
  }) {
    const requested: string[] = [];
    const lookups: BuildLookups = {
      async build(url) {
        requested.push(url);
        const number = Number(/\/builds\/(\d+)\.json$/.exec(url)?.[1]);
        // Anything else is not a build's JSON: Buildkite answers with the HTML page.
        if (Number.isNaN(number)) return undefined;
        return { id: `id-${number}`, number, branch_name: main.includes(number) ? "main" : "some-pr" };
      },
      redirect: async () => (newestPassed === undefined ? null : location(newestPassed)),
    };
    const found: (number | undefined)[] = [];
    const start = ctx({ buildUrl: `${pipeline}/builds/1000`, buildNumber: 1000, ...from });
    for await (const build of candidateBuilds(start, lookups)) found.push(build.number);
    return { found, requested };
  }

  it("tries the nearest builds first, whose file matches this link best", async () => {
    // #700 is further back than the probe reaches. #950 is not offered twice.
    expect((await walk({ main: [990, 950, 700], newestPassed: 950 })).found).toEqual([990, 950]);
  });

  it("falls back to the newest passed build when the branch was quiet for longer than the probe reaches", async () => {
    // Without this nothing is inherited, and the build ships unordered.
    const { found, requested } = await walk({ main: [640], newestPassed: 640 });
    expect(found).toEqual([640]);
    expect(requested.at(-1)).toBe(`${pipeline}/builds/640.json`);
  });

  it("still offers the newest passed build after a crowded window used up the probe's candidates", async () => {
    const crowded = Array.from({ length: 60 }, (_, i) => 999 - i);
    const { found } = await walk({ main: [...crowded, 640], newestPassed: 640 });
    expect(found).toEqual([...crowded.slice(0, 50), 640]);
  });

  it("asks only for the newest passed build when this build has no number to probe from", async () => {
    const { found, requested } = await walk({ main: [990], newestPassed: 640, from: { buildNumber: undefined } });
    expect({ found, requested }).toEqual({ found: [640], requested: [`${pipeline}/builds/640.json`] });
  });

  it("resolves a relative Location against the pipeline", async () => {
    const relative = (build: number) => `/bun/bun/builds/${build}?branch=main&state=passed`;
    const { found, requested } = await walk({ main: [], newestPassed: 640, location: relative });
    expect(found).toEqual([640]);
    expect(requested.at(-1)).toBe(`${pipeline}/builds/640.json`);
  });

  it("finds nothing when the branch has no passed build either", async () => {
    expect((await walk({ main: [] })).found).toEqual([]);
  });
});

const orderfile = join(import.meta.dir, "../../../../scripts/orderfile");
const darwin = process.platform === "darwin";
const supported = process.platform === "linux" || isWindows || (darwin && process.arch === "arm64");
// On windows specifically clang-cl, which is on the CI images: the fixtures
// below are linked by lld-link to get the maps the generator reads, the way the
// release link writes them. (The generator itself also accepts cl for building
// the tracer; it gets its maps from the build.)
const compiler = isWindows
  ? Bun.which("clang-cl")
  : process.env.CC || Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");
// Not musl: the real generator never runs there (bun-musl is statically linked,
// so LD_PRELOAD cannot load the tracer — see usesOrderFile), so compiling and
// running the tracer on a musl host exercises nothing the build uses.
const canTrace = supported && !isMusl && !!compiler;
/** The injected-library variable the tracer rides in on. */
const preloadVar = darwin ? "DYLD_INSERT_LIBRARIES" : "LD_PRELOAD";
const shared = darwin ? ["-dynamiclib", "-fPIC"] : ["-shared", "-fPIC"];
const STARTS_MAGIC = 0x4e55425354525453n;
const TRACE_MAGIC = 0x4e55424543415254n;

async function compile(args: string[]) {
  await using proc = Bun.spawn({ cmd: [compiler!, "-O1", ...args], env: bunEnv, stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
}

/**
 * clang-cl compile and lld-link of one source file into `out`, in `cwd` so the
 * .obj lands there; lld-link explicitly, as the generator does, since `link` on
 * PATH may well be coreutils'. `link` is extra linker options.
 */
async function compileMsvc(cwd: string, source: string, out: string, link: string[] = []) {
  // /Gy as in the real build: a chunk per function, which is what the generator
  // takes to be one (windows-symbols.ts) and what /order can move.
  await using proc = Bun.spawn({
    cmd: [compiler!, "/nologo", "/O1", "/Gy", "-fuse-ld=lld", source, `/Fe:${out}`, ...(link.length ? ["/link", ...link] : [])], // prettier-ignore
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`${compiler} exited ${exitCode}:\n${stdout}${stderr}`);
}

/** The linker options that write a binary's two maps where the generator looks for them (see windows-symbols.ts). */
const mapsFor = (exe: string): string[] => [`/map:${symbolMapFor(exe)}`, `/lldmap:${linkerMapFor(exe)}`];

/** The starts file, written by the generator's own writer. */
const writeStarts = (path: string, addresses: Iterable<number>) => writeStartsFile(path, [...addresses]);

/** The trace's header: magic, version, slide, start count, entry count. */
async function readTraceHeader(path: string) {
  const [magic, version, , , entries] = new BigUint64Array(await Bun.file(path).slice(0, 40).arrayBuffer());
  return { magic, version, entries: Number(entries) };
}

describe("order file generator", () => {
  it.skipIf(!supported)("refuses a build directory with no binary to trace", async () => {
    await expect(generateOrderFile({ buildDir: "/tmp/definitely-not-a-build-dir" })).rejects.toThrow(/not found/);
  });

  it.skipIf(supported)("refuses to run on an unsupported platform", async () => {
    // The tracers are x86-64 INT3 / arm64 BRK on linux and windows, arm64 BRK on macOS.
    await expect(generateOrderFile({ buildDir: "/tmp/build" })).rejects.toThrow(/linux|macOS|Windows/);
  });
});

/**
 * `--hints` lists come from a trace of some other build of bun, so most names
 * still match and the rest differ only in what a rebuild changes: the hash
 * Rust's mangling gives a crate, and the suffixes the optimizer gives a clone.
 */
describe("order file hints", () => {
  // Stands in for c++filt: what matters here is what happens to its output.
  const demangled: Record<string, string> = {
    _RNvCs1111_3foo3bar: "foo::bar",
    _RNvCs2222_3foo3bar: "foo::bar",
    _RNvCs2222_3foo3baz: "foo::baz",
  };
  const suffix = /(\.llvm\.\d+|\.cold)+$/;
  const demangle = (names: string[]) =>
    names.map(name => demangled[name.replace(suffix, "")] ?? name.replace(suffix, ""));

  it("keeps exact names, matches the rest by normalised name, and drops what is gone", () => {
    const current = [
      "main",
      "_RNvCs2222_3foo3bar",
      "_RNvCs2222_3foo3baz",
      "_ZN3JSC2VM6createEv.llvm.999",
      "_ZN3JSC2VM6createEv.cold",
      "unrelated",
    ];
    const hints = [
      "_ZN3JSC2VM6createEv.llvm.123", // same function, another build's clone suffix: both current clones
      "_RNvCs1111_3foo3bar", // same function, another build's crate hash
      "removed_since",
      "main",
      "main", // listed twice, emitted once
    ];
    expect(resolveHints(hints, current, demangle)).toEqual({
      names: ["_ZN3JSC2VM6createEv.llvm.999", "_ZN3JSC2VM6createEv.cold", "_RNvCs2222_3foo3bar", "main"],
      listed: 5,
      exact: 2,
      normalized: 2,
    });
  });

  it("runs the demangler only for a Rust name nothing else matched, and only over Rust names", () => {
    const demangler = jest.fn(demangle);
    const current = ["a", "_ZN3JSC2VM6createEv.llvm.999", "_RNvCs2222_3foo3bar"];
    // Still there, or there under another clone suffix: no demangler.
    expect(resolveHints(["a", "_ZN3JSC2VM6createEv.llvm.1"], current, demangler).names).toEqual([
      "a",
      "_ZN3JSC2VM6createEv.llvm.999",
    ]);
    expect(demangler).not.toHaveBeenCalled();
    // A C++ name that is gone has no hash to look past, so it is not worth a run either.
    expect(resolveHints(["_ZN3JSC2VM7destroyEv"], current, demangler).names).toEqual([]);
    expect(demangler).not.toHaveBeenCalled();

    expect(resolveHints(["_RNvCs1111_3foo3bar"], current, demangler).names).toEqual(["_RNvCs2222_3foo3bar"]);
    expect(demangler.mock.calls).toEqual([[["_RNvCs2222_3foo3bar", "_RNvCs1111_3foo3bar"]]]);
  });

  it("spells a list for the link it is given to, whichever platform it was traced on", () => {
    using dir = tempDir("orderfile-hint-format", {
      "elf.hints":
        "# format: elf\n_ZN3JSC2VM6createEv.cold\n_RNvCs1111_3foo3bar\nSSL_do_handshake\n_mi_heap_malloc_zero\n",
      "macho.hints": "# format: macho\n__ZN3JSC2VM6createEv\n_SSL_do_handshake\n_mi_heap_malloc_zero\nltmp0\n",
      "plain.hints": "# a list written by hand\nmain\n",
    });
    const read = (file: string, fallback?: "elf" | "macho") => readHintList(join(String(dir), file), fallback);
    expect(read("plain.hints", "macho")).toEqual({ names: ["main"], format: "macho" });
    expect(read("plain.hints", "elf").format).toBe("elf");

    // Mach-O puts one underscore before every name, so `_x` there is `x` here, and never ELF's own `_x`.
    const elf = ["_ZN3JSC2VM6createEv.llvm.7", "SSL_do_handshake", "mi_heap_malloc_zero", "_mi_heap_malloc_zero"];
    expect(resolveHints(hintNames(read("macho.hints"), "elf"), elf, demangle)).toEqual({
      names: ["_ZN3JSC2VM6createEv.llvm.7", "SSL_do_handshake", "mi_heap_malloc_zero"],
      listed: 4,
      exact: 2,
      normalized: 1,
    });
    const macho = ["__ZN3JSC2VM6createEv", "__RNvCs2222_3foo3bar", "_SSL_do_handshake", "_mi_heap_malloc_zero", "__mi_heap_malloc_zero"]; // prettier-ignore
    expect(resolveHints(hintNames(read("elf.hints"), "macho"), macho, demangle)).toEqual({
      names: ["__ZN3JSC2VM6createEv", "__RNvCs2222_3foo3bar", "_SSL_do_handshake", "__mi_heap_malloc_zero"],
      listed: 4,
      exact: 2,
      normalized: 2,
    });
    // A missing `_exit` is not `exit`.
    expect(resolveHints(["_exit"], ["exit"], demangle).names).toEqual([]);
  });

  // Whichever demangler the generator would find: their defaults differ (one prints
  // the crate hash, and they disagree about Mach-O's leading underscore).
  const cxxfilt = process.env.CXXFILT || Bun.which("llvm-cxxfilt") || Bun.which("c++filt");
  it.skipIf(!cxxfilt)("matches a Rust name across crate hashes with the installed demangler", () => {
    const current = ["_RNvCs7kMPyjk15S4_3foo3bar", "_RNvCs7kMPyjk15S4_3foo3baz"];
    const hints = ["_RNvCsaZ2QR4xGWmr_3foo3bar.llvm.42", "_RNvCsaZ2QR4xGWmr_3foo3baz", "_RNvCsaZ2QR4xGWmr_3foo4quux"];
    expect(resolveHints(hints, current)).toEqual({ names: current, listed: 3, exact: 0, normalized: 2 });
    const macho = current.map(name => `_${name}`);
    expect(resolveHints(hintNames({ names: hints, format: "elf" }, "macho"), macho).names).toEqual(macho);
  });

  describe("finding a demangler", () => {
    const names = ["_RNvCs7kMPyjk15S4_3foo3bar"];
    const warnings = () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      return () => warn.mock.calls.map(call => String(call[0]));
    };
    afterEach(() => jest.restoreAllMocks());

    it.skipIf(!cxxfilt)("passes over one that is not installed", () => {
      using dir = tempDir("orderfile-cxxfilt", {});
      const warned = warnings();
      expect(demangleRust(names, [join(String(dir), "not-installed"), cxxfilt!])).toEqual(["foo::bar"]);
      expect(warned()).toEqual([]);
    });

    it.skipIf(isWindows || !cxxfilt)("reports one that cannot run or fails, and goes on to the next", () => {
      using dir = tempDir("orderfile-cxxfilt", {
        "not-a-program": "\n",
        "broken": "#!/bin/sh\necho missing libLLVM >&2\nexit 127\n",
      });
      const [notAProgram, broken] = [join(String(dir), "not-a-program"), join(String(dir), "broken")];
      chmodSync(notAProgram, 0o644);
      chmodSync(broken, 0o755);
      const warned = warnings();
      expect(demangleRust(names, [notAProgram, broken, cxxfilt!])).toEqual(["foo::bar"]);
      expect(warned()).toEqual([
        expect.stringMatching(/not-a-program.*EACCES/),
        expect.stringMatching(/broken exited 127[^]*missing libLLVM/),
      ]);
    });

    it("says so when none works, since Rust names then only match by exact crate hash", () => {
      using dir = tempDir("orderfile-cxxfilt", {});
      const warned = warnings();
      expect(demangleRust(names, [join(String(dir), "not-installed")])).toEqual(names);
      expect(warned()).toEqual([expect.stringContaining("no working demangler")]);
    });
  });
});

/**
 * The app workloads are traced one feature per process, in the order
 * app/features.txt lists them. A feature missing from the list is never traced,
 * and a name the app does not know runs nothing; neither fails the trace.
 */
describe("app workloads", () => {
  const app = join(import.meta.dir, "../../../../scripts/orderfile/app");

  it("lists exactly the features the app has", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `(await import(${JSON.stringify(join(app, "features.js"))})).main()`],
      env: { ...bunEnv, ORDERFILE_FEATURES: "list" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const listed = readFeatures(join(app, "features.txt")).names;
    expect({ features: stdout.trim().split(/\r?\n/).sort(), stderr, exitCode }).toEqual({
      features: listed.toSorted(),
      stderr: "",
      exitCode: 0,
    });
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("requires one feature of each family", () => {
    const { names, required } = readFeatures(join(app, "features.txt"));
    expect(names.filter(name => name.startsWith("!"))).toEqual([]);
    expect(required.map(name => name.split("_")[0]).sort()).toEqual(["mix", "net", "net", "net", "net", "tui"]);
  });

  it("keeps the machine's proxy settings away from the app: direct stays direct, and its own proxy is used", async () => {
    // Stands in for both a proxy the machine has configured and the one the app names itself.
    await using proxy = Bun.serve({ port: 0, fetch: () => new Response("proxy") });
    await using origin = Bun.serve({ port: 0, fetch: () => new Response("origin") });
    const machine = `http://127.0.0.1:${proxy.port}`;
    const script = `
      const url = "http://127.0.0.1:${origin.port}/";
      const direct = await (await fetch(url)).text();
      const proxied = await (await fetch(url, { proxy: "${machine}" })).text();
      console.log(JSON.stringify({ direct, proxied }));`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, ALL_PROXY: machine, all_proxy: machine, NO_PROXY: "127.0.0.1", ...NO_PROXY_SETTINGS },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ direct: "origin", proxied: "proxy" }),
      stderr: "",
      exitCode: 0,
    });
  });

  it.each(["rsa", "ec"] as const)("serves TLS with a %s certificate its clients can pin", async kind => {
    const { cert, key } = selfSignedCertificate(kind);
    using server = Bun.serve({ port: 0, tls: { cert, key }, fetch: () => new Response("ok") });
    const pinned = await fetch(`https://localhost:${server.port}/`, { tls: { ca: cert } });
    expect(await pinned.text()).toBe("ok");
    const byAddress = await fetch(`https://127.0.0.1:${server.port}/`, { tls: { ca: cert } });
    expect(await byAddress.text()).toBe("ok");
    // Trusted only by whoever pins it.
    await expect(fetch(`https://localhost:${server.port}/`)).rejects.toMatchObject({
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
  });
});

/** Waits for a command to have written who it is (`<pid>,<pid of what it started>`) to `pids`, unless `command` ended first. */
async function started(pids: string, command: Promise<unknown>) {
  let ended = false;
  command.then(
    () => (ended = true),
    () => (ended = true),
  );
  const written = () => (existsSync(pids) ? /^(\d+),(\d+)\n$/.exec(readFileSync(pids, "utf8")) : null);
  while (!ended && !written()) await Bun.sleep(1);
  return written()!.slice(1).map(Number);
}

/** A process's state letter, or undefined if there is no such process. */
function processState(pid: number): string | undefined {
  if (process.platform === "linux") {
    try {
      return /\) (\S)/.exec(readFileSync(`/proc/${pid}/stat`, "utf8"))?.[1];
    } catch {
      return undefined;
    }
  }
  const ps = Bun.spawnSync({ cmd: ["ps", "-ww", "-o", "stat=", "-p", String(pid)], env: bunEnv });
  return ps.exitCode === 0 ? ps.stdout.toString().trim()[0] : undefined;
}

/** A process nobody reaps stays a zombie, which is as gone as it gets. */
async function expectGone(pids: number[]) {
  expect(processState(process.pid)).toBeDefined();
  const alive = () => pids.filter(pid => ![undefined, "Z"].includes(processState(pid)));
  for (const deadline = Date.now() + 3_000; alive().length && Date.now() < deadline; ) await Bun.sleep(5);
  expect(alive()).toEqual([]);
}

/**
 * A group is hundreds of small runs. One failing is worth a warning; a required
 * one failing, too many failing, or the group running out of time ends the
 * group at once, with what is still running killed, rather than after every
 * remaining run has had its own timeout.
 */
describe("workload groups", () => {
  const policy: GroupPolicy = { concurrency: 2, required: new Set(), maxFailures: 1, timeoutMs: 60_000 };
  const names = (count: number) => Array.from({ length: count }, (_, i) => `run ${i}`);
  /** A run that only ends when the group kills it. */
  const untilKilled = (signal: AbortSignal) =>
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("killed"))));

  it("tolerates a failure, and names it", async () => {
    const { results, failures } = await runGroup(
      "test",
      names(4),
      async i => {
        if (i === 2) throw new Error("run 2 broke");
        return i * 10;
      },
      policy,
    );
    expect({ results, failures }).toEqual({
      results: [0, 10, undefined, 30],
      failures: [{ name: "run 2", message: "run 2 broke" }],
    });
  });

  it("stops starting runs, and kills the running ones, once too many have failed", async () => {
    const started: number[] = [];
    const group = runGroup(
      "test",
      names(50),
      (i, signal) => {
        started.push(i);
        return i === 0 ? untilKilled(signal) : Promise.reject(new Error(`run ${i} broke`));
      },
      policy,
    );
    await expect(group).rejects.toThrow(/2 of the 50 test workloads failed \(run 1, run 2\); the first:\nrun 1 broke/);
    expect(started).toEqual([0, 1, 2]);
  });

  it("tries a required run twice, and fails the group when it fails twice", async () => {
    using _warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const attempts = [0, 0, 0];
    const run = async (i: number) => {
      if (++attempts[i]! <= i) throw new Error(`attempt ${attempts[i]} of run ${i} broke`);
      return i;
    };
    const required = { ...policy, concurrency: 1, required: new Set(["run 1", "run 2"]) };
    const passing = { ...required, required: new Set(["run 1"]) };
    expect(await runGroup("test", names(2), run, passing)).toEqual({ results: [0, 1], failures: [] });
    expect(attempts).toEqual([1, 2, 0]);
    await expect(runGroup("test", names(3), run, required)).rejects.toThrow(
      /run 2 failed twice[^]*attempt 2 of run 2 broke/,
    );
  });

  it("mentions a required run that only passed on its second try", async () => {
    using warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    let attempts = 0;
    const run = async () => {
      if (++attempts === 1) throw new Error("connection reset");
      return attempts;
    };
    const result = await runGroup("test", ["run 0"], run, { ...policy, required: new Set(["run 0"]) });
    expect(result).toEqual({ results: [2], failures: [] });
    expect(warn.mock.calls.map(call => String(call[0]))).toEqual([
      "warning: run 0 passed on its second try; the first:\nconnection reset",
    ]);
  });

  it("refuses a required run the group does not have", async () => {
    const group = runGroup("test", names(2), async i => i, { ...policy, required: new Set(["run 7"]) });
    await expect(group).rejects.toThrow("the test workloads require run 7, which they do not have");
  });

  it("gives up, with the running runs killed, when the whole group is out of time", async () => {
    let killed = 0;
    const group = runGroup(
      "test",
      names(10),
      (_, signal) =>
        untilKilled(signal).catch(error => {
          killed++;
          throw error;
        }),
      { ...policy, timeoutMs: 1 },
    );
    await expect(group).rejects.toThrow(/the test workloads did not finish in 0.001 s \(0 of 10 had\)/);
    expect(killed).toBe(2);
  });

  // Says who it and its descendant are, which holds the output pipes open and would run for a minute.
  const lingering = (pids: string) => ["/bin/sh", "-c", `sleep 60 & echo $$,$! > "$1"; wait`, "sh", pids];

  it.skipIf(isWindows)("stops a command, and what it started, when its signal aborts", async () => {
    using dir = tempDir("orderfile-stop", {});
    const controller = new AbortController();
    const command = runCommandAsync(lingering(join(String(dir), "pids")), {
      env: bunEnv,
      label: "lingering",
      signal: controller.signal,
    });
    const pids = await started(join(String(dir), "pids"), command);
    controller.abort();
    await expect(command).rejects.toThrow("lingering: stopped with the rest of its group");
    await expectGone(pids);
  });

  it.skipIf(isWindows)("stops a command whose signal had aborted before it started", async () => {
    using dir = tempDir("orderfile-stop", {});
    const command = runCommandAsync(lingering(join(String(dir), "pids")), { env: bunEnv, signal: AbortSignal.abort() });
    await expect(command).rejects.toThrow("stopped with the rest of its group");
  });

  it.skipIf(isWindows)("stops a command that runs out of time, and says that is why", async () => {
    using dir = tempDir("orderfile-stop", {});
    const command = runCommandAsync(lingering(join(String(dir), "pids")), { env: bunEnv, timeout: 1 });
    await expect(command).rejects.toThrow("timed out after 0.001 s");
  });

  it.skipIf(isWindows)("goes by how a command ended, not by whether it was being stopped", async () => {
    using dir = tempDir("orderfile-stop", {});
    const pids = join(String(dir), "pids");
    const controller = new AbortController();
    // Finishes its work (exit 0) when told to stop.
    const command = runCommandAsync(
      ["/bin/sh", "-c", `trap 'exit 0' TERM; echo $$,$$ > "$1"; while :; do sleep 1; done`, "sh", pids],
      { env: bunEnv, signal: controller.signal },
    );
    await started(pids, command);
    controller.abort();
    expect((await command).status).toBe(0);
  });

  it("ends a group when what it was given to be interrupted by aborts", async () => {
    const interrupted = new AbortController();
    const started: number[] = [];
    const group = runGroup(
      "test",
      names(10),
      (i, signal) => {
        started.push(i);
        return untilKilled(signal);
      },
      { ...policy, required: new Set(["run 0"]), interrupted: interrupted.signal },
    );
    interrupted.abort(new Error("interrupted by SIGTERM"));
    await expect(group).rejects.toThrow("interrupted by SIGTERM");
    // The two that were running, and no second try of the required one.
    expect(started).toEqual([0, 1]);
  });

  /**
   * A generator in miniature: withScratch around one command that says who it is, then a checkpoint, then the
   * output. `shell` is the command ($1 is where it says who it is, $2 appears when it may finish), `command` how
   * the generator runs it.
   */
  async function interruptGenerator(shell: string, command: string, whenStarted: (go: string) => void) {
    using dir = tempDir("orderfile-interrupt", {});
    const [pids, go, out, scratchPath] = ["pids", "go", "out", "scratch-path"].map(name => join(String(dir), name));
    const generate = join(import.meta.dir, "../../../../scripts/orderfile/generate.ts");
    const script = `
      import { spawnSync } from "node:child_process";
      import { writeFileSync } from "node:fs";
      import { checkpoint, runCommandAsync, withScratch } from ${JSON.stringify(generate)};
      const command = ["/bin/sh", "-c", ${JSON.stringify(shell)}, "sh", ${JSON.stringify(pids)}, ${JSON.stringify(go)}];
      const made = [];
      const record = scratch => {
        made.push(scratch);
        writeFileSync(${JSON.stringify(scratchPath)}, made.join("\\n"));
      };
      await withScratch("orderfile-interrupt-", async (scratch, interrupted) => {
        record(scratch);
        ${command};
        await checkpoint(interrupted);
        writeFileSync(${JSON.stringify(out)}, "written");
      });`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, TMPDIR: String(dir) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const running = await started(pids, proc.exited);
    const scratch = () => readFileSync(scratchPath, "utf8").split("\n").filter(existsSync);
    expect(scratch()).not.toEqual([]);
    proc.kill("SIGTERM");
    whenStarted(go);
    await proc.exited;
    expect({ signalCode: proc.signalCode, scratch: scratch(), written: existsSync(out) }).toEqual({
      signalCode: "SIGTERM",
      scratch: [],
      written: false,
    });
    return running;
  }

  it.skipIf(isWindows)(
    "a signal stops what is running, removes the scratch directory, and then ends the generator",
    async () => {
      // The command never finishes by itself: the signal has to stop it.
      const running = await interruptGenerator(
        `sleep 60 & echo $$,$! > "$1"; wait`,
        `await runCommandAsync(command, { signal: interrupted })`,
        () => {},
      );
      await expectGone(running);
    },
  );

  // Which signals it was started ignoring, a process asks sigaction() about itself through bun:ffi, and
  // where it cannot (musl, node) linux reads /proc. With glibc both answer, and they have to agree.
  it.skipIf(process.platform !== "linux" || isMusl).each([
    { started: "ignoring SIGHUP and SIGINT", trap: `trap "" HUP INT; `, ignored: [1, 2] },
    { started: "ignoring nothing", trap: "", ignored: [] },
  ])("sigaction through bun:ffi agrees with /proc about a process started $started", async ({ trap, ignored }) => {
    const generate = join(import.meta.dir, "../../../../scripts/orderfile/generate.ts");
    const script = `
      import { readFileSync } from "node:fs";
      import { sigactionIgnored } from ${JSON.stringify(generate)};
      const asked = await sigactionIgnored([1, 2, 15]);
      const mask = parseInt(/^SigIgn:\\s*([0-9a-f]+)$/m.exec(readFileSync("/proc/self/status", "utf8"))[1].slice(-8), 16);
      console.log(JSON.stringify({ sigaction: asked && [...asked], proc: [1, 2, 15].filter(n => (mask >>> (n - 1)) & 1) }));`;
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `${trap}exec "$0" -e "$1"`, bunExe(), script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ sigaction: ignored, proc: ignored }),
      stderr: "",
      exitCode: 0,
    });
  });

  it.skipIf(isWindows)("a signal the generator was started ignoring, as under nohup, stays ignored", async () => {
    using dir = tempDir("orderfile-nohup", {});
    const [pids, go, out] = ["pids", "go", "out"].map(name => join(String(dir), name));
    const generate = join(import.meta.dir, "../../../../scripts/orderfile/generate.ts");
    const script = `
      import { writeFileSync } from "node:fs";
      import { checkpoint, runCommandAsync, withScratch } from ${JSON.stringify(generate)};
      const command = ["/bin/sh", "-c", 'echo $$,$$ > "$1"; until [ -e "$2" ]; do sleep 0.01; done', "sh", ${JSON.stringify(pids)}, ${JSON.stringify(go)}];
      await withScratch("orderfile-nohup-", async (scratch, interrupted) => {
        await runCommandAsync(command, { signal: interrupted });
        await checkpoint(interrupted);
        writeFileSync(${JSON.stringify(out)}, "written");
      });`;
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `trap "" HUP; exec "$0" -e "$1"`, bunExe(), script],
      env: { ...bunEnv, TMPDIR: String(dir) },
      stdout: "pipe",
      stderr: "pipe",
    });
    await started(pids, proc.exited);
    proc.kill("SIGHUP");
    writeFileSync(go, "");
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode, signalCode: proc.signalCode, written: existsSync(out) }).toEqual({
      stderr: "",
      exitCode: 0,
      signalCode: null,
      written: true,
    });
  });

  it.skipIf(isWindows)(
    "a signal inside a nested scratch directory removes both before the generator ends",
    async () => {
      const nested = `await withScratch("orderfile-interrupt-inner-", async (inner, innerInterrupted) => {
      record(inner);
      await runCommandAsync(command, { signal: innerInterrupted });
    })`;
      const running = await interruptGenerator(`sleep 60 & echo $$,$! > "$1"; wait`, nested, () => {});
      await expectGone(running);
    },
  );

  it.skipIf(isWindows)(
    "a signal that arrives during a synchronous command ends the generator after it, with nothing written",
    async () => {
      // The signal cannot be handled while spawnSync has the thread; the command is let finish afterwards.
      await interruptGenerator(
        `echo $$,$$ > "$1"; until [ -e "$2" ]; do sleep 0.01; done`,
        `spawnSync(command[0], command.slice(1))`,
        go => writeFileSync(go, ""),
      );
    },
  );

  it.skipIf(isWindows)("a signal that arrives during a synchronous command that then fails still ends it", async () => {
    // No checkpoint is reached: withScratch itself has to give the signal its turn before letting go of it.
    await interruptGenerator(
      `echo $$,$$ > "$1"; until [ -e "$2" ]; do sleep 0.01; done`,
      `spawnSync(command[0], command.slice(1)); throw new Error("the step failed")`,
      go => writeFileSync(go, ""),
    );
  });
});

/**
 * On windows the generator gets its functions from the two maps the link writes
 * (the PE has no symbol table): the names from lld-link's symbol listing, which
 * have to be the linker's exact spellings or /order matches nothing, and which
 * of them are functions from lld's own map of chunks. See windows-symbols.ts.
 */
describe("windows symbol maps", () => {
  // Shape of a real listing: one output section can have several rows, names
  // can overflow their column, folded functions share an address, section 0000
  // holds absolute symbols that have addresses too, and the statics come after
  // the publics.
  const symbolMap = [
    " bun-profile",
    "",
    " Preferred load address is 0000000140000000",
    "",
    " Start         Length     Name                   Class",
    " 0001:00000000 0000019fH .text                   CODE",
    " 0001:000001a0 0001604aH .text$mn                CODE",
    " 0002:00000000 00005bf0H .rdata                  DATA",
    " 0003:00000000 00000a81H .data                   DATA",
    "",
    "  Address         Publics by Value              Rva+Base               Lib:Object",
    "",
    " 0000:00000000       __guard_fids_table         0000000000000000     <absolute>",
    " 0001:00000000       main                       0000000140001000     bun.obj",
    " 0001:00000080       ?run@Server@bun@@QEAAXAEBV?$Vector@PEAXV?$Allocator@PEAX@bun@@@2@@Z 0000000140001080     bun.obj",
    " 0001:00000200       memset                     0000000140001200     libvcruntime:memset.obj",
    " 0002:00000010       ??_C@_02DKCKIIND@?$CFs?$AA@ 0000000140002010     bun.obj",
    " 0003:00000000       sink                       0000000140003000     bun.obj",
    "",
    " entry point at         0001:00000000",
    "",
    " Static symbols",
    "",
    " 0000:00000000       __guard_fids__             0000000140000000     libcmt:exe_main.obj",
    " 0001:00000074       $LN12                      0000000140001074     bun.obj",
    " 0001:00000078       $LN13                      0000000140001078     bun.obj",
    " 0001:000001a0       _ZN3bun4mainE              00000001400011a0     libbun_rust.lib(bun.o)",
    " 0001:000001a0       _ZN3bun4sameE.llvm.123     00000001400011a0     libbun_rust.lib(bun.o)",
    " 0001:00000200       .bf                        0000000140001200     libvcruntime:memset.obj",
    " 0001:00000240       Table                      0000000140001240     libvcruntime:memset.obj",
    " 0002:00000020       anInitializer              0000000140002020     bun.obj",
    "",
  ].join("\n");

  // Shape of lld's map: output sections, the chunks placed in each (one per
  // function where there are function sections; memset.obj's whole .text is
  // one), empty chunks, and under each chunk its symbols, demangled — including
  // one whose demangled name happens to contain the chunk marker.
  const linkerMap = [
    "Address  Size     Align Out     In      Symbol",
    "00001000 00000280  4096 .text",
    "00001000 00000000     4         bun.obj:(.text)",
    "00001000 0000007c    16         bun.obj:(.text$mn)",
    "00001000 00000000     0                 int __cdecl main(int, char **)",
    "00001074 00000000     0                 $LN12",
    "00001080 00000010    16         bun.obj:(.text$mn)",
    "00001080 00000000     0                 public: void __cdecl bun::Server::run(class bun::Vector<void *, class bun::Allocator<void *>> const &)",
    "000011a0 00000040    16         libbun_rust.lib(bun.o):(.text)",
    "000011a0 00000000     0                 bun::(anonymous namespace)::main",
    "000011c0 00000000     0                 bun::(anonymous namespace)::helper",
    "00001200 00000080    16         libvcruntime.lib(memset.obj):(.text)",
    "00001200 00000000     0                 memset",
    "00001240 00000000     0                 Table",
    "00002000 00000030  4096 .rdata",
    "00002010 00000003     1         bun.obj:(.rdata)",
    '00002010 00000000     0                 "%s"',
    "",
  ].join("\n");

  it("lists every name in the code sections of the symbol listing, and the image base", () => {
    expect(parseSymbolMap(symbolMap)).toEqual({
      imageBase: 0x140000000,
      symbols: [
        [0x140001000, "main"],
        [0x140001080, "?run@Server@bun@@QEAAXAEBV?$Vector@PEAXV?$Allocator@PEAX@bun@@@2@@Z"],
        [0x140001200, "memset"],
        [0x140001074, "$LN12"],
        [0x140001078, "$LN13"],
        [0x1400011a0, "_ZN3bun4mainE"],
        [0x1400011a0, "_ZN3bun4sameE.llvm.123"],
        [0x140001200, ".bf"],
        [0x140001240, "Table"],
      ],
    });
    expect(() => parseSymbolMap("not a map\n")).toThrow(/image base/);
  });

  it("takes the chunks, and only the chunks, from lld's map", () => {
    // Not the output sections, and not the symbols, whatever their names look like.
    expect([...parseChunkStarts(linkerMap)].sort((a, b) => a - b)).toEqual([0x1000, 0x1080, 0x11a0, 0x1200, 0x2010]);
  });

  it("keeps the names that start a chunk, which is what drops the labels on the tables inside functions", () => {
    using dir = tempDir("windows-symbols", {
      "traced.map": symbolMap,
      "traced.linker-map": linkerMap,
      "unmapped.exe": "",
    });

    // main's jump table slots ($LN12, $LN13) and memset's byte table are gone;
    // memset's own second name at its start is as welcome as any other alias.
    expect(readTextSymbols(join(String(dir), "traced.exe"))).toEqual(
      new Map([
        [0x140001000, ["main"]],
        [0x140001080, ["?run@Server@bun@@QEAAXAEBV?$Vector@PEAXV?$Allocator@PEAX@bun@@@2@@Z"]],
        [0x140001200, ["memset", ".bf"]],
        [0x1400011a0, ["_ZN3bun4mainE", "_ZN3bun4sameE.llvm.123"]],
      ]),
    );
    expect(() => readTextSymbols(join(String(dir), "unmapped.exe"))).toThrow(/unmapped\.map not found/);
  });
});

/**
 * CI builds with `node --experimental-strip-types scripts/build.ts`, so the
 * workloads are spawned by node's spawnSync, not bun's. Node only delivers
 * `input` when stdin is a pipe, and silently drops it when stdin is "ignore";
 * bun delivers it either way, so nothing a developer runs locally notices. The
 * interactive workloads are the only ones typed anything, and the ~2k tty and
 * readline functions they exist to trace are unreachable without it.
 */
describe.skipIf(process.platform !== "linux" || !nodeExe())("interactive workload stdin", () => {
  it("reaches the workload when the generator runs under node, as CI does", async () => {
    await using proc = Bun.spawn({
      cmd: [
        nodeExe()!,
        "--experimental-strip-types",
        join(import.meta.dir, "orderfile-workload-fixture.ts"),
        bunExe(),
        join(import.meta.dir, "../../../../scripts/orderfile/cli-fixture.js"),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // node warns about the fixture's module type on every run, so stderr is never
    // empty; an uncaught error is the part worth reading. It is also how this
    // notices generate.ts growing TypeScript that node cannot strip, which would
    // break the real build the same way.
    const crash = /^\w*Error\b.*/m.exec(stderr)?.[0] ?? null;

    // cli-fixture.js answers `name?` with the first line it is typed and counts
    // the rest, so "read 0 lines" is what an empty stdin looks like. On a
    // terminal it is worse: readline waits for a line that never arrives, and
    // the workload times out instead of returning at all.
    expect({
      greeted: stdout.includes("hi world"),
      read: /read (\d+) lines/.exec(stdout)?.[1],
      crash,
      exitCode,
    }).toEqual({ greeted: true, read: "3", crash: null, exitCode: 0 });
  });
});

/**
 * One of the traced workloads runs on a pseudo-terminal, because bun's stdio,
 * tty and readline code take a path there that a pipe never reaches, and an
 * order file that missed it would leave all of that scattered. `ptyrun.c` is
 * what provides the terminal (on windows, the tracer itself does — see below).
 */
describe.skipIf(!canTrace || isWindows)("pty runner", () => {
  /** Reports what the process sees on its stdio, plus the one line it was typed. */
  const probe = [
    `process.stdin.once("data", data => {`,
    `  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);`,
    `  const fields = [tty, process.stdout.columns ?? 0, process.env.${preloadVar} ?? "none", data.toString().trim()];`,
    `  process.stdout.write(fields.join(" ") + "\\n");`,
    `  process.stdin.pause();`,
    `});`,
  ].join("\n");

  async function type(cmd: string[], env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd,
      env: { ...bunEnv, ...env },
      stdin: new Blob(["hi\n"]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A terminal echoes back what it was typed and turns \n into \r\n, so the
    // probe's own line is the last one. macOS also echoes the end-of-input ^D
    // as the two characters ^D followed by two backspaces (ECHOCTL); strip
    // control characters so that doesn't ride on the front of the line.
    const lines = stdout
      .replace(/[\x00-\x1f]+/g, "\n")
      .trim()
      .split("\n");
    return { line: lines.at(-1), stderr, exitCode };
  }

  /**
   * A workload that leaves something behind in a session of its own, which keeps the terminal open (a
   * daemon, a detached helper), says `pid=` of it, and then exits 7 once a line is typed, stays up ("stay"),
   * or never stops writing ("chatty").
   */
  const leavesSource = [
    "#include <stdio.h>",
    "#include <string.h>",
    "#include <unistd.h>",
    "int main(int argc, char **argv) {",
    "    int in_its_own_session[2];",
    "    if (pipe(in_its_own_session) != 0) return 2;",
    "    pid_t left = fork();",
    "    if (left == 0) {",
    "        setsid();",
    "        close(in_its_own_session[0]);",
    "        close(in_its_own_session[1]);",
    "        for (;;) pause();",
    "    }",
    // Not before it has left: a session leader's exit hangs up on everything still in the session.
    "    char byte;",
    "    close(in_its_own_session[1]);",
    "    if (read(in_its_own_session[0], &byte, 1) != 0) return 2;",
    '    printf("pid=%d\\n", (int)left);',
    "    fflush(stdout);",
    '    if (argc > 1 && strcmp(argv[1], "stay") == 0) for (;;) pause();',
    '    if (argc > 1 && strcmp(argv[1], "chatty") == 0) for (;;) puts("y");',
    // Until the line has been read (a newline is typed back): a terminal may drop what its leader's exit finds unread.
    "    getchar();",
    "    return 7;",
    "}",
    "",
  ].join("\n");

  // ptyrun, a preload and the workload above, built once for every test here. Made by the first test that
  // asks: a skipped describe still runs its body, and none of its hooks.
  let binaries: ReturnType<typeof tempDir> | undefined;
  afterAll(() => binaries?.[Symbol.dispose]());
  let built: Promise<{ ptyrun: string; preload: string; leaves: string }> | undefined;
  const build = () =>
    (built ??= (async () => {
      binaries = tempDir("ptyrun", { "empty.c": "int ptyrun_nothing;\n", "leaves.c": leavesSource });
      const dir = String(binaries);
      const [ptyrun, leaves] = [join(dir, "ptyrun"), join(dir, "leaves")];
      // Somewhere for the preload to point that is real but does nothing. In a
      // trace this is the function tracer, which has to load into the traced
      // binary and not into ptyrun.
      const preload = join(dir, darwin ? "empty.dylib" : "empty.so");
      await Promise.all([
        compile(["-o", ptyrun, join(orderfile, "ptyrun.c"), ...(darwin ? [] : ["-lutil"])]),
        compile([...shared, "-o", preload, join(dir, "empty.c")]),
        compile(["-o", leaves, join(dir, "leaves.c")]),
      ]);
      return { ptyrun, preload, leaves };
    })());

  /**
   * The `pid=` a command printed. Its output goes on being read, to the end (`rest`): a reader that went
   * away is an EPIPE for whatever ptyrun writes next.
   */
  async function readPid(proc: Bun.Subprocess<"pipe", "pipe", "pipe">) {
    let output = "";
    let ended = false;
    const rest = (async () => {
      for await (const chunk of proc.stdout) output += Buffer.from(chunk).toString();
      ended = true;
    })();
    while (!ended && !/pid=\d+\s/.test(output)) await Bun.sleep(1);
    const pid = /pid=(\d+)/.exec(output)?.[1];
    if (!pid) throw new Error(`the command ended without saying pid=: ${JSON.stringify(output)}`);
    return { pid: Number(pid), rest };
  }

  it.concurrent("runs the child on a terminal, and hands it the preload it was given", async () => {
    const { ptyrun, preload } = await build();

    const [pty, pipe] = await Promise.all([
      type([ptyrun, bunExe(), "-e", probe], { PTYRUN_PRELOAD: preload }),
      type([bunExe(), "-e", probe], {}),
    ]);

    expect({ pty: pty.line, pipe: pipe.line, ptyExit: pty.exitCode, pipeExit: pipe.exitCode }).toEqual({
      pty: `true 80 ${preload} hi`,
      pipe: "false 0 none hi",
      ptyExit: 0,
      pipeExit: 0,
    });
  });

  it.concurrent("takes the terminal's processes with it when it is told to stop", async () => {
    const { ptyrun } = await build();

    // Ignores the hangup that the terminal going away sends, so only being killed ends it.
    await using proc = Bun.spawn({
      cmd: [ptyrun, "/bin/sh", "-c", "trap '' HUP; echo pid=$$; while :; do sleep 1; done"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const { pid: shell, rest } = await readPid(proc);
    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(1);
    await rest;
    await expectGone([shell]);
  });

  it.concurrent("forwards all of the output to a reader that is slow to start", async () => {
    const { ptyrun } = await build();
    using dir = tempDir("ptyrun-slow-reader", {});

    // A little more than a pipe holds: ptyrun is blocked writing the last of it when its child, which
    // has nothing left to wait for, exits. The reader starts once that has happened (or, where the
    // terminal and the pipe hold less than they do on linux, after twenty tries).
    const written = join(String(dir), "written");
    const writer = `head -c 70000 /dev/zero | tr '\\0' x; : > "${written}"`;
    // Only what the writer wrote is counted. A terminal echoes what it is typed, and how differs:
    // macOS echoes an end of input as ^D and two backspaces. ptyrun's stdin stays open here, so none is typed.
    const reader = `n=0; until [ -e "${written}" ] || [ $n -ge 20 ]; do sleep 0.05; n=$((n + 1)); done; tr -cd x | wc -c`;
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `"$0" /bin/sh -c "$1" | (${reader})`, ptyrun, writer],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ bytes: Number(stdout.trim()), stderr, exitCode }).toEqual({ bytes: 70000, stderr: "", exitCode: 0 });
  });

  /**
   * ptyrun is done when its child is, and when it is told to stop, whoever still holds the terminal. On linux
   * it adopts what the child left behind and ends it; elsewhere that is left running, and cleaned up here.
   */
  describe("with a descendant that left the session and holds the terminal", () => {
    async function leftBehind<T>(left: number, check: () => Promise<T>) {
      try {
        const result = await check();
        if (process.platform === "linux") await expectGone([left]);
        return result;
      } finally {
        try {
          process.kill(left, "SIGKILL");
        } catch {}
      }
    }

    async function run(mode: string[], whenStarted: (proc: Bun.Subprocess<"pipe", "pipe", "pipe">) => void) {
      const { ptyrun, leaves } = await build();
      await using proc = Bun.spawn({ cmd: [ptyrun, leaves, ...mode], env: bunEnv, stdin: "pipe", stdout: "pipe", stderr: "pipe" }); // prettier-ignore
      const { pid: left, rest } = await readPid(proc);
      // Awaited here: leaving this scope stops `proc`.
      return await leftBehind(left, async () => {
        whenStarted(proc);
        const exitCode = await proc.exited;
        await rest;
        return { exitCode, signalCode: proc.signalCode };
      });
    }

    it.concurrent("returns when its child exits, with the child's status", async () => {
      const exited = await run([], proc => {
        proc.stdin.write("\n");
        proc.stdin.flush();
      });
      expect(exited).toEqual({ exitCode: 7, signalCode: null });
    });

    it.concurrent("returns when it is told to stop", async () => {
      expect(await run(["stay"], proc => proc.kill("SIGTERM"))).toEqual({ exitCode: 1, signalCode: null });
    });

    it.concurrent("is not ended by the alarm it sets for itself before it has cleaned up", async () => {
      const stopped = await run(["stay"], proc => {
        proc.kill("SIGALRM");
        proc.kill("SIGTERM");
      });
      expect(stopped).toEqual({ exitCode: 1, signalCode: null });
    });

    it.concurrent("leaves the same way when its reader goes away, instead of dying of SIGPIPE", async () => {
      const { ptyrun, leaves } = await build();
      using dir = tempDir("ptyrun-epipe", {});
      const status = join(String(dir), "status");
      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", `("$0" "$1" chatty < /dev/null; echo $? > "$2") | head -1`, ptyrun, leaves, status],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await proc.stdout.text();
      const left = /pid=(\d+)/.exec(stdout)?.[1];
      if (!left) throw new Error(`the workload ended without saying pid=: ${JSON.stringify(stdout)}`);
      await leftBehind(Number(left), async () => {
        await proc.exited;
        expect(readFileSync(status, "utf8").trim()).toBe("1");
      });
    });
  });
});

/**
 * What a trace of functrace-fixture.c must say, whichever tracer wrote it: the
 * fixture calls f0..f31 in that order, runs a child, then calls `after`, and
 * every one of those is a first entry. A trace a child process truncated or
 * re-armed over has a handful of entries and is missing the early ones, which
 * in a real trace are the hottest.
 */
async function expectFixtureTrace(trace: string, symbols: Map<number, string[]>) {
  const raw = await Bun.file(trace).arrayBuffer();
  const words = new BigUint64Array(raw);
  // Layout: u64 magic, version, slide, start count, entry count, then the entries.
  expect({ magic: words[0], version: words[1] }).toEqual({ magic: TRACE_MAGIC, version: 1n });
  const entries = Array.from(words.subarray(5, 5 + Number(words[4])), address => Number(address));

  // Each entry resolves to the names at that address, the way generate.ts
  // resolves them; macOS nm spells C functions with a leading underscore.
  const names = entries.flatMap(address => symbols.get(address) ?? [`unresolved ${address.toString(16)}`]);
  const plain = names.map(name => (darwin ? name.replace(/^_/, "") : name));
  const touched = plain.filter(name => /^f\d+$/.test(name));

  expect(touched).toEqual(Array.from({ length: 32 }, (_, i) => `f${i}`));
  expect(plain).toContain("main");
  expect(plain).toContain("after");
  expect(plain.indexOf("after")).toBeGreaterThan(plain.indexOf("f31"));
  expect(new Set(entries).size).toBe(entries.length);
}

/**
 * The tracer loads into the binary under trace and nowhere else. Every workload
 * that execs something — `bun install` runs lifecycle scripts, the cli workload
 * shells out — hands the preload to the child, and a child that created and
 * truncated the trace file would wipe the entries recorded so far.
 */
describe.skipIf(!canTrace || isWindows)("function tracer", () => {
  it.concurrent("records exact entries, and keeps them across an exec'd child", async () => {
    using dir = tempDir("functrace", { "child.c": "int main(void) { return 0; }\n" });
    const root = String(dir);
    const tracer = join(root, darwin ? "functrace.dylib" : "functrace.so");
    const fixture = join(root, "fixture");
    const child = join(root, "child");
    const starts = join(root, "starts.bin");
    const trace = join(root, "trace.bin");

    await Promise.all([
      compile([...shared, "-o", tracer, join(orderfile, "functrace.c"), ...(darwin ? [] : ["-ldl", "-lpthread"])]),
      compile(["-o", fixture, join(import.meta.dir, "functrace-fixture.c")]),
      compile(["-o", child, join(root, "child.c")]),
    ]);

    // The starts file the generator would write, from the same symbol reader.
    const symbols = readTextSymbols(fixture);
    expect(symbols.size).toBeGreaterThan(33);
    writeStarts(starts, symbols.keys());

    // The child is dynamically linked, so it inherits the preload.
    await using proc = Bun.spawn({
      cmd: [fixture, child],
      env: { ...bunEnv, [preloadVar]: tracer, BUN_FUNCTRACE_STARTS: starts, BUN_FUNCTRACE_OUT: trace },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "497", stderr: "", exitCode: 0 });

    await expectFixtureTrace(trace, symbols);
  });
});

/**
 * An application that re-executes itself does its work in a child, which the
 * tracer normally stays out of. BUN_FUNCTRACE_CHILDREN=1 follows it there, with
 * a trace per process (`%p`), and only into the same executable: the starts
 * mean nothing in any other.
 */
describe.skipIf(!canTrace || isWindows)("function tracer, following children", () => {
  const source = [
    "#include <stdio.h>",
    "#include <string.h>",
    "#include <sys/wait.h>",
    "#include <unistd.h>",
    "__attribute__((noinline)) static int parent_only(int x) { return x + 1; }",
    "__attribute__((noinline)) static int child_only(int x) { return x + 2; }",
    // Out of line whatever the compiler: it is what the parent enters and the re-executed child does not.
    "__attribute__((noinline)) static int run(const char *program, const char *arg) {",
    "    pid_t child = fork();",
    "    if (child == 0) { execl(program, program, arg, (char *)NULL); _exit(127); }",
    "    int status = 0;",
    "    return waitpid(child, &status, 0) == child ? status : -1;",
    "}",
    "int main(int argc, char **argv) {",
    '    if (argc > 1 && strcmp(argv[1], "leaf") == 0) { printf("%d\\n", child_only(argc)); return 0; }',
    // Replaces itself without forking: the same process id, a second traced image.
    '    if (argc > 1 && strcmp(argv[1], "again") == 0) {',
    '        printf("%d\\n", parent_only(argc)); fflush(stdout);',
    '        execl(argv[0], argv[0], "leaf", (char *)NULL); return 5;',
    "    }",
    // argv[1] is some other program: it inherits the tracer's environment too.
    '    if (run(argv[1], "x") != 0 || run(argv[0], "leaf") != 0) return 4;',
    '    printf("%d\\n", parent_only(argc));',
    "    return 0;",
    "}",
    "",
  ].join("\n");

  // The tracer and the programs, built once for every test here. Made by the first test that asks: a skipped
  // describe still runs its body, and none of its hooks.
  const sources = {
    "self.c": source,
    "other.c": "int main(void) { return 0; }\n",
    // What stands between a shell and an application often enough: env, nice, time, sh -c.
    "wrapper.c":
      "#include <unistd.h>\nint main(int argc, char **argv) { return argc < 2 ? 2 : execv(argv[1], argv + 1); }\n",
    // An application that says who it is and then stays up.
    "stay.c": [
      "#include <stdio.h>",
      "#include <unistd.h>",
      "int main(int argc, char **argv) {",
      '    FILE *f = fopen(argv[1], "w");',
      '    fprintf(f, "%d,%d\\n", (int)getpid(), (int)getpid());',
      "    fclose(f);",
      "    for (;;) pause();",
      "}",
      "",
    ].join("\n"),
  };
  let binaries: ReturnType<typeof tempDir> | undefined;
  afterAll(() => binaries?.[Symbol.dispose]());
  let built:
    | Promise<{
        dir: string;
        tracer: string;
        self: string;
        other: string;
        wrapper: string;
        stay: string;
        starts: string;
      }>
    | undefined;
  const build = () =>
    (built ??= (async () => {
      binaries = tempDir("functrace-children", sources);
      const dir = String(binaries);
      const tracer = join(dir, darwin ? "functrace.dylib" : "functrace.so");
      const self = join(dir, "self");
      const other = join(dir, "other");
      const wrapper = join(dir, "wrapper");
      const stay = join(dir, "stay");
      const starts = join(dir, "starts.bin");
      await Promise.all([
        compile([...shared, "-o", tracer, join(orderfile, "functrace.c"), ...(darwin ? [] : ["-ldl", "-lpthread"])]),
        compile(["-o", self, join(dir, "self.c")]),
        compile(["-o", other, join(dir, "other.c")]),
        compile(["-o", wrapper, join(dir, "wrapper.c")]),
        compile(["-o", stay, join(dir, "stay.c")]),
      ]);
      writeStarts(starts, readTextSymbols(self).keys());
      return { dir, tracer, self, other, wrapper, stay, starts };
    })());

  /** The environment that asks for children to be followed. */
  const following = async () => ({ BUN_FUNCTRACE_CHILDREN: "1", BUN_FUNCTRACE_EXE: (await build()).self });

  /** Runs the fixture under the tracer; `through` is a program to start it through. */
  async function traceSelfExec(extraEnv: Record<string, string>, out: string, arg?: string, through: string[] = []) {
    const { tracer, self, other, starts } = await build();
    using dir = tempDir("functrace-children-traces", {});
    const root = String(dir);
    const symbols = readTextSymbols(self);

    await using proc = Bun.spawn({
      cmd: [...through, self, arg ?? other],
      env: { ...bunEnv, ...extraEnv, [preloadVar]: tracer, BUN_FUNCTRACE_STARTS: starts, BUN_FUNCTRACE_OUT: join(root, out) }, // prettier-ignore
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Which of the two marker functions each trace file recorded.
    const traces: Record<string, string[]> = {};
    for (const file of readdirSync(root).filter(file => file.startsWith("trace"))) {
      const names = readTrace(join(root, file), file).flatMap(address => symbols.get(address) ?? []);
      const plain = names.map(name => (darwin ? name.replace(/^_/, "") : name));
      traces[file === `trace-${proc.pid}.bin` ? "parent" : file] = plain.filter(name => name.endsWith("_only"));
    }
    return { stdout: stdout.trim().split("\n"), stderr, exitCode, traces };
  }

  it.concurrent("traces a re-executed copy of the same binary into its own file, and no other program", async () => {
    const { stdout, stderr, exitCode, traces } = await traceSelfExec(await following(), "trace-%p.bin");
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: ["4", "3"], stderr: "", exitCode: 0 });
    const { parent, ...children } = traces;
    expect({ parent, children: Object.values(children) }).toEqual({
      parent: ["parent_only"],
      children: [["child_only"]],
    });
  });

  it.concurrent("traces the named executable when some other program loads the tracer first", async () => {
    const { wrapper } = await build();
    const { stdout, stderr, exitCode, traces } = await traceSelfExec(await following(), "trace-%p.bin", undefined, [
      wrapper,
      wrapper,
    ]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: ["4", "3"], stderr: "", exitCode: 0 });
    const { parent, ...children } = traces;
    expect({ parent, children: Object.values(children) }).toEqual({
      parent: ["parent_only"],
      children: [["child_only"]],
    });
  });

  it.concurrent("refuses to follow children without being told which executable is the application", async () => {
    const { stdout, stderr, exitCode, traces } = await traceSelfExec({ BUN_FUNCTRACE_CHILDREN: "1" }, "trace-%p.bin");
    // Once, from the first of the three processes, not once each.
    expect({ stdout, stderr, exitCode, traces }).toEqual({
      stdout: ["4", "3"],
      stderr:
        "functrace: BUN_FUNCTRACE_CHILDREN=1 needs BUN_FUNCTRACE_EXE, the absolute path of the executable to trace\n",
      exitCode: 0,
      traces: {},
    });
  });

  it.concurrent("says so when the named executable is not there", async () => {
    const missing = join((await build()).dir, "not-there");
    const { stderr, exitCode, traces } = await traceSelfExec(
      { BUN_FUNCTRACE_CHILDREN: "1", BUN_FUNCTRACE_EXE: missing },
      "trace-%p.bin",
    );
    expect({ stderr, exitCode, traces }).toEqual({
      stderr: `functrace: BUN_FUNCTRACE_EXE=${missing}: No such file or directory\n`,
      exitCode: 0,
      traces: {},
    });
  });

  it.concurrent(
    "gives a process that execs itself in place a second record instead of truncating the first",
    async () => {
      const { stdout, exitCode, traces } = await traceSelfExec(await following(), "trace-%p.bin", "again");
      expect({ stdout, exitCode }).toEqual({ stdout: ["3", "4"], exitCode: 0 });
      const { parent, ...again } = traces;
      expect({
        parent,
        again: Object.entries(again).map(([file, names]) => [file.replace(/\d+/, "PID"), names]),
      }).toEqual({
        parent: ["parent_only"],
        again: [["trace-PID.bin.1", ["child_only"]]],
      });
    },
  );

  it.concurrent("leaves children alone unless asked, whatever the file is called", async () => {
    const { stdout, exitCode, traces } = await traceSelfExec({}, "trace-%p.bin");
    expect({ stdout, exitCode, traces }).toEqual({
      stdout: ["4", "3"],
      exitCode: 0,
      traces: { parent: ["parent_only"] },
    });
  });

  it.concurrent("hints.ts lists what an application entered, the busiest process first", async () => {
    const { self, other } = await build();
    using dir = tempDir("orderfile-hints", {});
    const root = String(dir);

    // The fixture is its own "profile": an unstripped binary whose code is the application's.
    const out = join(root, "app.hints");
    await expect(traceHints({ profile: self, exe: self, command: [self, other], outPath: out })).rejects.toThrow(
      /\{\}/,
    );
    const { processes } = await traceHints({ profile: self, exe: self, command: ["{}", other], outPath: out });
    expect(processes).toBe(2);

    const names = readNameList(out).map(name => (darwin ? name.replace(/^_/, "") : name));
    // The parent entered more (`run`), so it is listed first; the re-executed
    // child adds the one function only it reached.
    expect(names.filter(name => name === "main" || name.endsWith("_only"))).toEqual([
      "main",
      "parent_only",
      "child_only",
    ]);
  });

  it.concurrent("hints.ts takes the application with it when a signal ends it, wrapper or not", async () => {
    const { stay } = await build();
    using dir = tempDir("orderfile-hints-stop", {});
    const pids = join(String(dir), "pids");
    const hints = join(import.meta.dir, "../../../../scripts/orderfile/hints.ts");
    // The session's command is a wrapper: stopping it leaves the application running.
    const script = `
      import { traceHints } from ${JSON.stringify(hints)};
      await traceHints({
        profile: ${JSON.stringify(stay)},
        exe: ${JSON.stringify(stay)},
        command: ["/bin/sh", "-c", '"$0" "$1" & wait', "{}", ${JSON.stringify(pids)}],
        outPath: ${JSON.stringify(join(String(dir), "app.hints"))},
      });`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, TMPDIR: String(dir) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const application = await started(pids, proc.exited);
    // A record left by a process of the application that exited long ago, whose id is someone else's by now.
    await using unrelated = Bun.spawn({ cmd: ["sleep", "60"], env: bunEnv });
    const [scratch] = readdirSync(String(dir)).filter(name => name.startsWith("bun-orderfile-hints-"));
    writeFileSync(join(String(dir), scratch, "traces", `${unrelated.pid}.bin`), "");
    proc.kill("SIGTERM");
    await proc.exited;
    expect({
      signalCode: proc.signalCode,
      scratch: readdirSync(String(dir)).filter(name => name.startsWith("bun-orderfile-hints-")),
      written: existsSync(join(String(dir), "app.hints")),
      unrelated: ![undefined, "Z"].includes(processState(unrelated.pid)),
    }).toEqual({ signalCode: "SIGTERM", scratch: [], written: false, unrelated: true });
    await expectGone(application);
  });

  it("hints.ts orders two processes that entered as many functions by what they entered, not by which it read first", () => {
    const [parent, child, helper] = [
      [0x10, 0x30],
      [0x10, 0x20],
      [0x10, 0x20, 0x40],
    ];
    const expected = [helper, child, parent];
    expect(busiestFirst([parent, child, helper])).toEqual(expected);
    expect(busiestFirst([child, parent, helper])).toEqual(expected);
    expect(busiestFirst([helper, child, parent, child])).toEqual([helper, child, child, parent]);
  });

  it.concurrent("tells an executable with the profile's code from one without", async () => {
    const { self } = await build();
    using dir = tempDir("orderfile-same-code", { "self.c": source.replace("return x + 2;", "return x + 3;") });
    const root = String(dir);
    // What `bun build --compile` does to bun: the same file with a payload after it.
    const compiled = join(root, "compiled");
    copyFileSync(self, compiled);
    appendFileSync(compiled, Buffer.alloc(1 << 16, "payload"));
    // Another build: one instruction's operand differs, nothing else.
    const rebuilt = join(root, "rebuilt");
    await compile(["-o", rebuilt, join(root, "self.c")]);

    expect(sameCode(self, compiled)).toBe(true);
    expect(sameCode(self, rebuilt)).toBe(false);
    expect(() => sameCode(self, join(root, "self.c"))).toThrow(/cannot find the code of .*self\.c/);
  });

  // `bun build --compile` rewrites headers around the code it copies (ELF program
  // headers, Mach-O load commands and signature), which a plain append does not model.
  // Half a second with a release bun, and not alongside the other tests' compilers. Not with a debug or ASAN bun,
  // which is over a gigabyte to copy and compare: the release lanes rewrite the same headers.
  it.skipIf(isDebug || isASAN)("finds bun's own code unchanged in an executable bun compiled", async () => {
    using dir = tempDir("orderfile-same-code-compiled", { "app.js": "console.log(1);\n" });
    const compiled = join(String(dir), "app");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", compiled],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ compiled: /compile\s+\S*app\b/.test(stdout), stderr: stderr.includes("error"), exitCode }).toEqual({
      compiled: true,
      stderr: false,
      exitCode: 0,
    });
    expect(sameCode(bunExe(), compiled)).toBe(true);
  });

  it.concurrent("refuses to follow children into one shared file", async () => {
    const { stdout, stderr, exitCode, traces } = await traceSelfExec(await following(), "trace.bin");
    expect(stderr.trim().split("\n")).toEqual([expect.stringContaining("needs %p in BUN_FUNCTRACE_OUT")]);
    expect({ stdout, exitCode, traces }).toEqual({ stdout: ["4", "3"], exitCode: 0, traces: {} });
  });
});

/**
 * On windows the tracer is a debugger (functrace-windows.c), so it takes the
 * place of both functrace.c and ptyrun.c: it starts the binary itself — on a
 * pseudo console when asked to, since that is the only way the console paths
 * get traced — plants the breakpoints from outside, and writes the same trace.
 * Its addresses come from the link's maps rather than nm, so the fixtures are
 * linked with them, as the release is.
 */
describe.skipIf(!canTrace || !isWindows)("windows tracer", () => {
  it.concurrent("records exact entries out of the maps' functions, and leaves the child alone", async () => {
    using dir = tempDir("functrace-windows", { "child.c": "int main(void) { return 0; }\n" });
    const root = String(dir);
    const tracer = join(root, "functrace.exe");
    const fixture = join(root, "fixture.exe");
    const child = join(root, "child.exe");
    const starts = join(root, "starts.bin");
    const trace = join(root, "trace.bin");

    await Promise.all([
      compileMsvc(root, join(orderfile, "functrace-windows.c"), tracer),
      // No folding: `after` has the same body as f1, and the trace is checked
      // for it being entered separately, after f31.
      compileMsvc(root, join(import.meta.dir, "functrace-fixture.c"), fixture, [...mapsFor(fixture), "/opt:noicf"]),
      compileMsvc(root, join(root, "child.c"), child),
    ]);

    const symbols = readTextSymbols(fixture);
    expect(symbols.size).toBeGreaterThan(33); // the fixture's own functions, plus the static CRT's
    // The static CRT is also where the labels come from that are not functions:
    // its assembly routines name their internal labels (and, on arm64, their
    // tables), so the listing always has more than the functions kept here. A
    // breakpoint on one of those tables is what this test crashes on otherwise.
    const listed = parseSymbolMap(readFileSync(symbolMapFor(fixture), "utf8")).symbols.length;
    expect([...symbols.values()].flat().length).toBeLessThan(listed);
    writeStarts(starts, symbols.keys());

    await using proc = Bun.spawn({
      cmd: [tracer, fixture, child],
      env: { ...bunEnv, BUN_FUNCTRACE_STARTS: starts, BUN_FUNCTRACE_OUT: trace },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The fixture's stdout comes through the tracer's, and so does its exit code.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "497", stderr: "", exitCode: 0 });

    await expectFixtureTrace(trace, symbols);
  });

  it.concurrent("reports the debuggee's exit code, and refuses a binary the starts are not for", async () => {
    using dir = tempDir("functrace-windows-exit", {
      "exit.c": "int main(int argc, char **argv) { (void)argv; return argc + 40; }\n",
    });
    const root = String(dir);
    const tracer = join(root, "functrace.exe");
    const exit = join(root, "exit.exe");
    const starts = join(root, "starts.bin");
    await Promise.all([
      compileMsvc(root, join(orderfile, "functrace-windows.c"), tracer),
      compileMsvc(root, join(root, "exit.c"), exit, mapsFor(exit)),
    ]);
    const env = { ...bunEnv, BUN_FUNCTRACE_STARTS: starts, BUN_FUNCTRACE_OUT: join(root, "trace.bin") };

    writeStarts(starts, readTextSymbols(exit).keys());
    await using traced = Bun.spawn({ cmd: [tracer, exit, "a", "b"], env, stdout: "pipe", stderr: "pipe" });
    // Addresses far outside any code section: a starts file for some other binary.
    writeStarts(join(root, "elsewhere.bin"), [0x7ff600000000, 0x7ff600000010]);
    await using refused = Bun.spawn({
      cmd: [tracer, exit],
      env: { ...env, BUN_FUNCTRACE_STARTS: join(root, "elsewhere.bin") },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [tracedErr, tracedExit, refusedErr, refusedExit] = await Promise.all([
      traced.stderr.text(),
      traced.exited,
      refused.stderr.text(),
      refused.exited,
    ]);
    expect({ tracedErr, tracedExit, refusedExit }).toEqual({ tracedErr: "", tracedExit: 43, refusedExit: 2 });
    expect(refusedErr).toContain("none of the 2 function starts");
  });

  it.concurrent("puts the debuggee on a console when asked to, and types our stdin into it", async () => {
    using dir = tempDir("functrace-console", {
      // Reports whether its stdio is a console, how wide, and the line it was typed.
      "probe.c": [
        "#include <windows.h>",
        "#include <stdio.h>",
        "#include <string.h>",
        "int main(void) {",
        "    DWORD mode;",
        "    CONSOLE_SCREEN_BUFFER_INFO screen;",
        "    int console = GetConsoleMode(GetStdHandle(STD_INPUT_HANDLE), &mode) &&",
        "        GetConsoleScreenBufferInfo(GetStdHandle(STD_OUTPUT_HANDLE), &screen);",
        "    char line[64];",
        '    const char *typed = fgets(line, sizeof line, stdin) ? line : "nothing";',
        '    line[strcspn(line, "\\r\\n")] = 0;',
        '    printf("%s %d %s\\n", console ? "true" : "false", console ? (int)screen.dwSize.X : 0, typed);',
        "    return 0;",
        "}",
        "",
      ].join("\n"),
    });
    const root = String(dir);
    const tracer = join(root, "functrace.exe");
    const probe = join(root, "probe.exe");
    const starts = join(root, "starts.bin");
    await Promise.all([
      compileMsvc(root, join(orderfile, "functrace-windows.c"), tracer),
      compileMsvc(root, join(root, "probe.c"), probe, mapsFor(probe)),
    ]);
    writeStarts(starts, readTextSymbols(probe).keys());

    async function type(name: string, env: Record<string, string>) {
      const trace = join(root, `${name}.bin`);
      await using proc = Bun.spawn({
        cmd: [tracer, probe],
        env: { ...bunEnv, ...env, BUN_FUNCTRACE_STARTS: starts, BUN_FUNCTRACE_OUT: trace },
        stdin: new Blob(["hi\n"]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // A console's output is a terminal rendering — escape sequences, and the
      // typed line echoed back — so pick the probe's own line out of it.
      const line = stdout
        .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
        .split(/[\x00-\x1f]+/)
        .map(text => text.trim())
        .find(text => /^(true|false) \d+ /.test(text));
      return { line, stderr, exitCode, entries: (await readTraceHeader(trace)).entries };
    }

    const [terminal, pipe] = await Promise.all([type("console", { BUN_FUNCTRACE_TTY: "1" }), type("pipe", {})]);

    expect({ console: terminal.line, pipe: pipe.line, stderr: terminal.stderr + pipe.stderr }).toEqual({
      console: "true 80 hi",
      pipe: "false 0 hi",
      stderr: "",
    });
    expect({ console: terminal.exitCode, pipe: pipe.exitCode }).toEqual({ console: 0, pipe: 0 });
    // Both runs were traced: the probe's main, and the CRT on the way there.
    expect(Math.min(terminal.entries, pipe.entries)).toBeGreaterThan(1);
  });
});
