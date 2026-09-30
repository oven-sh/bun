// The two lists of expectations.json: their one form, their checks against the corpus and against a run, the update that only adds, and what the lists lost since a revision.
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { utf8String } from "./gostrings";
import type { Outcome } from "./run";

// What a pass compared: every byte of the baseline, or its first section alone.
export type Level = "baseline" | "first-section";
// The list of an instance. E: its oracle has errors. C: its oracle has none.
export type Kind = "E" | "C";

export interface Expectations {
  // The comparison that every name of list E passed.
  level: Level;
  // Names of instances in the order of compareNames, each once and in one list.
  E: string[];
  C: string[];
}

// What the lists need to know of an instance.
export interface InstanceFacts {
  name: string;
  // The suite and the directories of the case below it: "compiler", "conformance/types/tuple".
  directory: string;
  // The path of the case below the cases of the corpus: "conformance/types/tuple/castingTuple.ts".
  casePath: string;
  // Anything but "run" is an instance that the reference does not run.
  status: "run" | "skipped" | "invalid";
  // Why the instance does not run; empty for one that runs.
  reason: string;
  // The class of the oracle; undefined for an instance that does not run.
  kind: Kind | undefined;
  // Why a platform of the test run cannot hold the files of the instance as they are; undefined when every platform can.
  platformLimited: string | undefined;
}

// What a run says of an instance.
export interface ResultFacts {
  name: string;
  status: Outcome;
  level: Level;
  // For what is no pass: the first difference, the stand-ins, the failure.
  detail: string;
}

// Why a list may not hold a name, or what a run says of a listed name that does not pass.
export type FailureReason =
  | "not-an-instance"
  | "not-run"
  | "wrong-list"
  | "platform-limited"
  | "quota"
  | "level"
  | Exclude<Outcome, "pass">;

export interface Failure {
  name: string;
  list: Kind;
  reason: FailureReason;
  detail: string;
}

// A text that is not the lists in their one form, or a revision whose lists cannot be read.
export class ExpectationsError extends Error {}

const kinds = ["E", "C"] as const;
// The weakest first: a pass at a level is a pass at every level before it.
const levels: readonly Level[] = ["first-section", "baseline"];
const rank = (level: Level) => levels.indexOf(level);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The order of UTF-16 code units: the order of the operator < on strings and of a sort without a comparator.
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// One name on a line, two spaces for a level, a line feed at the end.
export function formatExpectations(x: Expectations): string {
  return JSON.stringify({ level: x.level, E: x.E, C: x.C }, null, 2) + "\n";
}

// The names of one list: each a string, once, after the names that sort before it.
function namesOf(key: Kind, list: unknown): string[] {
  if (!Array.isArray(list)) throw new ExpectationsError(`${key} is not a list`);
  let previous: string | undefined;
  for (let k = 0; k < list.length; k++) {
    const name: unknown = list[k];
    if (typeof name !== "string" || name === "") throw new ExpectationsError(`${key}[${k}] is not a name`);
    if (previous === name) throw new ExpectationsError(`${key}[${k}]: ${JSON.stringify(name)} is there twice`);
    if (previous !== undefined && previous > name) {
      const after = `comes after ${JSON.stringify(previous)}`;
      throw new ExpectationsError(`${key}[${k}]: ${JSON.stringify(name)} ${after}: ${key} is not sorted by code units`);
    }
    previous = name;
  }
  return list as string[];
}

// The lists of a text in their one form. Any other text is refused, so that a change of the file shows names and nothing else.
export function parseExpectations(text: string): Expectations {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ExpectationsError(`not JSON: ${messageOf(error)}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ExpectationsError("the top level is not an object");
  }
  const keys = Object.keys(value);
  if (keys.length !== 3 || keys[0] !== "level" || keys[1] !== "E" || keys[2] !== "C") {
    throw new ExpectationsError(`the keys are ${JSON.stringify(keys)}: they must be level, E and C, in this order`);
  }
  const { level, E, C } = value as Record<string, unknown>;
  if (level !== "baseline" && level !== "first-section") {
    throw new ExpectationsError(`level is ${JSON.stringify(level)}: it must be one of ${levels.join(", ")}`);
  }
  const x: Expectations = { level, E: namesOf("E", E), C: namesOf("C", C) };
  const inE = new Set(x.E);
  for (const name of x.C) {
    if (inE.has(name)) throw new ExpectationsError(`${JSON.stringify(name)} is in both lists`);
  }
  if (formatExpectations(x) !== text) {
    throw new ExpectationsError(
      "the file is not in the form that the update writes: two spaces, one name per line, a line feed at the end",
    );
  }
  return x;
}

type Refusal = Pick<Failure, "reason" | "detail">;

const noInstance: Refusal = { reason: "not-an-instance", detail: "the corpus has no instance of this name" };

// Why a list may not hold the name of an instance, whatever a run says; undefined when it may.
function refusal(instance: InstanceFacts, list: Kind): Refusal | undefined {
  if (instance.status !== "run") {
    return { reason: "not-run", detail: `the instance is ${instance.status}: ${instance.reason}` };
  }
  if (instance.kind === undefined) return { reason: "wrong-list", detail: "the instance has no oracle" };
  if (instance.kind !== list) {
    const has = instance.kind === "E" ? "errors" : "no error";
    return { reason: "wrong-list", detail: `the oracle of the instance has ${has}: its list is ${instance.kind}` };
  }
  if (instance.platformLimited !== undefined) return { reason: "platform-limited", detail: instance.platformLimited };
  return undefined;
}

// The checks that need no run: every listed name is an instance that runs, of the class of its list, that every platform holds. Any other name is a failure and stays in its list.
export function checkLists(x: Expectations, instances: ReadonlyMap<string, InstanceFacts>): Failure[] {
  const out: Failure[] = [];
  for (const list of kinds) {
    for (const name of x[list]) {
      const instance = instances.get(name);
      const no = instance === undefined ? noInstance : refusal(instance, list);
      if (no !== undefined) out.push({ name, list, ...no });
    }
  }
  return out;
}

function countByDirectory(names: Iterable<string>, instances: ReadonlyMap<string, InstanceFacts>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) {
    const directory = instances.get(name)?.directory;
    if (directory !== undefined) counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  return counts;
}

// The names of list C above the quota of their directory. The quota is a rule of entry: a report shows these names, and no run fails on them.
export function overQuota(x: Expectations, instances: ReadonlyMap<string, InstanceFacts>): Failure[] {
  const out: Failure[] = [];
  const inE = countByDirectory(x.E, instances);
  const seen = new Map<string, number>();
  for (const name of x.C) {
    const directory = instances.get(name)?.directory;
    if (directory === undefined) continue;
    const n = (seen.get(directory) ?? 0) + 1;
    seen.set(directory, n);
    const most = inE.get(directory) ?? 0;
    if (n > most) {
      const detail = `list C has ${n} names of ${directory} and list E has ${most}`;
      out.push({ name, list: "C", reason: "quota", detail });
    }
  }
  return out;
}

// The listed names that a run did not pass. A name without an outcome was not in the run and says nothing.
export function verify(x: Expectations, outcomes: ReadonlyMap<string, ResultFacts>): Failure[] {
  const out: Failure[] = [];
  for (const list of kinds) {
    for (const name of x[list]) {
      const o = outcomes.get(name);
      if (o === undefined) continue;
      // An instance without errors has no baseline: its pass is the same at every level.
      const weaker = list === "E" && rank(o.level) < rank(x.level);
      const other = list === "E" && o.level !== x.level && o.status !== "pass";
      if (weaker || other) {
        const detail = `compared at level ${o.level}, the list records level ${x.level}: compare at that level`;
        out.push({ name, list, reason: "level", detail });
      } else if (o.status !== "pass") {
        out.push({ name, list, reason: o.status, detail: o.detail });
      }
    }
  }
  return out;
}

export interface Plan {
  // The lists with the names that enter. Every name of the lists before is there.
  next: Expectations;
  added: { E: string[]; C: string[] };
  // The names that pass, are not listed and may not enter.
  refused: Failure[];
}

// The names that pass and are not listed, and the lists with those of them that may enter. No name leaves a list, and the order is kept.
export function plan(
  x: Expectations,
  instances: ReadonlyMap<string, InstanceFacts>,
  outcomes: ReadonlyMap<string, ResultFacts>,
): Plan {
  const listed = new Set([...x.E, ...x.C]);
  const added = { E: [] as string[], C: [] as string[] };
  const refused: Failure[] = [];
  const candidates: { name: string; instance: InstanceFacts }[] = [];
  for (const [name, o] of [...outcomes].sort((a, b) => compareNames(a[0], b[0]))) {
    if (o.status !== "pass" || listed.has(name)) continue;
    const instance = instances.get(name);
    if (instance === undefined) {
      refused.push({ name, list: "C", ...noInstance });
      continue;
    }
    const list = instance.kind ?? "C";
    const no = refusal(instance, list);
    if (no !== undefined) {
      refused.push({ name, list, ...no });
    } else if (list === "C") {
      candidates.push({ name, instance });
    } else if (rank(o.level) < rank(x.level)) {
      const detail = `passes at level ${o.level}, the list records level ${x.level}`;
      refused.push({ name, list, reason: "level", detail });
    } else {
      added.E.push(name);
    }
  }
  const E = [...x.E, ...added.E].sort(compareNames);
  // A check that reports nothing passes every instance without errors: list C takes no more names of a directory than list E has.
  const left = countByDirectory(E, instances);
  for (const [directory, n] of countByDirectory(x.C, instances)) left.set(directory, (left.get(directory) ?? 0) - n);
  const casesOfE = new Set(E.map(name => instances.get(name)?.casePath));
  const known = (instance: InstanceFacts) => Number(casesOfE.has(instance.casePath));
  // An instance of a case that list E knows comes first, then the order of the names.
  candidates.sort((a, b) => known(b.instance) - known(a.instance) || compareNames(a.name, b.name));
  for (const { name, instance } of candidates) {
    const n = left.get(instance.directory) ?? 0;
    if (n > 0) {
      left.set(instance.directory, n - 1);
      added.C.push(name);
    } else {
      const detail = `list C may hold as many names of ${instance.directory} as list E holds`;
      refused.push({ name, list: "C", reason: "quota", detail });
    }
  }
  added.C.sort(compareNames);
  return { next: { level: x.level, E, C: [...x.C, ...added.C].sort(compareNames) }, added, refused };
}

// The text that follows a run: the names that pass and are not listed, with the one command that adds them.
export function reportText(p: Plan, command: string): string {
  const lines: string[] = [];
  const n = p.added.E.length + p.added.C.length;
  if (n > 0) {
    lines.push(`${n} instances pass and are not listed (E ${p.added.E.length}, C ${p.added.C.length}):`);
    for (const name of p.added.E) lines.push(`  E ${name}`);
    for (const name of p.added.C) lines.push(`  C ${name}`);
    lines.push("Add them with:", `  ${command}`);
  }
  if (p.refused.length > 0) {
    const by = new Map<string, number>();
    for (const r of p.refused) by.set(r.reason, (by.get(r.reason) ?? 0) + 1);
    const reasons = [...by].map(([reason, count]) => `${reason} ${count}`).join(", ");
    lines.push(`${p.refused.length} instances pass and may not enter a list: ${reasons}`);
  }
  return lines.join("\n");
}

// The options of sweep.ts that take a value: a copy of its set valued.
const valuedOptions: ReadonlySet<string> = new Set([
  "--bin",
  "--check",
  "--jobs",
  "--timeout",
  "--kind",
  "--tag",
  "--report",
  "--since",
  "--expectations",
  "--corpus",
]);

// sweep.ts as the current directory reaches it: the path from there when the script is below it, else the whole path.
function sweepScript(): string {
  const script = join(import.meta.dir, "..", "sweep.ts");
  const below = relative(process.cwd(), script);
  // A path that begins with "-" would be an option of bun.
  return /^(\.\.|-)/.test(below) || isAbsolute(below) ? script : below.split(sep).join("/");
}

// The command that reportText prints: the command line of the run with --update, quoted for a POSIX shell. It runs in the directory of the run, which the paths of argv start from: script is sweep.ts as that directory reaches it.
export function updateCommand(
  argv: readonly string[],
  binaryOfDefaultCheck?: string,
  script: string = sweepScript(),
  valued: ReadonlySet<string> = valuedOptions,
): string {
  const quote = (a: string) => (/^[A-Za-z0-9_\/.,:=@%+-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`);
  const rest: string[] = [];
  let namesTheCheck = false;
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    const name = a.split("=", 1)[0];
    namesTheCheck ||= name === "--bin" || name === "--check";
    if (a !== "--update") rest.push(a);
    // The token after an option that takes a value is that value and no option, whatever it reads.
    if (valued.has(a) && k + 1 < argv.length) rest.push(argv[++k]);
  }
  // The binary that ran the sweep may not be the one that runs the printed command.
  const bin = binaryOfDefaultCheck === undefined || namesTheCheck ? [] : ["--bin", binaryOfDefaultCheck];
  return ["bun", script, ...bin, ...rest, "--update"].map(quote).join(" ");
}

export interface Shrink {
  // The names that a list of the revision holds and no list holds now.
  removed: { name: string; list: Kind; stillAnInstance: boolean }[];
  // The names that the other list holds now.
  moved: { name: string; from: Kind; to: Kind }[];
  // True: list E of the revision has names and stood for a stronger comparison.
  levelLowered: boolean;
}

// What the lists lost since those of another revision: a list may grow and may not shrink. Undefined: that revision has no file.
export function compareWithRevision(
  current: Expectations,
  old: Expectations | undefined,
  instances: ReadonlyMap<string, InstanceFacts>,
): Shrink {
  const out: Shrink = { removed: [], moved: [], levelLowered: false };
  if (old === undefined) return out;
  out.levelLowered = old.E.length > 0 && rank(current.level) < rank(old.level);
  const now = { E: new Set(current.E), C: new Set(current.C) };
  for (const list of kinds) {
    const other = list === "E" ? "C" : "E";
    for (const name of old[list]) {
      if (now[list].has(name)) continue;
      if (now[other].has(name)) out.moved.push({ name, from: list, to: other });
      else out.removed.push({ name, list, stillAnInstance: instances.has(name) });
    }
  }
  return out;
}

// The lists that a revision of the repository holds at the path of the file; undefined when that revision has no such file.
export function expectationsAtRevision(revision: string, path: string): Expectations | undefined {
  const directory = dirname(path);
  const file = basename(path);
  const git = (...args: string[]) => {
    const ended = spawnSync("git", args, { cwd: directory, maxBuffer: 2 ** 28, windowsHide: true });
    if (ended.error !== undefined) {
      throw new ExpectationsError(`git did not start in ${directory}: ${ended.error.message}`);
    }
    return { ok: ended.status === 0, out: ended.stdout, said: ended.stderr.toString().trim().split("\n")[0] };
  };
  // A revision that git does not know must not read as a revision without the file.
  const commit = git("rev-parse", "--verify", "--quiet", `${revision}^{commit}`);
  const id = commit.out.toString().trim();
  if (!commit.ok || !/^[0-9a-f]{40,64}$/.test(id)) {
    const why = commit.said === "" ? "" : `: ${commit.said}`;
    throw new ExpectationsError(`${revision} is no revision of the repository of ${path}${why}`);
  }
  // "./" is the directory of the file, wherever the root of the repository is. Only a listing without an entry says that the revision has no such file.
  const listing = git("ls-tree", "-z", id, "--", `./${file}`);
  if (!listing.ok) throw new ExpectationsError(`${file} of ${revision} cannot be looked up: ${listing.said}`);
  if (listing.out.length === 0) return undefined;
  const entry = /^(\d+) (\w+) ([0-9a-f]+)\t/.exec(listing.out.toString());
  // The mode 120000 is a link, whose blob is the path of its target.
  if (entry === null || entry[2] !== "blob" || entry[1] === "120000") {
    throw new ExpectationsError(`${file} of ${revision} is no file`);
  }
  const content = git("cat-file", "blob", entry[3]);
  if (!content.ok) throw new ExpectationsError(`${file} of ${revision} cannot be read: ${content.said}`);
  try {
    return parseExpectations(utf8String(content.out, "the file"));
  } catch (error) {
    throw new ExpectationsError(`${file} of ${revision}: ${messageOf(error)}`);
  }
}

// The listed names that a run with a limit takes: all of them up to the limit, else names at even distances of E followed by C.
export function sampleListed(x: Expectations, limit: number): { name: string; list: Kind }[] {
  const all = [...x.E.map(name => ({ name, list: "E" as const })), ...x.C.map(name => ({ name, list: "C" as const }))];
  if (all.length <= limit) return all;
  const out: { name: string; list: Kind }[] = [];
  for (let k = 0; k < limit; k++) out.push(all[Math.floor((k * all.length) / limit)]);
  return out;
}
