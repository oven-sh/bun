import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug } from "harness";
import path from "node:path";

// Each fixture drives a node:http server through many small cases and prints what every case did: return values,
// thrown errors, events, the state of req and res, and the bytes on the wire. Cases with the same log share one entry.
// The output must match the file in ./expected.
//
//   NODE_HTTP_PROBES_UPDATE=1          rewrite ./expected from this build's output
//   NODE_HTTP_PROBES_REFERENCE=<exe>   also run every variant and NODE_HTTP_PROBES_SEEDS (default 20) seeds of the
//                                      seeded fixtures, and compare with the output of another bun or node executable
//   bun <fixture> <arguments> <text>   field-stores, odd-values and inside-listeners run only the cases whose name
//                                      contains the text

const timeout = (isASAN || isDebug) && !isCI ? 180_000 : undefined;
const reference = process.env.NODE_HTTP_PROBES_REFERENCE;
const seedCount = Number(process.env.NODE_HTTP_PROBES_SEEDS ?? 20);

async function run(executable: string, fixture: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [executable, path.join(import.meta.dir, fixture + "-fixture.ts"), ...args],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function parseCases(output: string) {
  const cases = new Map<string, string>();
  let names: string[] = [];
  let log = "";
  const flush = () => {
    for (const name of names) cases.set(name, log);
    names = [];
    log = "";
  };
  for (const line of output.split("\n")) {
    if (line.startsWith("    ")) {
      log += line.slice(4) + "\n";
    } else if (line) {
      if (log) flush();
      names.push(line);
    }
  }
  flush();
  return cases;
}

function differences(actualOutput: string, expectedOutput: string) {
  const actual = parseCases(actualOutput);
  const expected = parseCases(expectedOutput);
  const names = new Set([...expected.keys(), ...actual.keys()]);
  return [...names]
    .filter(name => actual.get(name) !== expected.get(name))
    .map(name => ({ name, expected: expected.get(name), actual: actual.get(name) }));
}

const processStates = [
  "unchanged",
  "status-codes",
  "status-codes-changed-later",
  "prototype-defaults",
  "prototype-send-date",
  "replaced-validators",
  "empty-methods",
  "max-header-size",
  "replaced-emit-warning",
  "default-max-listeners-1",
  "default-max-listeners-0",
  "capture-rejections",
  "default-high-water-mark-1",
  "default-high-water-mark-changed-later",
  "throw-deprecation",
  "stack-trace-limit-0",
  "prepare-stack-trace",
  "replaced-date",
  "server-subclass",
  "empty-server-subclass",
  "server-called-without-new",
  "server-with-another-prototype",
  "two-servers",
  "two-servers-with-joined-headers",
];

type Probe = [fixture: string, args: string[], expected: string];

const probes: Probe[] = [
  ...["before", "after", "microtask", "between"].map((moment): Probe => [
    "field-stores",
    [moment, "none"],
    `field-stores-${moment}`,
  ]),
  ["field-stores", ["before", "both"], "field-stores-before"],
  ["field-stores", ["after", "both"], "field-stores-after"],
  ["odd-values", ["none"], "odd-values"],
  ["odd-values", ["both"], "odd-values"],
  ["inside-listeners", ["all", "none"], "inside-listeners-all-none"],
  ["inside-listeners", ["none", "none"], "inside-listeners-none-none"],
  ["inside-listeners", ["none", "removed"], "inside-listeners-none-removed"],
  ["listener-lists", ["no-ticks", "none"], "listener-lists-no-ticks-none"],
  ["listener-lists", ["ticks", "none"], "listener-lists-ticks-none"],
  ["listener-lists", ["no-ticks", "removed"], "listener-lists-no-ticks-removed"],
  ["outgoing-bodies", ["none"], "outgoing-bodies"],
  ["outgoing-bodies", ["response"], "outgoing-bodies"],
  ["replaced-methods", ["socket"], "replaced-methods-socket"],
  ["replaced-methods", ["request"], "replaced-methods-request"],
  ["replaced-methods", ["response"], "replaced-methods-response"],
  ["replaced-methods", ["server"], "replaced-methods-server"],
  ...[
    ["1", "35", "all"],
    ["2", "35", "all"],
    ["1", "35", "plain"],
    ["2", "35", "common"],
    ["3", "35", "common", "default", "response"],
    ["4", "35", "all", "unique-headers"],
    ["5", "35", "all", "join-duplicate-headers"],
    ["6", "35", "all", "insecure-parser"],
    ["7", "35", "all", "reject-non-standard-body-writes"],
  ].map((args): Probe => ["header-storm", args, "header-storm-" + args.join("-")]),
  ...processStates.map((state): Probe => ["process-state", [state], "process-state-" + state]),
  ["process-state", ["worker"], "process-state-unchanged"],
  ...["1", "2", "3"].map((seed): Probe => ["incoming-heads", [seed, "40"], "incoming-heads-" + seed]),
  ...["1", "2", "3"].map((seed): Probe => ["mixed-requests", [seed, "40"], "mixed-requests-" + seed]),
  ...["pipe", "pipeline", "collect"].flatMap(forwarding =>
    ["all", "none"].flatMap(observers =>
      ["keep-alive", "fresh"].map((agent): Probe => [
        "reverse-proxy",
        [forwarding, observers, agent],
        `reverse-proxy-${forwarding}-${observers}-${agent}`,
      ]),
    ),
  ),
];

describe.concurrent("node:http behaves as recorded", () => {
  test.each(probes)(
    "%s %j",
    async (fixture, args, expectedName) => {
      const expectedFile = Bun.file(path.join(import.meta.dir, "expected", expectedName + ".txt"));
      const { stdout, stderr, exitCode } = await run(bunExe(), fixture, args);
      if (fixture !== "process-state" && fixture !== "listener-lists") expect(stderr).toBe("");
      if (process.env.NODE_HTTP_PROBES_UPDATE) await Bun.write(expectedFile, stdout);
      const found = differences(stdout, await expectedFile.text());
      const isNewMethod = (difference: { expected?: string }) =>
        fixture === "replaced-methods" && difference.expected === undefined;
      expect(found.filter(difference => !isNewMethod(difference))).toEqual([]);
      expect(exitCode).toBe(0);
    },
    timeout,
  );
});

const seeds = Array.from({ length: seedCount }, (_, index) => String(index + 1));
const referenceProbes: [fixture: string, args: string[]][] = [
  ...["all", "response", "none"].flatMap(observers =>
    ["none", "data", "removed", "resume", "await"].map((body): [string, string[]] => [
      "inside-listeners",
      [observers, body],
    ]),
  ),
  ...seeds.flatMap(seed => [
    ...["all", "common", "plain"].flatMap(names =>
      ["none", "response"].map((listeners): [string, string[]] => [
        "header-storm",
        [seed, "35", names, "default", listeners],
      ]),
    ),
    ["incoming-heads", [seed, "80"]] as [string, string[]],
    ["mixed-requests", [seed, "60"]] as [string, string[]],
  ]),
];

describe.skipIf(!reference).concurrent("node:http behaves like the reference executable", () => {
  test.each(referenceProbes)(
    "%s %j",
    async (fixture, args) => {
      const [actual, expected] = await Promise.all([run(bunExe(), fixture, args), run(reference!, fixture, args)]);
      expect(differences(actual.stdout, expected.stdout)).toEqual([]);
      expect(actual.exitCode).toBe(expected.exitCode);
    },
    timeout,
  );
});
