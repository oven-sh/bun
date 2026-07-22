import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isMusl, nodeExe, tempDir } from "harness";
import { join } from "node:path";
import {
  mustGenerateOrderFile,
  orderFileEligible,
  shouldGenerateOrderFile,
  type OrderFileContext,
} from "../../../../scripts/build/ci.ts";
import type { Config } from "../../../../scripts/build/config.ts";
import { linkDepends, linkerFlags, orderFilePath, usesOrderFile } from "../../../../scripts/build/flags.ts";
import { generateOrderFile } from "../../../../scripts/orderfile/generate.ts";

/**
 * `<buildDir>/linker.order` lists the functions bun executes while starting up
 * so they land together at the front of `.text`, which is worth ~12 MB of
 * resident binary pages on a `bun -e 'console.log(1)'`: lld
 * `--symbol-ordering-file` on linux, Apple ld `-order_file` on macOS (see
 * scripts/orderfile/generate.ts).
 *
 * Nothing in the build fails if this wiring rots. Both linkers skip names they
 * cannot resolve, so a dropped flag silently gives the RSS back instead of
 * breaking the link. CI's verifyOrderFileApplied() catches it, but only on
 * release builds — these checks are what notices in a PR.
 */
const cfg = (overrides: Partial<Config> = {}) =>
  ({
    linux: true,
    darwin: false,
    abi: "gnu",
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
    buildDir: "/tmp/build",
    cwd: "/repo",
    ...overrides,
  }) as Config;

const darwinArm64 = { linux: false, darwin: true, abi: undefined, arm64: true } as Partial<Config>;

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

  it("is disabled where it cannot work or is not wanted", () => {
    expect(usesOrderFile(cfg({ release: false }))).toBe(false); // debug: not worth a relink
    expect(usesOrderFile(cfg({ asan: true }))).toBe(false); // tracer swaps .text
    expect(usesOrderFile(cfg({ valgrind: true }))).toBe(false);
    // Both of these would otherwise attempt a trace that can never succeed and
    // annotate every build about it.
    expect(usesOrderFile(cfg({ abi: "musl" }))).toBe(false); // static: no LD_PRELOAD
    expect(usesOrderFile(cfg({ abi: "android" }))).toBe(false); // cross: cannot run the binary
    // darwin x64: the tracer is arm64-only, so nothing ever seeds the chain.
    expect(usesOrderFile(cfg({ ...darwinArm64, arm64: false }))).toBe(false);
    expect(usesOrderFile(cfg({ linux: false, windows: true }))).toBe(false);
  });

  it("lives in the build directory, never the source tree", () => {
    // A committed order file rots silently. It is a build artifact.
    expect(orderFilePath(cfg())).toBe(join("/tmp/build", "linker.order"));
  });

  it("is passed to lld on the linux release link", () => {
    const config = cfg();
    const applied = linkerFlags
      .filter(flag => flag.when(config))
      .flatMap(flag => (typeof flag.flag === "function" ? flag.flag(config) : flag.flag))
      .flat();

    expect(applied).toContain(`-Wl,--symbol-ordering-file=${orderFilePath(config)}`);
    // Without this, a stale entry is a hard link error rather than a skipped symbol.
    expect(applied).toContain("-Wl,--no-warn-symbol-ordering");
    expect(applied.join(" ")).not.toContain("-order_file");
  });

  it("is passed to Apple ld on the macOS arm64 release link", () => {
    const config = cfg(darwinArm64);
    const applied = linkerFlags
      .filter(flag => flag.when(config))
      .flatMap(flag => (typeof flag.flag === "function" ? flag.flag(config) : flag.flag))
      .flat();

    expect(applied).toContain(`-Wl,-order_file,${orderFilePath(config)}`);
    expect(applied.join(" ")).not.toContain("--symbol-ordering-file");
  });

  it("is not passed on a debug or sanitizer link", () => {
    for (const config of [cfg({ release: false }), cfg({ asan: true })]) {
      const applied = linkerFlags
        .filter(flag => flag.when(config))
        .flatMap(flag => (typeof flag.flag === "function" ? flag.flag(config) : flag.flag))
        .flat()
        .join(" ");
      expect(applied).not.toContain("--symbol-ordering-file");
      expect(applied).not.toContain("-order_file");
    }
  });

  it("is a link dependency, so regenerating it relinks", () => {
    // This is what makes the release two-pass work: overwrite the file, re-run
    // ninja, and the link is the only edge whose input changed.
    expect(linkDepends(cfg())).toContain(orderFilePath(cfg()));
    expect(linkDepends(cfg(darwinArm64))).toContain(orderFilePath(cfg(darwinArm64)));
    expect(linkDepends(cfg({ release: false }))).not.toContain(orderFilePath(cfg({ release: false })));
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

const compiler = process.env.CC || Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");
const darwin = process.platform === "darwin";
const supported = process.platform === "linux" || (darwin && process.arch === "arm64");
// Not musl: the real generator never runs there (bun-musl is statically linked,
// so LD_PRELOAD cannot load the tracer — see usesOrderFile), so compiling and
// running the tracer on a musl host exercises nothing the build uses.
const canTrace = supported && !isMusl && !!compiler;
/** The injected-library variable the tracer rides in on. */
const preloadVar = darwin ? "DYLD_INSERT_LIBRARIES" : "LD_PRELOAD";
const shared = darwin ? ["-dynamiclib", "-fPIC"] : ["-shared", "-fPIC"];

async function compile(args: string[]) {
  await using proc = Bun.spawn({ cmd: [compiler!, "-O1", ...args], env: bunEnv, stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
}

describe("order file generator", () => {
  it.skipIf(!supported)("refuses a build directory with no binary to trace", () => {
    expect(() => generateOrderFile({ buildDir: "/tmp/definitely-not-a-build-dir" })).toThrow(/not found/);
  });

  it.skipIf(supported)("refuses to run on an unsupported platform", () => {
    // The tracer is x86-64 INT3 / arm64 BRK on linux, or arm64 BRK on macOS.
    expect(() => generateOrderFile({ buildDir: "/tmp/build" })).toThrow(/linux|macOS/);
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
 * what provides the terminal.
 */
describe.skipIf(!canTrace)("pty runner", () => {
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
    // probe's own line is the last one.
    const lines = stdout.replaceAll("\r", "").trim().split("\n");
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
      compile(["-o", ptyrun, join(import.meta.dir, "../../../../scripts/orderfile/ptyrun.c"), ...(darwin ? [] : ["-lutil"])]), // prettier-ignore
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
 * The tracer loads into the binary under trace and nowhere else. Every workload
 * that execs something — `bun install` runs lifecycle scripts, the cli workload
 * shells out — hands the preload to the child, and a child that created and
 * truncated the trace file would wipe the entries recorded so far. Those are
 * the earliest ones, which is to say the hottest.
 */
describe.skipIf(!canTrace)("function tracer", () => {
  it.concurrent("records exact entries, and keeps them across an exec'd child", async () => {
    using dir = tempDir("functrace", { "child.c": "int main(void) { return 0; }\n" });
    const root = String(dir);
    const tracer = join(root, darwin ? "functrace.dylib" : "functrace.so");
    const fixture = join(root, "fixture");
    const child = join(root, "child");
    const starts = join(root, "starts.bin");
    const trace = join(root, "trace.bin");

    await Promise.all([
      compile([...shared, "-o", tracer, join(import.meta.dir, "../../../../scripts/orderfile/functrace.c"), ...(darwin ? [] : ["-ldl", "-lpthread"])]), // prettier-ignore
      compile(["-o", fixture, join(import.meta.dir, "functrace-fixture.c")]),
      compile(["-o", child, join(root, "child.c")]),
    ]);

    // Write the starts file the generator would: magic, version, count, then
    // nm's text-symbol addresses.
    await using nm = Bun.spawn({ cmd: ["nm", "--defined-only", fixture], env: bunEnv, stdout: "pipe" });
    const addresses: bigint[] = [];
    for (const line of (await nm.stdout.text()).split("\n")) {
      const m = /^([0-9a-f]+) [tT] \S+$/.exec(line);
      if (m) addresses.push(BigInt(`0x${m[1]}`));
    }
    expect(addresses.length).toBeGreaterThan(33);
    const words = new BigUint64Array(3 + addresses.length);
    words.set([0x4e55425354525453n, 1n, BigInt(addresses.length)], 0);
    words.set(addresses, 3);
    await Bun.write(starts, new Uint8Array(words.buffer));

    // The fixture calls 32 functions, execs `child` (dynamically linked, so it
    // inherits the preload), then calls one more.
    await using proc = Bun.spawn({
      cmd: [fixture, child],
      env: { ...bunEnv, [preloadVar]: tracer, BUN_FUNCTRACE_STARTS: starts, BUN_FUNCTRACE_OUT: trace },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "497", stderr: "", exitCode: 0 });

    // Layout: u64 magic, version, slide, start count, entry count, addresses.
    const header = new BigUint64Array(await Bun.file(trace).slice(0, 40).arrayBuffer());
    expect({ magic: header[0], version: header[1] }).toEqual({ magic: 0x4e55424543415254n, version: 1n });
    // The 32 fixture functions, the one after, plus _start and main. A child
    // that truncated the file leaves a handful.
    expect(Number(header[4])).toBeGreaterThanOrEqual(33);
  });
});
