import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isMusl, isWindows, nodeExe, primeToolchain, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  mustGenerateOrderFile,
  orderFileEligible,
  shouldGenerateOrderFile,
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
import { generateOrderFile, readTextSymbols } from "../../../../scripts/orderfile/generate.ts";
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
 * breaking the link. CI's verifyOrderFileApplied() catches it, but only on
 * release builds — these checks are what notices in a PR.
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
    mode: "link-only",
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

/** A canary build on Buildkite, off a pull request. */
const ctx = (overrides: Partial<OrderFileContext> = {}): OrderFileContext => ({
  buildkite: true,
  buildUrl: "https://buildkite.com/bun/bun/builds/68425",
  branch: "main",
  buildNumber: 68425,
  commitMessage: "some ordinary commit",
  pullRequest: false,
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
    expect(usesOrderFile(cfg({ release: false }))).toBe(false); // debug: not worth a relink
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

  it("is a link dependency, so regenerating it relinks", () => {
    // This is what makes the release two-pass work: overwrite the file, re-run
    // ninja, and the link is the only edge whose input changed. On windows it is
    // what makes inheriting one relink at all.
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

describe("deciding whether a build generates its own order file", () => {
  it("a release always does — it is the binary people install", () => {
    expect(shouldGenerateOrderFile(cfg({ canary: false }), ctx())).toBe(true);
  });

  it("a canary does not by default — it inherits, and pays no second link", () => {
    expect(shouldGenerateOrderFile(cfg(), ctx())).toBe(false);
  });

  it("a canary does when the commit asks for it", () => {
    expect(shouldGenerateOrderFile(cfg(), ctx({ commitMessage: "perf: x [generate symbol order]" }))).toBe(true);
  });

  it("a pull request never does, and never publishes", () => {
    const pr = ctx({ pullRequest: true });
    expect(orderFileEligible(cfg(), pr)).toBe(false);
    expect(shouldGenerateOrderFile(cfg({ canary: false }), pr)).toBe(false);
    expect(mustGenerateOrderFile(cfg(), pr, false)).toBe(false);
  });

  it("a target that cannot run on the host never does", () => {
    const cross = cfg({ canRunOnHost: false } as Partial<Config>);
    expect(shouldGenerateOrderFile(cfg({ ...cross, canary: false } as Partial<Config>), ctx())).toBe(false);
    expect(mustGenerateOrderFile(cross, ctx(), false)).toBe(false);
    expect(orderFileEligible(cross, ctx())).toBe(true); // ...but it can still inherit one
  });

  it("a canary that inherited nothing generates anyway, seeding the chain", () => {
    // Without this the first build publishes nothing, so the next inherits
    // nothing, so it publishes nothing — and no canary is ever ordered.
    expect(mustGenerateOrderFile(cfg(), ctx(), false)).toBe(true);
    expect(mustGenerateOrderFile(cfg(), ctx(), true)).toBe(false);
  });

  it("nothing happens off Buildkite", () => {
    expect(orderFileEligible(cfg(), ctx({ buildkite: false }))).toBe(false);
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

/** The static CRT the fixtures link, wherever %LIB% (set by the VS shell) puts it. */
const msvcCrt = () =>
  (process.env.LIB ?? "")
    .split(";")
    .filter(Boolean)
    .flatMap(dir => ["libcmt.lib", "libucrt.lib", "libvcruntime.lib"].map(lib => join(dir, lib)));

/** The linker options that write a binary's two maps where the generator looks for them (see windows-symbols.ts). */
const mapsFor = (exe: string): string[] => [`/map:${symbolMapFor(exe)}`, `/lldmap:${linkerMapFor(exe)}`];

/** The starts file the generator writes: magic, version, count, then every function's link-time address. */
async function writeStarts(path: string, addresses: Iterable<number | bigint>) {
  const list = [...addresses].map(BigInt);
  const words = new BigUint64Array(3 + list.length);
  words.set([STARTS_MAGIC, 1n, BigInt(list.length)], 0);
  words.set(list, 3);
  await Bun.write(path, new Uint8Array(words.buffer));
}

/**
 * The trace's entries, in the order they were recorded, and the names each one
 * resolves to, the way generate.ts resolves them. Every entry was one of the
 * starts handed in, so every one resolves.
 */
async function readTrace(path: string, symbols: Map<number, string[]>) {
  const words = new BigUint64Array(await Bun.file(path).arrayBuffer());
  // Layout: u64 magic, version, slide, start count, entry count, then the entries.
  expect({ magic: words[0], version: words[1] }).toEqual({ magic: TRACE_MAGIC, version: 1n });
  const entries = Array.from(words.subarray(5, 5 + Number(words[4])), address => Number(address));
  const names = entries.flatMap(address => symbols.get(address) ?? [`unresolved ${address.toString(16)}`]);
  expect(names.filter(name => name.startsWith("unresolved "))).toEqual([]);
  return { entries, names };
}

describe("order file generator", () => {
  it.skipIf(!supported)("refuses a build directory with no binary to trace", () => {
    expect(() => generateOrderFile({ buildDir: "/tmp/definitely-not-a-build-dir" })).toThrow(/not found/);
  });

  it.skipIf(supported)("refuses to run on an unsupported platform", () => {
    // The tracers are x86-64 INT3 / arm64 BRK on linux and windows, arm64 BRK on macOS.
    expect(() => generateOrderFile({ buildDir: "/tmp/build" })).toThrow(/linux|macOS|Windows/);
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

  it.concurrent("runs the child on a terminal, and hands it the preload it was given", async () => {
    using dir = tempDir("ptyrun", { "empty.c": "int ptyrun_nothing;\n" });
    const ptyrun = join(String(dir), "ptyrun");
    // Somewhere for the preload to point that is real but does nothing. In a
    // trace this is the function tracer, which has to load into the traced
    // binary and not into ptyrun.
    const preload = join(String(dir), darwin ? "empty.dylib" : "empty.so");
    await Promise.all([
      compile(["-o", ptyrun, join(orderfile, "ptyrun.c"), ...(darwin ? [] : ["-lutil"])]),
      compile([...shared, "-o", preload, join(String(dir), "empty.c")]),
    ]);

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
});

/**
 * What a trace of functrace-fixture.c must say, whichever tracer wrote it: the
 * fixture calls f0..f31 in that order, runs a child, then calls `after`, and
 * every one of those is a first entry. A trace a child process truncated or
 * re-armed over has a handful of entries and is missing the early ones, which
 * in a real trace are the hottest.
 */
async function expectFixtureTrace(trace: string, symbols: Map<number, string[]>) {
  const { entries, names } = await readTrace(trace, symbols);
  // macOS nm spells C functions with a leading underscore.
  const plain = names.map(name => (darwin ? name.replace(/^_/, "") : name));

  // The fixture's own functions, in the order it calls them, each entered once;
  // the CRT's are whatever it ran on the way in and between them.
  expect(plain.filter(name => /^(main|f\d+|after)$/.test(name))).toEqual([
    "main",
    ...Array.from({ length: 32 }, (_, i) => `f${i}`),
    "after",
  ]);
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
    await writeStarts(starts, symbols.keys());

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
 * On windows the tracer is a debugger (functrace-windows.c), so it takes the
 * place of both functrace.c and ptyrun.c: it starts the binary itself — on a
 * pseudo console when asked to, since that is the only way the console paths
 * get traced — plants the breakpoints from outside, and writes the same trace.
 * Its addresses come from the link's maps rather than nm, so the fixtures are
 * linked with them, as the release is.
 */
describe.skipIf(!canTrace || !isWindows)("windows tracer", () => {
  /** A binary the tracer runs: built once, its functions read from its maps once and written as its starts file. */
  type Built = { exe: string; symbols: Map<number, string[]>; starts: string };
  let dir: ReturnType<typeof tempDir> | undefined;
  let root: string;
  let tracer: string;
  let fixture: Built, child: Built, probe: Built;

  beforeAll(async () => {
    dir = tempDir("functrace-windows", {
      // What the fixture runs: exits 0 with no arguments. With arguments it
      // exits argc + 40, for the test of what comes back through the tracer.
      "child.c": "int main(int argc, char **argv) { (void)argv; return argc > 1 ? argc + 40 : 0; }\n",
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
        '    char line[64] = "nothing";',
        '    if (fgets(line, sizeof line, stdin)) line[strcspn(line, "\\r\\n")] = 0;',
        '    printf("%s %d %s\\n", console ? "true" : "false", console ? (int)screen.dwSize.X : 0, line);',
        "    return 0;",
        "}",
        "",
      ].join("\n"),
    });
    root = String(dir);
    tracer = join(root, "functrace.exe");
    const exe = (name: string) => join(root, `${name}.exe`);

    // The compiler, the lld-link beside it that clang-cl links with, and the CRT: see primeToolchain.
    primeToolchain([compiler!, join(dirname(compiler!), "lld-link.exe"), ...msvcCrt()]);
    await Promise.all([
      compileMsvc(root, join(orderfile, "functrace-windows.c"), tracer),
      // No folding: `after` has the same body as f1, and the trace is checked
      // for it being entered separately, after f31.
      compileMsvc(root, join(import.meta.dir, "functrace-fixture.c"), exe("fixture"), [
        ...mapsFor(exe("fixture")),
        "/opt:noicf",
      ]),
      compileMsvc(root, join(root, "child.c"), exe("child"), mapsFor(exe("child"))),
      compileMsvc(root, join(root, "probe.c"), exe("probe"), mapsFor(exe("probe"))),
    ]);

    // The starts file the generator would write for each, from the same symbol reader.
    async function built(name: string): Promise<Built> {
      const symbols = readTextSymbols(exe(name));
      const starts = join(root, `${name}.starts`);
      await writeStarts(starts, symbols.keys());
      return { exe: exe(name), symbols, starts };
    }
    [fixture, child, probe] = await Promise.all([built("fixture"), built("child"), built("probe")]);
  });

  afterAll(() => dir?.[Symbol.dispose]());

  /**
   * Runs `target` under the tracer, in `root`, armed with its own starts unless
   * told otherwise, and has it write `<name>.trace`.
   */
  async function trace(
    name: string,
    target: Built,
    args: string[],
    { env = {}, stdin, starts = target.starts }: { env?: Record<string, string>; stdin?: Blob; starts?: string } = {},
  ) {
    const out = join(root, `${name}.trace`);
    await using proc = Bun.spawn({
      cmd: [tracer, target.exe, ...args],
      cwd: root,
      env: { ...bunEnv, ...env, BUN_FUNCTRACE_STARTS: starts, BUN_FUNCTRACE_OUT: out },
      stdin,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, trace: out };
  }

  it.concurrent("records exact entries out of the maps' functions, and leaves the child alone", async () => {
    const { symbols } = fixture;
    expect(symbols.size).toBeGreaterThan(33); // the fixture's own functions, plus the static CRT's
    // The static CRT is also where the labels come from that are not functions:
    // its assembly routines name their internal labels (and, on arm64, their
    // tables), so the listing always has more than the functions kept here. A
    // breakpoint on one of those tables is what this test crashes on otherwise.
    const listed = parseSymbolMap(readFileSync(symbolMapFor(fixture.exe), "utf8")).symbols.length;
    expect([...symbols.values()].flat().length).toBeLessThan(listed);

    const run = await trace("fixture", fixture, [child.exe]);
    // The fixture's stdout comes through the tracer's, and so does its exit code.
    expect({ stdout: run.stdout.trim(), stderr: run.stderr, exitCode: run.exitCode }).toEqual({
      stdout: "497",
      stderr: "",
      exitCode: 0,
    });
    await expectFixtureTrace(run.trace, symbols);
  });

  it.concurrent("reports the debuggee's exit code, and refuses a binary the starts are not for", async () => {
    // Addresses far outside any code section: a starts file for some other
    // binary. Named relative to the tracer's cwd: the message echoes the name,
    // and the tracer prints it in the C locale, where a temp path under a
    // non-ASCII user name would not survive.
    await writeStarts(join(root, "elsewhere.starts"), [0x7ff600000000, 0x7ff600000010]);

    const [traced, refused] = await Promise.all([
      trace("exit", child, ["a", "b"]),
      trace("refused", child, [], { starts: "elsewhere.starts" }),
    ]);

    // 43 is the child's argc + 40: both arguments reached it, and its exit code
    // came back as the tracer's. The refusal is the tracer's own exit code, 2,
    // and its one line of stderr (the CRT's, so \r\n).
    expect({
      traced: { stdout: traced.stdout, stderr: traced.stderr, exitCode: traced.exitCode },
      refused: { stdout: refused.stdout, stderr: refused.stderr, exitCode: refused.exitCode },
    }).toEqual({
      traced: { stdout: "", stderr: "", exitCode: 43 },
      refused: {
        stdout: "",
        stderr:
          "functrace: none of the 2 function starts in elsewhere.starts fall inside the command's code — is it the binary they were read from?\r\n",
        exitCode: 2,
      },
    });
    // The exit code came out of a traced run; the refusal came before any trace was written.
    expect((await readTrace(traced.trace, child.symbols)).names).toContain("main");
    expect(existsSync(refused.trace)).toBe(false);
  });

  it.concurrent("puts the debuggee on a console when asked to, and types our stdin into it", async () => {
    async function type(name: string, env: Record<string, string>) {
      const run = await trace(name, probe, [], { env, stdin: new Blob(["hi\n"]) });
      // A console's output is a terminal rendering — escape sequences, and the
      // typed line echoed back — so pick the probe's own line out of it.
      const line = run.stdout
        .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
        .split(/[\x00-\x1f]+/)
        .map(text => text.trim())
        .find(text => /^(true|false) \d+ /.test(text));
      const { names } = await readTrace(run.trace, probe.symbols);
      return { line, stderr: run.stderr, exitCode: run.exitCode, tracedMain: names.includes("main") };
    }

    const [terminal, pipe] = await Promise.all([type("console", { BUN_FUNCTRACE_TTY: "1" }), type("pipe", {})]);

    // Both runs were traced all the way into the probe's main, on either kind of stdio.
    expect({ console: terminal, pipe }).toEqual({
      console: { line: "true 80 hi", stderr: "", exitCode: 0, tracedMain: true },
      pipe: { line: "false 0 hi", stderr: "", exitCode: 0, tracedMain: true },
    });
  });
});
