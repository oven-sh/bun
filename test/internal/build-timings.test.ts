/**
 * `bun scripts/build.ts --timings` (scripts/build/timings.ts) reads a build directory: `build.ninja` for the graph,
 * `.ninja_log` for when each command ran, and the mtime of an output a command released early. The build directory
 * here has a `build.ninja` written by the build's own writer, a log in ninja's format with the properties measured on
 * real ones (every output logged under both spellings, lines in no particular order, a stamp that is the command's
 * start except for a restat rule, taken a little late now and then), and output files stamped the way rust/run.ts
 * stamps them.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { BuildError } from "../../scripts/build/error.ts";
import { type ManifestEdge, Ninja, readManifest } from "../../scripts/build/ninja.ts";
import { rustcPhasesPath } from "../../scripts/build/rust/units.ts";
import { chartData, chartHtml } from "../../scripts/build/timings-chart.ts";
import {
  type Build,
  criticalPath,
  formatReport,
  loadBuild,
  lowParallelismWindows,
  parseNinjaLog,
  queueTimes,
  totalsByKind,
  traceEvents,
  waits,
} from "../../scripts/build/timings.ts";

const T0 = Date.UTC(2026, 0, 2, 3, 4, 5);
const T1 = T0 + 3_600_000;

const dir = tempDir("build-timings", {});
afterAll(() => dir[Symbol.dispose]());
const buildDir = join(String(dir), "build");
const out = (name: string) => join(buildDir, name);
// Outside the build directory, so the graph names it by a relative path, spelled the way the host spells paths.
const ref = join(String(dir), "vendor", "dep", ".ref");
const refName = relative(buildDir, ref);
let build: Build;

function touch(path: string, mtimeMs: number, content = ""): void {
  writeFileSync(path, content);
  utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
}

beforeAll(async () => {
  mkdirSync(buildDir, { recursive: true });
  const n = new Ninja({ buildDir });
  n.pool("dep", 4);
  n.pool("compile", 2);
  n.rule("dep_fetch", {
    command: "fetch $name $repo $commit $dest $cache $patches",
    description: "fetch $name",
    restat: true,
    pool: "dep",
  });
  n.rule("rust_rustc", { command: "rustc $manifest", description: "rustc $crate $what" });
  n.rule("cc", { command: "cc $cflags -c $in -o $out", description: "cc $out" });
  n.rule("link", { command: "ld $ldflags $in -o $out", description: "link $out" });

  n.build({
    outputs: [ref],
    rule: "dep_fetch",
    inputs: [],
    vars: { name: "dep", repo: "o/dep", commit: "abc", dest: "vendor/dep", cache: "cache", patches: "" },
  });
  const crate = (name: string, implicitInputs: string[], what = "") =>
    n.build({
      outputs: what === "" ? [out(`lib${name}.rlib`), out(`lib${name}.rmeta`)] : [out(`lib${name}.a`)],
      rule: "rust_rustc",
      inputs: [],
      implicitInputs,
      orderOnlyInputs: [ref],
      vars: { manifest: `${name}.json`, crate: name, what },
      ...(what === "" ? { earlyOutputPrefix: "@early@" } : {}),
    });
  crate("a", []);
  // A library reads only the metadata of the library it depends on; the root links, so it reads the code too.
  crate("b", [out("liba.rmeta")]);
  crate("root", [out("liba.rlib"), out("liba.rmeta"), out("libb.rlib"), out("libb.rmeta")], "→ libroot.a");
  n.build({
    outputs: [out("x.o")],
    rule: "cc",
    inputs: [join(String(dir), "x.c")],
    pool: "compile",
    vars: { cflags: "-O2" },
  });
  n.build({ outputs: [out("exe")], rule: "link", inputs: [out("x.o"), out("libroot.a")], vars: { ldflags: "" } });
  n.phony("all", [out("exe")]);
  await n.write();

  const edges = readManifest(n.toString()).edges;
  const edgeOf = (output: string) => edges.find(e => e.outputs.includes(output))!;
  // ninja logs a command once per output, implicit outputs included, with the same times on every line.
  const logged = (edge: ManifestEdge, start: number, end: number, stampMs: number) =>
    [...edge.outputs, ...edge.implicitOutputs].map(
      o => `${start}\t${end}\t${BigInt(stampMs) * 1_000_000n}\t${o}\tf00d`,
    );
  const log = [
    "# ninja log v7",
    // The second ninja, an hour later: x.c was edited. x.o waited two seconds for something outside the graph.
    ...logged(edgeOf("x.o"), 2000, 2050, T1 + 2000),
    ...logged(edgeOf("exe"), 2100, 3400, T1 + 2100),
    // The first ninja built everything. A restat rule's stamp is its output's mtime, not its start.
    ...logged(edgeOf(refName), 5, 105, T0 + 100),
    ...logged(edgeOf("liba.rlib"), 110, 1110, T0 + 110),
    ...logged(edgeOf("x.o"), 110, 160, T0 + 112),
    ...logged(edgeOf("libb.rlib"), 412, 2412, T0 + 412),
    // ninja got to `.ninja_lock` 21 ms after it read its clock.
    ...logged(edgeOf("libroot.a"), 2415, 3415, T0 + 2415 + 21),
    ...logged(edgeOf("exe"), 3420, 3900, T0 + 3420),
    // An output of a graph that is gone.
    `0\t9000\t${BigInt(T0) * 1_000_000n}\tremoved.o\tf00d`,
    "",
  ];
  writeFileSync(out(".ninja_log"), log.join("\n"));

  // rust/run.ts stamps the `.rmeta` when rustc reports it and the `.rlib` when rustc exits.
  touch(out("liba.rmeta"), T0 + 110 + 300);
  touch(out("liba.rlib"), T0 + 1105);
  touch(out("libb.rmeta"), T0 + 412 + 200);
  touch(out("libb.rlib"), T0 + 2410);

  // --time-trace=on: clang's trace beside the object, rustc's passes beside the crate.
  touch(
    out("x.json"),
    T1 + 2050,
    JSON.stringify({
      beginningOfTime: (T1 + 2001) * 1000,
      traceEvents: [
        { ph: "X", name: "ExecuteCompiler", ts: 0, dur: 48_000 },
        { ph: "X", name: "Frontend", ts: 1000, dur: 30_000 },
        { ph: "X", name: "Source", ts: 2000, dur: 20_000, args: { detail: "x.h" } },
        { ph: "X", name: "Backend", ts: 31_000, dur: 15_000 },
        { ph: "X", name: "Total Frontend", ts: 0, dur: 30_000 },
        { ph: "M", name: "process_name", ts: 0 },
      ],
    }),
  );
  const passes = (at: number) => [
    { name: "type_check_crate", startMs: at + 430, endMs: at + 600 },
    { name: "LLVM_passes", startMs: at + 700, endMs: at + 2300 },
    { name: "total", startMs: at + 420, endMs: at + 2400 },
  ];
  writeFileSync(rustcPhasesPath(out("libb.rlib")), JSON.stringify({ phases: passes(T0) }));
  // Left by a build of `a` that was interrupted the day before: not the execution in the log.
  writeFileSync(rustcPhasesPath(out("liba.rlib")), JSON.stringify({ phases: passes(T0 - 86_400_000) }));

  build = loadBuild(buildDir, false);
});

const labels = (xs: { label: string }[]) => xs.map(x => x.label);

describe("readManifest", () => {
  test("reads back what Ninja writes: outputs under both spellings, each kind of input, bindings, pools", () => {
    const { edges, pools, rules } = build.manifest;
    expect([...pools]).toEqual([
      ["dep", 4],
      ["compile", 2],
    ]);
    expect(rules.get("dep_fetch")).toEqual({
      name: "dep_fetch",
      description: "fetch $name",
      restat: true,
      generator: false,
      pool: "dep",
    });
    const b = edges.find(e => e.bindings.crate === "b")!;
    expect(b).toEqual({
      rule: "rust_rustc",
      outputs: ["libb.rlib", "libb.rmeta"],
      implicitOutputs: [out("libb.rlib"), out("libb.rmeta")],
      inputs: [],
      implicitInputs: ["liba.rmeta"],
      orderOnlyInputs: [refName],
      validations: [],
      bindings: { manifest: "b.json", crate: "b", what: "", early_output_prefix: "@early@" },
    });
    expect(edges.find(e => e.rule === "cc")!.bindings.pool).toBe("compile");
    expect(edges.find(e => e.rule === "phony")).toMatchObject({ outputs: ["all"], inputs: ["exe"] });
  });
});

describe("parseNinjaLog", () => {
  test("accepts only the format the build's ninja writes", () => {
    expect(parseNinjaLog("# ninja log v7\n1\t2\t3000000\ta.o\tbeef\n")).toEqual([
      { start: 1, end: 2, stamp: 3000000n, output: "a.o" },
    ]);
    expect(() => parseNinjaLog("# ninja log v6\n1\t2\t3\ta.o\tbeef\n")).toThrow(BuildError);
  });
});

describe("loadBuild", () => {
  test("splits the log into the ninjas that wrote it, whatever order its lines are in", () => {
    expect(build.runs.map(r => [r.epochMs, labels(r.executions)])).toEqual([
      [T0, ["fetch dep", "cc x.o", "rustc a", "rustc b", "rustc root → libroot.a", "link exe"]],
      [T1, ["cc x.o", "link exe"]],
    ]);
  });

  test("keeps each edge's last execution", () => {
    const last = [...build.last.values()].map(x => [x.label, x.run === build.runs[1] ? "second" : "first"]);
    expect(last.sort()).toEqual([
      ["cc x.o", "second"],
      ["fetch dep", "first"],
      ["link exe", "second"],
      ["rustc a", "first"],
      ["rustc b", "first"],
      ["rustc root → libroot.a", "first"],
    ]);
  });

  test("finds when a command released an output early from the output's mtime", () => {
    const released = [...build.last.values()].map(x => [x.label, [...x.released]]);
    expect(released.filter(([, r]) => r!.length > 0)).toEqual([
      ["rustc a", [[out("liba.rmeta"), 300]]],
      ["rustc b", [[out("libb.rmeta"), 200]]],
    ]);
  });

  test("takes a compiler's report only when it is about the execution in the log", () => {
    const reports = Object.fromEntries([...build.last.values()].map(x => [x.label, x.selfReport.map(p => p.name)]));
    expect(reports).toEqual({
      "cc x.o": ["ExecuteCompiler", "Frontend", "Source x.h", "Backend"],
      "fetch dep": [],
      "link exe": [],
      "rustc a": [],
      "rustc b": ["type_check_crate", "LLVM_passes", "total"],
      "rustc root → libroot.a": [],
    });
  });
});

describe("analysis", () => {
  test("totals by kind of edge", () => {
    expect(totalsByKind(build).map(k => [k.rule, k.edges, k.totalMs, k.slowest.label])).toEqual([
      ["rust_rustc", 3, 4000, "rustc b"],
      ["link", 1, 1300, "link exe"],
      ["dep_fetch", 1, 100, "fetch dep"],
      ["cc", 1, 50, "cc x.o"],
    ]);
  });

  test("the critical path counts a crate only up to its .rmeta when the next step reads only that", () => {
    const path = criticalPath(build);
    expect(path.steps.map(s => [s.execution.label, s.blocksNextForMs])).toEqual([
      ["fetch dep", 100],
      // `b` reads liba.rmeta, released 300 ms into `a`'s 1000.
      ["rustc a", 300],
      // The root links libb.rlib: all of `b`.
      ["rustc b", 2000],
      ["rustc root → libroot.a", 1000],
      // From the second run, the last time it ran.
      ["link exe", 1300],
    ]);
    expect(path.totalMs).toBe(4700);
  });

  test("the most recent run: when few commands ran, and how long each waited after its inputs existed", () => {
    const run = build.runs.at(-1)!;
    expect(lowParallelismWindows(run).map(w => [w.from, w.to, labels(w.running)])).toEqual([
      [0, 3400, ["cc x.o", "link exe"]],
    ]);
    // What each command was waiting on: the command of the run that made the last of its inputs to exist.
    const why = (r: typeof run) =>
      [...waits(build, r)].map(([x, w]) => [x.label, w.blocker?.label, w.readyAt, w.ms, w.inputs]);
    expect(why(run)).toEqual([
      ["cc x.o", undefined, 0, 2000, 0],
      ["link exe", "cc x.o", 2050, 50, 1],
    ]);
    expect(why(build.runs[0]!)).toEqual([
      ["fetch dep", undefined, 0, 5, 0],
      ["cc x.o", undefined, 0, 110, 0],
      ["rustc a", "fetch dep", 105, 5, 1],
      // `b` could start when `a` released liba.rmeta, 300 ms into it, not when `a` ended.
      ["rustc b", "rustc a", 410, 2, 2],
      ["rustc root → libroot.a", "rustc b", 2412, 3, 3],
      ["link exe", "rustc root → libroot.a", 3415, 5, 2],
    ]);
    expect(queueTimes(build, run).map(q => [q.pool, q.depth, q.edges, q.totalMs, q.longest.execution.label])).toEqual([
      // Nothing x.o reads was built by this run, so it could have started at 0.
      ["compile", 2, 1, 2000, "cc x.o"],
      // exe waited for x.o, which ended at 2050.
      [undefined, undefined, 1, 50, "link exe"],
    ]);
  });
});

describe("formatReport", () => {
  test("the whole report", () => {
    const plain = { bold: (s: string) => s, dim: (s: string) => s };
    const report = formatReport(build, plain).replace(/^build timings .*$/m, "build timings  <buildDir>");
    expect(report).toMatchInlineSnapshot(`
      "build timings  <buildDir>
        6 edges, last built by 2 runs of ninja between 2026-01-02 03:04:05Z and 2026-01-02 04:04:07Z

      by kind                     edges    total  slowest
        rust_rustc                    3     4.0s     2.0s  rustc b
        link                          1     1.3s     1.3s  link exe
        dep_fetch                     1    100ms    100ms  fetch dep
        cc                            1     50ms     50ms  cc x.o

      slowest 6 edges
           2.0s  rustc b  dependents start after 200ms
                 LLVM_passes 1.6s · type_check_crate 170ms
           1.3s  link exe
           1.0s  rustc a  dependents start after 300ms
           1.0s  rustc root → libroot.a
          100ms  fetch dep
           50ms  cc x.o
                 Frontend 30ms · Backend 15ms

      critical path  4.7s  the longest chain: what a build of everything takes with every core free
        how long each step holds up the next; less than it runs when the next needs only an output it releases early
          100ms  fetch dep
          300ms  rustc a  of 1.0s
           2.0s  rustc b
           1.0s  rustc root → libroot.a
           1.3s  link exe

      most recent run of ninja  2026-01-02 04:04:05Z
        3.4s wall   2 edges   1.4s of commands   0.4× average parallelism

        low parallelism  2 commands or fewer for 1s or more
            0ms –   3.4s  (3.4s)  link exe, cc x.o

        waited to start  after every input existed: for the pool, or for a free job slot
           2.0s  pool compile (depth 2)          1 edge    longest 2.0s  cc x.o
           50ms  no pool                         1 edge    longest 50ms  link exe

      earlier runs still in the log  ninja drops an edge's older entries when it compacts the log
        2026-01-02 03:04:05Z      6 edges     3.9s wall
      "
    `);
  });
});

describe("chart", () => {
  test("a lane per kind of command, in build order; the critical path takes the top rows of its lanes", () => {
    const [second, first] = chartData(build).runs;
    const placed = (run: typeof first) =>
      run!.bars.map(b => [b.label, run!.lanes[b.lane]!.name, b.row, b.step, b.blocksNextForMs, b.released]);
    // Each bar names the bar it was waiting on, which is what a pinned bar's chain follows.
    expect(first!.bars.map(b => (b.blocker === undefined ? undefined : first!.bars[b.blocker]!.label))).toEqual([
      undefined,
      undefined,
      "fetch dep",
      "rustc a",
      "rustc b",
      "rustc root → libroot.a",
    ]);

    expect(second!.lanes).toEqual([
      { name: "C and C++", color: 0, rows: 1 },
      { name: "link and checks", color: 3, rows: 1 },
    ]);
    expect(placed(second)).toEqual([
      ["cc x.o", "C and C++", 0, undefined, undefined, undefined],
      ["link exe", "link and checks", 0, 4, 1300, undefined],
    ]);

    expect(first!.lanes).toEqual([
      { name: "dependencies", color: 2, rows: 1 },
      { name: "Rust", color: 1, rows: 2 },
      { name: "C and C++", color: 0, rows: 1 },
      { name: "link and checks", color: 3, rows: 1 },
    ]);
    expect(placed(first)).toEqual([
      ["fetch dep", "dependencies", 0, 0, 100, undefined],
      // Not on the path: x.o was last built by the second run.
      ["cc x.o", "C and C++", 0, undefined, undefined, undefined],
      ["rustc a", "Rust", 0, 1, 300, 300],
      // `a` is still running when `b` starts, so `b` is a row down: the staircase.
      ["rustc b", "Rust", 1, 2, 2000, 200],
      ["rustc root → libroot.a", "Rust", 0, 3, 1000, undefined],
      // Superseded by the second run's link, which is the one on the path.
      ["link exe", "link and checks", 0, undefined, undefined, undefined],
    ]);
    expect(first!.bars.find(b => b.label === "rustc b")!.phases).toEqual([
      ["LLVM_passes", 1600],
      ["type_check_crate", 170],
    ]);
  });

  test("the page carries its data and cannot be broken out of by a label", () => {
    const page = chartHtml(build);
    const data = /<script id="data" type="application\/json">(.*)<\/script>/.exec(page)![1]!;
    expect(data).not.toContain("<");
    expect(JSON.parse(data)).toEqual(JSON.parse(JSON.stringify(chartData(build))));
  });
});

describe("traceEvents", () => {
  test("a process per run, the most recent first; early releases and compiler phases inside their command", () => {
    const events = traceEvents(build);
    expect(events.filter(e => e.name === "process_name").map(e => [e.pid, e.args!.name])).toEqual([
      [0, "ninja 2026-01-02 04:04:05Z"],
      [1, "ninja 2026-01-02 03:04:05Z"],
    ]);
    const inFirstRun = events.filter(e => e.pid === 1 && e.ph === "X");
    const b = inFirstRun.find(e => e.name === "rustc b")!;
    expect(b).toMatchObject({ cat: "rust_rustc", ts: 412_000, dur: 2_000_000 });
    // `a` is still running when `b` starts, so they are on different rows.
    expect(b.tid).not.toBe(inFirstRun.find(e => e.name === "rustc a")!.tid);
    const insideB = inFirstRun.filter(e => e !== b && e.tid === b.tid && e.ts! >= b.ts! && e.ts! < b.ts! + b.dur!);
    expect(insideB.map(e => [e.name, e.ts, e.dur])).toEqual([
      ["until libb.rmeta is released", 412_000, 200_000],
      ["total", 420_000, 1_980_000],
      ["type_check_crate", 430_000, 170_000],
      ["LLVM_passes", 700_000, 1_600_000],
    ]);
  });
});
