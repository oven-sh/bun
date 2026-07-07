import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
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
 * `<buildDir>/linker.order` is the lld `--symbol-ordering-file` for the linux
 * release link: it lists the functions bun executes while starting up so they
 * land together at the front of `.text`, which is worth ~12 MB of resident
 * binary pages on a `bun -e 'console.log(1)'` (see scripts/orderfile/generate.ts).
 *
 * Nothing in the build fails if this wiring rots. lld skips names it cannot
 * resolve, and we pass --no-warn-symbol-ordering, so a dropped flag silently
 * gives the RSS back instead of breaking the link. CI's verifyOrderFileApplied()
 * catches it, but only on release builds — these checks are what notices in a PR.
 */
const cfg = (overrides: Partial<Config> = {}) =>
  ({
    linux: true,
    abi: "gnu",
    release: true,
    asan: false,
    valgrind: false,
    darwin: false,
    windows: false,
    freebsd: false,
    canary: true,
    mode: "link-only",
    crossTarget: undefined,
    buildDir: "/tmp/build",
    cwd: "/repo",
    ...overrides,
  }) as Config;

/** A canary build on Buildkite, off a pull request. */
const ctx = (overrides: Partial<OrderFileContext> = {}): OrderFileContext => ({
  buildkite: true,
  buildUrl: "https://buildkite.com/bun/bun/builds/68425",
  branch: "main",
  buildNumber: 68425,
  stepKey: "linux-x64-build-bun",
  commitMessage: "some ordinary commit",
  pullRequest: false,
  ...overrides,
});

describe("symbol ordering file", () => {
  it("is enabled for the linux release link", () => {
    expect(usesOrderFile(cfg())).toBe(true);
  });

  it("is disabled where it cannot work or is not wanted", () => {
    expect(usesOrderFile(cfg({ linux: false }))).toBe(false); // ELF only
    expect(usesOrderFile(cfg({ release: false }))).toBe(false); // debug: not worth a relink
    expect(usesOrderFile(cfg({ asan: true }))).toBe(false); // tracer mprotects .text
    expect(usesOrderFile(cfg({ valgrind: true }))).toBe(false);
    // Both of these would otherwise attempt a trace that can never succeed and
    // annotate every build about it.
    expect(usesOrderFile(cfg({ abi: "musl" }))).toBe(false); // static: no LD_PRELOAD
    expect(usesOrderFile(cfg({ abi: "android" }))).toBe(false); // cross: cannot run the binary
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
  });

  it("is not passed on a debug or sanitizer link", () => {
    for (const config of [cfg({ release: false }), cfg({ asan: true })]) {
      const applied = linkerFlags
        .filter(flag => flag.when(config))
        .flatMap(flag => (typeof flag.flag === "function" ? flag.flag(config) : flag.flag))
        .flat()
        .join(" ");
      expect(applied).not.toContain("--symbol-ordering-file");
    }
  });

  it("is a link dependency, so regenerating it relinks", () => {
    // This is what makes the release two-pass work: overwrite the file, re-run
    // ninja, and the link is the only edge whose input changed.
    expect(linkDepends(cfg())).toContain(orderFilePath(cfg()));
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

  it("a cross-compiled target never does — it cannot run the binary it linked", () => {
    const cross = cfg({ crossTarget: "aarch64-unknown-linux-gnu" } as Partial<Config>);
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

describe("order file generator", () => {
  it.skipIf(process.platform !== "linux")("refuses a build directory with no binary to trace", () => {
    expect(() => generateOrderFile({ buildDir: "/tmp/definitely-not-a-build-dir" })).toThrow(/not found/);
  });

  it.skipIf(process.platform === "linux")("refuses to run off linux", () => {
    // It is an ELF linker input and the tracer reads /proc/self/maps.
    expect(() => generateOrderFile({ buildDir: "/tmp/build" })).toThrow(/linux/);
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

const compiler = process.env.CC || Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");

async function compile(args: string[]) {
  await using proc = Bun.spawn({ cmd: [compiler!, "-O1", ...args], env: bunEnv, stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
}

/**
 * One of the traced workloads runs on a pseudo-terminal, because bun's stdio,
 * tty and readline code take a path there that a pipe never reaches, and an
 * order file that missed it would leave all of that scattered. `ptyrun.c` is
 * what provides the terminal.
 */
describe.skipIf(process.platform !== "linux" || !compiler)("pty runner", () => {
  /** Reports what the process sees on its stdio, plus the one line it was typed. */
  const probe = [
    `process.stdin.once("data", data => {`,
    `  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);`,
    `  const fields = [tty, process.stdout.columns ?? 0, process.env.LD_PRELOAD ?? "none", data.toString().trim()];`,
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
    // Somewhere for LD_PRELOAD to point that is real but does nothing. In a
    // trace this is the page tracer, which has to load into the traced binary
    // and not into ptyrun.
    const preload = join(String(dir), "empty.so");
    await Promise.all([
      compile(["-o", ptyrun, join(import.meta.dir, "../../../../scripts/orderfile/ptyrun.c"), "-lutil"]),
      compile(["-shared", "-fPIC", "-o", preload, join(String(dir), "empty.c")]),
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
 * shells out — hands LD_PRELOAD to the child, and a child that created and
 * truncated the trace file would wipe the pages recorded so far. Those are the
 * earliest-touched ones, which is to say the hottest.
 */
describe.skipIf(process.platform !== "linux" || !compiler)("page tracer", () => {
  it.concurrent("keeps the pages it recorded before the traced process execs a child", async () => {
    using dir = tempDir("pagetrace", { "child.c": "int main(void) { return 0; }\n" });
    const root = String(dir);
    const tracer = join(root, "pagetrace.so");
    const fixture = join(root, "fixture");
    const child = join(root, "child");
    const trace = join(root, "trace.bin");

    await Promise.all([
      compile(["-shared", "-fPIC", "-o", tracer, join(import.meta.dir, "../../../../scripts/orderfile/pagetrace.c"), "-ldl"]), // prettier-ignore
      compile(["-o", fixture, join(import.meta.dir, "pagetrace-fixture.c")]),
      compile(["-o", child, join(root, "child.c")]),
    ]);

    // The fixture reads 32 pages of its own .rodata, execs `child` (dynamically
    // linked, so it inherits LD_PRELOAD), then reads one more.
    await using proc = Bun.spawn({
      cmd: [fixture, child],
      env: { ...bunEnv, LD_PRELOAD: tracer, BUN_PAGETRACE_BIN: fixture, BUN_PAGETRACE_OUT: trace },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "1", stderr: "", exitCode: 0 });

    // Layout: u64 page size, u64 count, then `count` u64 page addresses.
    const header = new BigUint64Array(await Bun.file(trace).slice(0, 16).arrayBuffer());
    expect(Number(header[0])).toBeGreaterThan(0);
    // The 32 pages, the one after, and whatever the fixture's own startup
    // touched. A child that truncated the file leaves a handful.
    expect(Number(header[1])).toBeGreaterThanOrEqual(33);
  });
});
