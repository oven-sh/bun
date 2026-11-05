import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, isASAN, isCI, isDebug } from "harness";
import { createHash } from "node:crypto";
import path from "node:path";
import { run as runCommand } from "../../../../aot/harness/run";
import recorded from "./expected.json";

// Each fixture drives a node:http server through many small cases and prints what every case did: return values,
// thrown errors, events, the state of req and res, and the bytes on the wire. Cases with the same log share one entry.
// ./expected.json holds eight hexadecimal digits for each case, of its name and its log. A failure names the cases and shows
// what they did; what they did before is what a Bun from before the change prints.
//
//   NODE_HTTP_PROBES_UPDATE=1          rewrite ./expected.json from this build's output
//   NODE_HTTP_PROBES_REFERENCE=<exe>   compare with the output of another bun or node executable, case by case, and also run
//                                      every variant and NODE_HTTP_PROBES_SEEDS (default 20) seeds of the seeded fixtures
//   bun <fixture> <arguments> <text>   field-stores, odd-values and inside-listeners run only the cases whose name
//                                      contains the text

const timeout = (isASAN || isDebug) && !isCI ? 180_000 : undefined;
const reference = process.env.NODE_HTTP_PROBES_REFERENCE;
const seedCount = Number(process.env.NODE_HTTP_PROBES_SEEDS ?? 20);

async function run(executable: string, fixture: string, args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([
    executable,
    path.join(import.meta.dir, fixture + "-fixture.ts"),
    ...args,
  ]);
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

const digests: Record<string, string> = recorded;
const digestOf = (name: string, log: string) => createHash("sha1").update(`${name}\n${log}`).digest("hex").slice(0, 8);
afterAll(async () => {
  if (process.env.NODE_HTTP_PROBES_UPDATE)
    await Bun.write(
      path.join(import.meta.dir, "expected.json"),
      JSON.stringify(digests, Object.keys(digests).sort(), 1) + "\n",
    );
});

describe.concurrent("node:http behaves as recorded", () => {
  test.each(probes)(
    "%s %j",
    async (fixture, args, expectedName) => {
      const { stdout, stderr, exitCode } = await run(bunExe(), fixture, args);
      if (fixture !== "process-state" && fixture !== "listener-lists") expect(stderr).toBe("");
      const cases = [...parseCases(stdout)].map(([name, log]) => ({ name, log, digest: digestOf(name, log) }));
      if (process.env.NODE_HTTP_PROBES_UPDATE)
        digests[expectedName] = cases
          .map(each => each.digest)
          .sort()
          .join("");
      const expected = new Set(digests[expectedName]!.match(/.{8}/g));
      // How much of two large writes the socket has taken when write() returns is up to the kernel's buffers.
      const isUnsteady = (name: string) => /70000.*, write\(body\), write\(body\), end\(body\)$/.test(name);
      const changed = cases.filter(each => !expected.has(each.digest));
      const changedOrGone =
        expected.difference(new Set(cases.map(each => each.digest))).size -
        changed.filter(each => isUnsteady(each.name)).length;
      const changedOrNew = changed.filter(each => !isUnsteady(each.name)).map(({ name, log }) => ({ name, log }));
      // A method that is new has a case that is new.
      if (fixture !== "replaced-methods" || changedOrGone)
        expect({ changedOrNew, changedOrGone }).toEqual({ changedOrNew: [], changedOrGone: 0 });
      expect(exitCode).toBe(0);
    },
    timeout,
  );
});

const seeds = Array.from({ length: seedCount }, (_, index) => String(index + 1));
const referenceProbes: [fixture: string, args: string[]][] = [
  ...probes.map(([fixture, args]): [string, string[]] => [fixture, args]),
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
