/**
 * Tests for the build engine (scripts/build/engine.ts): what reruns, what
 * does not, ordering, pools, failure handling. Commands are small bun
 * scripts so the tests run on every host.
 */
import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expandNinja, parseDepfile, parseShowIncludes } from "../../scripts/build/depfile.ts";
import { Engine, type EngineOptions, type Task } from "../../scripts/build/engine.ts";

/** `bun -e <code> args…`: the code sees `args` as `process.argv.slice(1)` (no script path with -e). */
function script(code: string, ...args: string[]): string[] {
  return [bunExe(), "-e", `const fs = require("fs"); const A = process.argv.slice(1); ${code}`, ...args];
}

const COPY = `fs.copyFileSync(A[0], A[1]);`;
/** Copy, and append a line to a log file so tests can see when the command ran. */
const COPY_LOGGED = `fs.copyFileSync(A[0], A[1]); fs.appendFileSync(A[2], A[1] + "\\n");`;
/** Write `content` to `out` only if different (writeIfChanged). */
const WRITE_IF_CHANGED = `const [out, content] = A; let cur; try { cur = fs.readFileSync(out, "utf8"); } catch {} if (cur !== content) fs.writeFileSync(out, content);`;
/** Copy `src` to `out`, and write a make-style depfile naming `extra` as a header. */
const COPY_WITH_DEPFILE = `const [src, out, depfile, extra] = A; fs.copyFileSync(src, out); fs.writeFileSync(depfile, out + ": " + src + " \\\\\\n  " + extra + "\\n");`;

function makeEngine(buildDir: string, extra: Partial<EngineOptions> = {}): Engine {
  return new Engine({
    buildDir,
    hostOs: process.platform === "win32" ? "windows" : "linux",
    env: process.env,
    display: "quiet",
    ...extra,
  });
}

/**
 * Give a file an mtime newer than everything the previous run recorded, without
 * dating it into the future (a future mtime would look modified on every run,
 * for ninja too). The engine reads the clock through a file it writes, and the
 * kernel stamps files with a coarse clock that can lag Date.now() by a tick, so
 * spin until a freshly written file is stamped later than `t`. A few ms at most.
 */
function touchNewer(path: string): void {
  const t = new Date();
  utimesSync(path, t, t);
  const probe = `${path}.clock`;
  for (;;) {
    writeFileSync(probe, "");
    if (statSync(probe).mtimeMs > t.getTime()) break;
  }
  rmSync(probe);
}

describe.concurrent("engine", () => {
  test("runs every task once, then nothing", async () => {
    using dir = tempDir("engine", { "a.txt": "a", "b.txt": "b" });
    const d = String(dir);
    const declare = (e: Engine) => {
      const a = e.task({
        kind: "copy",
        label: "a",
        outputs: [join(d, "out/a.out")],
        inputs: [join(d, "a.txt")],
        command: { argv: script(COPY, join(d, "a.txt"), join(d, "out/a.out")) },
      });
      e.task({
        kind: "copy",
        label: "b",
        outputs: [join(d, "out/b.out")],
        inputs: [join(d, "out/a.out"), join(d, "b.txt")],
        after: [a],
        command: { argv: script(COPY, join(d, "b.txt"), join(d, "out/b.out")) },
      });
    };

    const first = makeEngine(d);
    declare(first);
    expect(await first.run()).toEqual({ ok: true, ran: 2, failed: 0, interrupted: false });
    expect(readFileSync(join(d, "out/a.out"), "utf8")).toBe("a");
    expect(readFileSync(join(d, "out/b.out"), "utf8")).toBe("b");

    const second = makeEngine(d);
    declare(second);
    expect(await second.run()).toEqual({ ok: true, ran: 0, failed: 0, interrupted: false });
  });

  test("a newer input reruns the task and its dependents, not the rest", async () => {
    using dir = tempDir("engine", { "a.txt": "a", "b.txt": "b", "c.txt": "c" });
    const d = String(dir);
    const log = join(d, "ran.log");
    const declare = (e: Engine) => {
      const a = e.task({
        kind: "copy",
        label: "a",
        outputs: [join(d, "a.out")],
        inputs: [join(d, "a.txt")],
        command: { argv: script(COPY_LOGGED, join(d, "a.txt"), join(d, "a.out"), log) },
      });
      e.task({
        kind: "copy",
        label: "b",
        outputs: [join(d, "b.out")],
        inputs: [join(d, "a.out")],
        after: [a],
        command: { argv: script(COPY_LOGGED, join(d, "a.out"), join(d, "b.out"), log) },
      });
      e.task({
        kind: "copy",
        label: "c",
        outputs: [join(d, "c.out")],
        inputs: [join(d, "c.txt")],
        command: { argv: script(COPY_LOGGED, join(d, "c.txt"), join(d, "c.out"), log) },
      });
    };
    const first = makeEngine(d);
    declare(first);
    expect((await first.run()).ran).toBe(3);

    writeFileSync(log, "");
    writeFileSync(join(d, "a.txt"), "A");
    touchNewer(join(d, "a.txt"));
    const second = makeEngine(d);
    declare(second);
    expect((await second.run()).ran).toBe(2);
    expect(
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map(l => l.split(/[\\/]/).pop()),
    ).toEqual(["a.out", "b.out"]);
    expect(readFileSync(join(d, "b.out"), "utf8")).toBe("A");
  });

  test("a changed command or a missing output reruns", async () => {
    using dir = tempDir("engine", { "a.txt": "a" });
    const d = String(dir);
    const declare = (e: Engine, content: string) =>
      e.task({
        kind: "write",
        label: "a",
        outputs: [join(d, "a.out")],
        command: { argv: script(WRITE_IF_CHANGED, join(d, "a.out"), content) },
      });

    const first = makeEngine(d);
    declare(first, "one");
    expect((await first.run()).ran).toBe(1);

    const sameCommand = makeEngine(d);
    declare(sameCommand, "one");
    expect((await sameCommand.run()).ran).toBe(0);

    const newCommand = makeEngine(d);
    declare(newCommand, "two");
    expect((await newCommand.run()).ran).toBe(1);
    expect(readFileSync(join(d, "a.out"), "utf8")).toBe("two");

    rmSync(join(d, "a.out"));
    const missing = makeEngine(d);
    declare(missing, "two");
    expect((await missing.run()).ran).toBe(1);
  });

  test("depfile headers are tracked and the depfile is consumed", async () => {
    using dir = tempDir("engine", { "a.c": "a", "a.h": "h" });
    const d = String(dir);
    const out = join(d, "a.o");
    const declare = (e: Engine) =>
      e.task({
        kind: "cc",
        label: "a.o",
        outputs: [out],
        inputs: [join(d, "a.c")],
        depfile: { kind: "gcc", path: `${out}.d` },
        command: { argv: script(COPY_WITH_DEPFILE, join(d, "a.c"), out, `${out}.d`, join(d, "a.h")) },
      });
    const first = makeEngine(d);
    declare(first);
    expect((await first.run()).ran).toBe(1);
    expect(existsSync(`${out}.d`)).toBe(false);

    const noop = makeEngine(d);
    declare(noop);
    expect((await noop.run()).ran).toBe(0);

    // The header is not an input the task declared; only the depfile knows about it.
    touchNewer(join(d, "a.h"));
    const headerChanged = makeEngine(d);
    declare(headerChanged);
    expect((await headerChanged.run()).ran).toBe(1);
  });

  test("restat: an unchanged output does not rerun dependents", async () => {
    using dir = tempDir("engine", { "src.txt": "same" });
    const d = String(dir);
    const declare = (e: Engine) => {
      const gen = e.task({
        kind: "gen",
        label: "gen",
        outputs: [join(d, "gen.h")],
        inputs: [join(d, "src.txt")],
        restat: true,
        command: { argv: script(WRITE_IF_CHANGED, join(d, "gen.h"), "same") },
      });
      e.task({
        kind: "copy",
        label: "use",
        outputs: [join(d, "use.out")],
        inputs: [join(d, "gen.h")],
        after: [gen],
        command: { argv: script(COPY, join(d, "gen.h"), join(d, "use.out")) },
      });
    };
    const first = makeEngine(d);
    declare(first);
    expect((await first.run()).ran).toBe(2);

    // src.txt is newer: gen reruns, writes nothing (content identical), use stays.
    touchNewer(join(d, "src.txt"));
    const second = makeEngine(d);
    declare(second);
    expect((await second.run()).ran).toBe(1);

    const third = makeEngine(d);
    declare(third);
    expect((await third.run()).ran).toBe(0);
  });

  test("after: orders tasks that share no files", async () => {
    using dir = tempDir("engine", {});
    const d = String(dir);
    const log = join(d, "order.log");
    const e = makeEngine(d, { jobs: 4 });
    const first = e.task({
      kind: "w",
      label: "1",
      outputs: [join(d, "1")],
      command: { argv: script(COPY_LOGGED, join(d, "order.log"), join(d, "1"), log) },
    });
    writeFileSync(log, "");
    e.task({
      kind: "w",
      label: "2",
      outputs: [join(d, "2")],
      after: [first],
      command: { argv: script(COPY_LOGGED, join(d, "order.log"), join(d, "2"), log) },
    });
    expect((await e.run()).ok).toBe(true);
    expect(
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map(l => l.split(/[\\/]/).pop()),
    ).toEqual(["1", "2"]);
  });

  test("a failing task skips its dependents and fails the build", async () => {
    using dir = tempDir("engine", { "a.txt": "a" });
    const d = String(dir);
    const e = makeEngine(d, { keepGoing: 0 });
    const bad = e.task({
      kind: "fail",
      label: "bad",
      outputs: [join(d, "bad.out")],
      command: { argv: script(`process.exit(3);`) },
    });
    e.task({
      kind: "copy",
      label: "after-bad",
      outputs: [join(d, "after.out")],
      after: [bad],
      command: { argv: script(COPY, join(d, "a.txt"), join(d, "after.out")) },
    });
    const independent = e.task({
      kind: "copy",
      label: "independent",
      outputs: [join(d, "ind.out")],
      inputs: [join(d, "a.txt")],
      command: { argv: script(COPY, join(d, "a.txt"), join(d, "ind.out")) },
    });

    const summary = await e.run();
    expect(summary).toEqual({ ok: false, ran: 2, failed: 1, interrupted: false });
    expect(existsSync(join(d, "after.out"))).toBe(false);
    expect(existsSync(join(d, "ind.out"))).toBe(true);
    expect((await independent.result).failed).toBe(false);
    expect((await bad.result).failed).toBe(true);
  });

  test("a pool of one serializes its tasks", async () => {
    using dir = tempDir("engine", {});
    const d = String(dir);
    const log = join(d, "slots.log");
    writeFileSync(log, "");
    // Each task logs start, works for a moment, logs end. With depth 1 the windows never interleave.
    const SLOT = `const [log, name, out] = A; fs.appendFileSync(log, "start " + name + "\\n"); const end = Date.now() + 50; while (Date.now() < end) {} fs.appendFileSync(log, "end " + name + "\\n"); fs.writeFileSync(out, "");`;
    const e = makeEngine(d, { jobs: 8, pools: { one: 1 } });
    for (const name of ["a", "b", "c"]) {
      e.task({
        kind: "slot",
        label: name,
        outputs: [join(d, name)],
        pool: "one",
        command: { argv: script(SLOT, log, name, join(d, name)) },
      });
    }
    expect((await e.run()).ok).toBe(true);
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines).toHaveLength(6);
    for (let i = 0; i < lines.length; i += 2) {
      const name = lines[i]!.split(" ")[1];
      expect(lines[i]).toBe(`start ${name}`);
      expect(lines[i + 1]).toBe(`end ${name}`);
    }
  });

  test("aliases select a subset, dry runs touch nothing", async () => {
    using dir = tempDir("engine", { "a.txt": "a" });
    const d = String(dir);
    const declare = (e: Engine): Task => {
      const a = e.task({
        kind: "copy",
        label: "a",
        outputs: [join(d, "a.out")],
        inputs: [join(d, "a.txt")],
        command: { argv: script(COPY, join(d, "a.txt"), join(d, "a.out")) },
      });
      e.task({
        kind: "copy",
        label: "other",
        outputs: [join(d, "other.out")],
        inputs: [join(d, "a.txt")],
        command: { argv: script(COPY, join(d, "a.txt"), join(d, "other.out")) },
      });
      return e.alias("just-a", [a]);
    };
    const dry = makeEngine(d, { dryRun: true });
    const dryAlias = declare(dry);
    expect((await dry.run([dryAlias])).ran).toBe(1);
    expect(existsSync(join(d, "a.out"))).toBe(false);

    const real = makeEngine(d);
    declare(real);
    expect((await real.run([real.lookup("just-a")!])).ran).toBe(1);
    expect(existsSync(join(d, "a.out"))).toBe(true);
    expect(existsSync(join(d, "other.out"))).toBe(false);
    expect(statSync(join(d, "a.out")).isFile()).toBe(true);
  });

  test("two tasks for one output is an error at declaration", () => {
    using dir = tempDir("engine", {});
    const d = String(dir);
    const e = makeEngine(d);
    e.task({ kind: "w", label: "1", outputs: [join(d, "x")], command: { argv: script("") } });
    expect(() => e.task({ kind: "w", label: "2", outputs: [join(d, "x")], command: { argv: script("") } })).toThrow(
      /two tasks produce/,
    );
  });
});

describe("depfile parsing", () => {
  test("clang -MMD output", () => {
    expect(parseDepfile("obj/x.o: ../../src/x.cpp \\\n  /usr/include/foo.h ../../src/a\\ b.h\n")).toEqual({
      targets: ["obj/x.o"],
      deps: ["../../src/x.cpp", "/usr/include/foo.h", "../../src/a b.h"],
    });
  });

  test("nasm -MD output puts a space before the colon", () => {
    expect(parseDepfile("/tmp/t.o : a.asm \\\n  b.inc \\\n  c.inc\n\n")).toEqual({
      targets: ["/tmp/t.o"],
      deps: ["a.asm", "b.inc", "c.inc"],
    });
  });

  test("several rules, windows paths, escapes", () => {
    expect(parseDepfile("a.o: a.c\nb.o: b.c a.h\n").targets).toEqual(["a.o", "b.o"]);
    expect(parseDepfile("C:\\out\\x.obj: C:\\src\\x.c C:\\src\\x.h\n")).toEqual({
      targets: ["C:\\out\\x.obj"],
      deps: ["C:\\src\\x.c", "C:\\src\\x.h"],
    });
    expect(parseDepfile("x.o: a$$b.h \\#.h\n").deps).toEqual(["a$b.h", "#.h"]);
    expect(parseDepfile("x.o:\n")).toEqual({ targets: ["x.o"], deps: [] });
  });

  test("/showIncludes lines become deps and leave the diagnostics", () => {
    const out =
      "Note: including file: C:\\a.h\nNote: including file:  C:\\b.h\nx.cpp(3): warning C4100\nNote: including file: C:\\a.h\n";
    expect(parseShowIncludes(out)).toEqual({ deps: ["C:\\a.h", "C:\\b.h"], filtered: "x.cpp(3): warning C4100\n" });
  });

  test("ninja variable expansion", () => {
    const vars: Record<string, string> = { in: "a b", out: "o", flags: "-O2" };
    expect(expandNinja("cc $flags -c $in -o $out", n => vars[n])).toBe("cc -O2 -c a b -o o");
    expect(expandNinja("$$HOME $ x$:y ${out}.d $missing", n => vars[n])).toBe("$HOME  x:y o.d ");
  });
});
