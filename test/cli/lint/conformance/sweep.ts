// The sweep: the instances of the corpus through a check, the pass counts by directory and by diagnostic code, the lists of expectations.json and a report file.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Check,
  type Expectations,
  type InputResult,
  type Instance,
  type InstanceFacts,
  type Kind,
  type ResultFacts,
  type RunResult,
  checkLists,
  compareWithRevision,
  expectationsAtRevision,
  formatExpectations,
  outcomes,
  parseExpectations,
  plan,
  reportText,
  runInstances,
  updateCommand,
  verify,
} from "./runner";
import { createSpawnCheck } from "./runner/check_bun_lint";
import { type EnumeratedInstance, enumerateCase } from "./runner/compiler_runner";
import { tsgoRules } from "./runner/diagnosticwriter";
import {
  type CompilerTest,
  type InstanceInput,
  type Platform,
  findObstacles,
  instanceInput,
  makeTemporaryDirectory,
} from "./runner/materialise";
import { type Oracle, type OracleTable, diffRootOf, loadOracleTable, oracleOf, readOracle } from "./runner/oracle";
import { type CorpusPaths, corpusPaths, suites } from "./runner/paths";
import { readErrorBaseline } from "./runner/reader";
import { type BaselineFile, listErrorBaselines, roundTripFiles, roundTripReportLines } from "./runner/roundtrip";
import { type TestUnit, parseTestFilesAndSymlinks } from "./runner/test_case_parser";
import { readFile } from "./runner/vfs";

const usage = `usage: bun test/cli/lint/conformance/sweep.ts [options] [selector ...]

An instance is swept when one selector takes it. Without a selector every instance is swept.
  compiler/   conformance/types/tuple/    a directory of the cases with everything below it; it ends in "/"
  conformance/types/tuple/castingTuple.ts the instances of the case at that path
  castingTuple.ts                         the instances of the case with that file name, and the instance of that name
  "abstractProperty(target=es2015).ts"    the instance of that name
  "abstract*"                             the instances whose name matches; "*" stands for any characters

  --bin <path>           binary under test of the default check, which runs it with --lint and the files of an
                         instance (default: the binary that runs this script)
  --check <module>       module whose default export is a check; it replaces the default check
  --no-files             write no instance to disk; with --check, for a check that reads the units of its input
  --jobs <n>             instances in flight (default: the number of processors)
  --timeout <ms>         limit of one instance (default: 60000)
  --listed               only the instances that expectations.json lists
  --kind <E|C>           only the instances whose oracle has errors (E) or has none (C)
  --tag <tag>            only the instances with that tag: accepted, triaged
  --update               add to expectations.json the names that pass, are not listed and may enter; no name leaves
  --report <path>        file of the report (default: lint-conformance-report.json in the temporary directory)
  --since <revision>     compare the lists with those of that revision: a name that left its list fails, unless the
                         list may not hold it any more: the corpus has no instance of that name, or one that does
                         not run, that is of the other class or that a platform of the test run cannot hold
  --no-run               run no instance: check the lists against the corpus, and --since
  --round-trip           run no instance: read every error baseline of the corpus and write it again from what was read
  --expectations <path>  the lists (default: expectations.json beside this script)
  --corpus <directory>   the corpus (default: corpus beside this script)
  -h, --help

Exit code 0: every listed instance of the selection passes and no name left a list that may hold it; with --round-trip,
every error baseline is written back with its bytes. 1: not so. 2: the command line is wrong, or the corpus, the lists,
the module of the check or the file of the report cannot be used.`;

const tags = ["accepted", "triaged"] as const;
type Tag = (typeof tags)[number];

interface Options {
  selectors: string[];
  bin: string | undefined;
  check: string | undefined;
  files: boolean;
  jobs: number | undefined;
  timeoutMs: number;
  listed: boolean;
  kind: Kind | undefined;
  tag: Tag | undefined;
  update: boolean;
  report: string | undefined;
  since: string | undefined;
  run: boolean;
  roundTrip: boolean;
  expectations: string | undefined;
  corpus: string | undefined;
  help: boolean;
}

// The command line is wrong: the usage follows the message.
class UsageError extends Error {}
// A file that the sweep reads or writes is not there or is not what it has to be.
class FileError extends Error {}

const valued = new Set([
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
// The options that say how instances are run and what becomes of their outcomes.
const ofARun = ["--bin", "--check", "--no-files", "--jobs", "--timeout", "--update", "--report"];

function parseArgs(argv: readonly string[]): Options {
  const o: Options = {
    selectors: [],
    bin: undefined,
    check: undefined,
    files: true,
    jobs: undefined,
    timeoutMs: 60_000,
    listed: false,
    kind: undefined,
    tag: undefined,
    update: false,
    report: undefined,
    since: undefined,
    run: true,
    roundTrip: false,
    expectations: undefined,
    corpus: undefined,
    help: false,
  };
  const seen = new Set<string>();
  for (let k = 0; k < argv.length; k++) {
    let name = argv[k];
    if (!name.startsWith("-") || name === "-") {
      if (name === "") throw new UsageError("an empty selector");
      o.selectors.push(name);
      continue;
    }
    let value: string | undefined;
    const eq = name.indexOf("=");
    if (name.startsWith("--") && eq > 0) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (seen.has(name)) throw new UsageError(`${name} is given twice`);
    seen.add(name);
    if (valued.has(name)) {
      if (value === undefined) {
        if (k + 1 >= argv.length) throw new UsageError(`${name} needs a value`);
        value = argv[++k];
      }
      if (value === "") throw new UsageError(`${name} needs a value`);
    } else if (value !== undefined) {
      throw new UsageError(`${name} takes no value`);
    }
    const count = (): number => {
      const n = Number(value);
      if (!/^[0-9]+$/.test(value!) || n < 1 || !Number.isSafeInteger(n)) {
        throw new UsageError(`${name} ${value}: not a whole number of at least 1`);
      }
      return n;
    };
    switch (name) {
      case "--bin":
        o.bin = value;
        break;
      case "--check":
        o.check = value;
        break;
      case "--no-files":
        o.files = false;
        break;
      case "--jobs":
        o.jobs = count();
        break;
      case "--timeout":
        o.timeoutMs = count();
        break;
      case "--listed":
        o.listed = true;
        break;
      case "--kind":
        if (value !== "E" && value !== "C") throw new UsageError(`--kind ${value}: E or C`);
        o.kind = value;
        break;
      case "--tag":
        if (!tags.includes(value as Tag)) throw new UsageError(`--tag ${value}: one of ${tags.join(", ")}`);
        o.tag = value as Tag;
        break;
      case "--update":
        o.update = true;
        break;
      case "--report":
        o.report = value;
        break;
      case "--since":
        o.since = value;
        break;
      case "--no-run":
        o.run = false;
        break;
      case "--round-trip":
        o.roundTrip = true;
        break;
      case "--expectations":
        o.expectations = value;
        break;
      case "--corpus":
        o.corpus = value;
        break;
      case "-h":
      case "--help":
        o.help = true;
        break;
      default:
        throw new UsageError(`unknown option ${name}`);
    }
  }
  if (o.help) return o;
  if (o.roundTrip) {
    const others = [...seen].filter(name => name !== "--round-trip" && name !== "--corpus");
    if (others.length > 0 || o.selectors.length > 0) {
      throw new UsageError("--round-trip reads every error baseline and nothing else: only --corpus goes with it");
    }
    return o;
  }
  if (o.bin !== undefined && o.check !== undefined) {
    throw new UsageError("--bin belongs to the default check: it cannot go with --check");
  }
  if (!o.files && o.check === undefined) {
    throw new UsageError("--no-files needs --check: the default check starts a command, which reads files");
  }
  const useless = o.run ? [] : ofARun.filter(name => seen.has(name));
  if (useless.length > 0) throw new UsageError(`--no-run runs no instance: ${useless.join(", ")} cannot go with it`);
  return o;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// What a run takes of an instance that the reference compiles.
interface RunInstance extends Instance {
  // The path of the case below the cases of the corpus: "conformance/types/tuple/castingTuple.ts".
  casePath: string;
  // The settings of the instance: those of the case with the values of its variation; undefined for a case without a setting.
  config: EnumeratedInstance["config"];
  oracle: Oracle;
}

// What the lists need to know of an instance, what --tag selects by, and what a run takes of it.
interface Fact extends InstanceFacts {
  tags: readonly Tag[];
  // Absent for an instance that does not run.
  run?: RunInstance;
}

// "a(target=es2015).ts" is an instance of the case "a.ts".
function caseBaseName(instanceName: string): string {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(instanceName);
  return m === null ? instanceName : m[1] + m[3];
}

function directoryOf(casePath: string): string {
  return casePath.slice(0, casePath.lastIndexOf("/"));
}

// The paths of the cases below the directory of the cases, with forward slashes, in the order of their code units.
function listCases(casesDirectory: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(`${casesDirectory}/${rel}`, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
      else if (/\.tsx?$/.test(entry.name)) out.push(`${rel}/${entry.name}`);
    }
  };
  for (const suite of suites) walk(suite);
  return out.sort();
}

// An instance of the enumerator with what the baselines and the two lists of typescript-go say of it.
function factOf(enumerated: EnumeratedInstance, casePath: string, table: OracleTable, paths: CorpusPaths): Fact {
  const { name, suite } = enumerated;
  const diff = diffRootOf(table, suite, name);
  const tagged = { name, directory: directoryOf(casePath), casePath, tags: tags.filter(tag => diff[tag]) };
  // No list may hold an instance that does not run, whatever a platform makes of its files.
  const notRun = { ...tagged, kind: undefined, platformLimited: undefined };
  if (enumerated.status === "skip") return { ...notRun, status: "skipped", reason: enumerated.skipReason ?? "" };
  // The reference fails an instance whose diff is in both lists, as it fails one that it cannot set up.
  const stops = enumerated.status === "invalid" ? (enumerated.invalidReason ?? "") : diff.fatal;
  if (stops !== undefined) return { ...notRun, status: "invalid", reason: stops };
  const oracle = oracleOf(table, suite, name);
  const run: RunInstance = { name, status: "run", casePath, config: enumerated.config, oracle };
  let limited: { why: string | undefined } | undefined;
  return {
    ...tagged,
    status: "run",
    reason: "",
    kind: oracle.class,
    run,
    // Only the rules of the lists read it: an instance that a list holds, held or may take is laid out for it, once.
    get platformLimited() {
      return (limited ??= { why: platformLimitedOf(paths, run) }).why;
    },
  };
}

// What a check gets of an instance with the test that its files are written from, or why the instance cannot be laid out.
type Layout = { ok: true; input: InstanceInput; test: CompilerTest } | { ok: false; reason: string };

// The files of an instance as the harness lays them out; with a root they are written below it.
function layOut(paths: CorpusPaths, instance: RunInstance, root: string | undefined): Layout {
  const filename = `${paths.cases}/${instance.casePath}`;
  const read = readFile(filename);
  if (!read.ok) return { ok: false, reason: `the case cannot be read: ${filename}` };
  const units = parseTestFilesAndSymlinks<TestUnit>(read.contents, filename, (unitName, content) => ({
    value: { name: unitName, content },
    error: undefined,
  }));
  if (!units.ok) return { ok: false, reason: units.reason };
  const made = instanceInput(units, instance.config, root, { libDirectory: paths.lib });
  if (made.ok) return { ok: true, input: made.input, test: made.test };
  return {
    ok: false,
    reason: made.status === "invalid" ? `the reference fails the instance: ${made.reason}` : made.reason,
  };
}

// The input of the check of an instance; with a root its files are written below it, and the run removes them.
function inputOf(paths: CorpusPaths, instance: RunInstance, root: string | undefined): InputResult {
  const laid = layOut(paths, instance, root);
  return laid.ok ? { ok: true, input: laid.input } : laid;
}

// The disks of the platforms of the test run, whichever of them runs the sweep; Windows without the right to link to a file.
const testPlatforms: readonly Platform[] = [
  { os: "linux", caseSensitive: true, preservesNames: true, fileLinks: true },
  { os: "darwin", caseSensitive: false, preservesNames: false, fileLinks: true },
  { os: "win32", caseSensitive: false, preservesNames: true, fileLinks: false },
];

// Why a platform of the test run cannot hold the files of an instance that runs: the first obstacle of the first such platform. Undefined: every platform holds them.
function platformLimitedOf(paths: CorpusPaths, instance: RunInstance): string | undefined {
  let laid: Layout;
  try {
    laid = layOut(paths, instance, undefined);
  } catch (error) {
    laid = { ok: false, reason: `the files cannot be laid out: ${messageOf(error)}` };
  }
  if (!laid.ok) return `every platform: ${laid.reason}`;
  for (const platform of testPlatforms) {
    const [first] = findObstacles(laid.test, platform);
    if (first !== undefined) return `${platform.os}: ${first.reason}${first.detail === "" ? "" : `: ${first.detail}`}`;
  }
  return undefined;
}

function matcher(selector: string): (fact: Fact) => boolean {
  if (selector.includes("*")) {
    const parts = selector.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`^${parts.join(".*")}$`, "s");
    return fact => pattern.test(fact.name);
  }
  if (selector.endsWith("/")) return fact => `${fact.directory}/`.startsWith(selector);
  if (selector.includes("/")) return fact => fact.casePath === selector;
  return fact => fact.name === selector || fact.casePath.endsWith(`/${selector}`);
}

interface Selection {
  taken: Fact[];
  // The selectors that took no instance.
  empty: string[];
}

function select(all: Iterable<Fact>, o: Options, listed: ReadonlySet<string>): Selection {
  const matchers = o.selectors.map(selector => ({ selector, matches: matcher(selector), taken: 0 }));
  const taken: Fact[] = [];
  for (const fact of all) {
    let selected = matchers.length === 0;
    for (const m of matchers) {
      if (!m.matches(fact)) continue;
      m.taken++;
      selected = true;
    }
    if (!selected) continue;
    if (o.listed && !listed.has(fact.name)) continue;
    if (o.kind !== undefined && fact.kind !== o.kind) continue;
    if (o.tag !== undefined && !fact.tags.includes(o.tag)) continue;
    taken.push(fact);
  }
  return { taken, empty: matchers.filter(m => m.taken === 0).map(m => m.selector) };
}

// Cuts a directory to the deepest level that leaves at most 60 groups: for the whole corpus, a suite and one directory below it.
function cutOf(directories: readonly string[]): (directory: string) => string {
  const cut = (depth: number) => (directory: string) => directory.split("/").slice(0, depth).join("/");
  const deepest = Math.max(1, ...directories.map(directory => directory.split("/").length));
  let depth = 1;
  while (depth < deepest && new Set(directories.map(cut(depth + 1))).size <= 60) depth++;
  return cut(depth);
}

// Instances that pass, and instances.
type Cell = [pass: number, all: number];

interface Row {
  E: Cell;
  C: Cell;
}

// The instances that ran by a key of theirs, each with the class of its oracle, in the order of the keys.
function rowsBy(ran: readonly Fact[], passes: (fact: Fact) => boolean, key: (fact: Fact) => string): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const fact of ran) {
    let row = out.get(key(fact));
    if (row === undefined) out.set(key(fact), (row = { E: [0, 0], C: [0, 0] }));
    const cell = row[fact.kind!];
    cell[1]++;
    if (passes(fact)) cell[0]++;
  }
  return new Map([...out].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

interface CodeCount {
  // Instances whose oracle has the code, and those of them that pass.
  instances: number;
  pass: number;
  // Diagnostics with the code in the oracles of those instances.
  diagnostics: number;
}

function countBy<T>(all: Iterable<T>, key: (x: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const x of all) counts.set(key(x), (counts.get(key(x)) ?? 0) + 1);
  return counts;
}

// The most frequent first; keys that are as frequent in the order of their code units.
function mostFirst(counts: ReadonlyMap<string, number>): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

// Every error baseline of the corpus read and written again from what was read: the whole of what the test file samples.
function roundTripCorpus(corpusRoot: string): number {
  const paths = corpusPaths(corpusRoot);
  // The corpus has no directory for a suite where no baseline of typescript-go differs from TypeScript's.
  const differing = suites.map(suite => paths.typescriptGoBaselines[suite]).filter(directory => existsSync(directory));
  let files: BaselineFile[];
  try {
    files = [
      ...listErrorBaselines(paths.typescriptBaselines, "typescript"),
      ...differing.flatMap(directory => listErrorBaselines(directory, "typescript-go")),
    ];
  } catch (error) {
    throw new FileError(`the error baselines of the corpus at ${corpusRoot} cannot be listed: ${messageOf(error)}`);
  }
  if (files.length === 0) throw new FileError(`the corpus at ${corpusRoot} has no error baseline`);
  const report = roundTripFiles(files);
  for (const line of roundTripReportLines(report)) console.log(line);
  console.log(`${report.same} of ${report.files} error baselines are the same bytes after a read and a write`);
  return report.same === report.files ? 0 : 1;
}

interface NamedCheck {
  check: Check;
  // What the sweep prints for the check: the command of the default check, or the path of the module.
  name: string;
  // The binary under test of the default check.
  binary: string | undefined;
}

// The check of --check, or the default one: it starts the binary with --lint and the files of an instance, after a probe.
async function checkOf(o: Options): Promise<NamedCheck> {
  if (o.check === undefined) {
    const binary = resolve(o.bin ?? process.execPath);
    if (!existsSync(binary)) throw new FileError(`--bin ${binary}: no such file`);
    return { check: createSpawnCheck({ command: [binary], env: process.env }), name: `${binary} --lint`, binary };
  }
  const path = resolve(o.check);
  let module: { default?: unknown };
  try {
    module = await import(pathToFileURL(path).href);
  } catch (error) {
    throw new FileError(`--check ${path}: ${messageOf(error)}`);
  }
  if (typeof module.default !== "function") {
    throw new FileError(`--check ${path}: the default export of the module is no function`);
  }
  return { check: module.default as Check, name: path, binary: undefined };
}

async function main(argv: readonly string[]): Promise<number> {
  const started = performance.now();
  const o = parseArgs(argv);
  if (o.help) {
    console.log(usage);
    return 0;
  }
  const corpusRoot = resolve(o.corpus ?? join(import.meta.dir, "corpus"));
  if (o.roundTrip) return roundTripCorpus(corpusRoot);

  const expectationsPath = resolve(o.expectations ?? join(import.meta.dir, "expectations.json"));
  let lists: Expectations;
  try {
    lists = parseExpectations(readFileSync(expectationsPath, "utf8"));
  } catch (error) {
    throw new FileError(`${expectationsPath}: ${messageOf(error)}`);
  }
  const listed = new Set([...lists.E, ...lists.C]);
  // What can end the sweep with the exit code 2 comes before the corpus is read: the revision, the check, the place of the report.
  let old: Expectations | undefined;
  try {
    if (o.since !== undefined) old = expectationsAtRevision(o.since, expectationsPath);
  } catch (error) {
    throw new FileError(`--since: ${messageOf(error)}`);
  }
  // The names that are not in their list of the revision any more: their cases are read, to say what the corpus holds of them now.
  const displaced = (["E", "C"] as const).flatMap(list => {
    const now = new Set(lists[list]);
    return (old?.[list] ?? []).filter(name => !now.has(name));
  });
  const reportPath = resolve(o.report ?? join(tmpdir(), "lint-conformance-report.json"));
  let checked: NamedCheck | undefined;
  if (o.run) {
    checked = await checkOf(o);
    try {
      mkdirSync(dirname(reportPath), { recursive: true });
    } catch (error) {
      throw new FileError(`--report ${reportPath}: ${messageOf(error)}`);
    }
  }
  const paths = corpusPaths(corpusRoot);
  let cases: string[];
  let table: OracleTable;
  try {
    cases = listCases(paths.cases);
    table = loadOracleTable(paths);
  } catch (error) {
    throw new FileError(`the corpus at ${corpusRoot} cannot be read: ${messageOf(error)}`);
  }
  // The name of an instance says which case it is of: the reference, too, stops where two cases have one name.
  const byBaseName = new Map<string, string>();
  for (const path of cases) {
    const base = path.slice(path.lastIndexOf("/") + 1);
    const other = byBaseName.get(base);
    if (other !== undefined) throw new FileError(`the corpus has two cases of one name: ${other} and ${path}`);
    byBaseName.set(base, path);
  }
  const caseOf = (name: string) => byBaseName.get(name) ?? byBaseName.get(caseBaseName(name));

  // Only the cases that a selector can take an instance of are read; a pattern is for the names of instances, which no case has before it is read.
  const whole = o.selectors.length === 0;
  let reached: readonly string[] = cases;
  if (whole ? o.listed : !o.selectors.some(selector => selector.includes("*"))) {
    const wanted = new Set<string | undefined>((whole ? [...listed, ...displaced] : displaced).map(caseOf));
    for (const selector of o.selectors) {
      if (!selector.endsWith("/")) wanted.add(selector.includes("/") ? selector : caseOf(selector));
      else for (const path of cases) if (path.startsWith(selector)) wanted.add(path);
    }
    reached = cases.filter(path => wanted.has(path));
  }
  const read = new Set(reached);
  const facts = new Map<string, Fact>();
  for (const casePath of reached) {
    for (const enumerated of enumerateCase(paths.cases, casePath)) {
      facts.set(enumerated.name, factOf(enumerated, casePath, table, paths));
    }
  }
  const selection = select(facts.values(), o, listed);
  if (selection.empty.length > 0) {
    const isDirectory = (selector: string) => cases.some(path => path.startsWith(`${selector}/`));
    const said = selection.empty.map(s => (isDirectory(s) ? `${s} (a directory ends in "/")` : s));
    throw new UsageError(`no instance for ${said.join(", ")}`);
  }
  const selected = selection.taken;
  const ran = selected.filter(fact => fact.status === "run");
  const ranE = ran.filter(fact => fact.kind === "E");
  const ranC = ran.filter(fact => fact.kind === "C");

  const text: string[] = [];
  // console.log has written its line when it returns; what process.stdout still holds for a pipe is lost at process.exit.
  const say = (line = "") => {
    text.push(line);
    console.log(line);
  };
  const notRun = countBy(
    selected.filter(fact => fact.status !== "run"),
    // The value of these two options is a path of the case.
    fact => `${fact.status}: ${fact.reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/s, "$1")}`,
  );
  const invalid = selected.filter(fact => fact.status === "invalid").length;
  const skipped = selected.length - ran.length - invalid;
  const counts = [`run ${ran.length} (E ${ranE.length}, C ${ranC.length})`, `skipped ${skipped}`];
  if (invalid > 0) counts.push(`invalid ${invalid}`);
  say(`instances ${selected.length}: ${counts.join(", ")}`);
  for (const [reason, n] of mostFirst(notRun)) say(`  ${String(n).padStart(6)}  ${reason}`);

  // What needs no run: every listed name is an instance that runs, whose oracle is of the class of its list and whose files every platform of the test run holds.
  const inScope = (name: string) => whole || read.has(caseOf(name) ?? "");
  const scoped: Expectations = { ...lists, E: lists.E.filter(inScope), C: lists.C.filter(inScope) };
  const notInstances = checkLists(scoped, facts);
  for (const f of notInstances) say(`  FAIL ${f.list} ${f.name}: ${f.reason}: ${f.detail}`);
  // A list may grow and may not shrink; a name that its list may not hold any more had to leave it.
  const shrink = compareWithRevision(lists, old, facts);
  const leavers = [
    ...shrink.removed.map(r => ({ name: r.name, from: r.list, went: `left ${r.list}` })),
    ...shrink.moved.map(m => ({ name: m.name, from: m.from, went: `moved from ${m.from} to ${m.to}` })),
  ];
  const leftFrom = (list: Kind) => leavers.filter(l => l.from === list).map(l => l.name);
  // What the list that a name left has against the name now; no entry where that list could still hold it.
  const against = new Map<string, string>();
  for (const f of checkLists({ level: lists.level, E: leftFrom("E"), C: leftFrom("C") }, facts)) {
    against.set(f.name, `${f.reason}: ${f.detail}`);
  }
  const losses = [
    ...leavers.filter(l => !against.has(l.name)).map(l => `${l.name} ${l.went}`),
    ...(shrink.levelLowered ? [`the level was ${old?.level} and is ${lists.level}`] : []),
  ];
  if (o.since !== undefined && old === undefined) {
    say(`${o.since} has no ${basename(expectationsPath)}: no name can have left it`);
  }
  for (const l of leavers.filter(l => against.has(l.name))) {
    say(`  since ${o.since}: ${l.name} ${l.went}; ${l.from} may not hold it: ${against.get(l.name)}`);
  }
  for (const loss of losses) say(`  FAIL since ${o.since}: ${loss}`);
  if (checked === undefined) return notInstances.length > 0 || losses.length > 0 ? 1 : 0;

  say(`check ${checked.name}`);
  const directory = o.files && ran.length > 0 ? makeTemporaryDirectory("bun-lint-sweep-") : undefined;
  let results: RunResult[];
  try {
    let done = 0;
    results = await runInstances(
      ran.map(fact => fact.run!),
      checked.check,
      {
        input: (instance, root) => inputOf(paths, instance as RunInstance, root),
        oracle: instance => readOracle((instance as RunInstance).oracle),
        directory,
        concurrency: o.jobs ?? availableParallelism(),
        timeoutMs: o.timeoutMs,
        onResult() {
          done++;
          if (!process.stderr.isTTY) {
            if (done % 2000 === 0) console.error(`${done} of ${ran.length}`);
          } else if (done % 50 === 0 || done === ran.length) {
            process.stderr.write(`\r${done} of ${ran.length}${done === ran.length ? "\n" : ""}`);
          }
        },
      },
    );
  } finally {
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }

  const resultOf = new Map(results.map(r => [r.instance.name, r]));
  const passes = (fact: Fact) => resultOf.get(fact.name)!.outcome === "pass";
  const cellOf = (all: readonly Fact[]): Cell => [all.filter(passes).length, all.length];
  const ratio = ([pass, all]: Cell) => `${pass} of ${all}`;
  // The two classes are never one number: a check that reports nothing passes every instance of C and none of E.
  say(`pass: E ${ratio(cellOf(ranE))}, C ${ratio(cellOf(ranC))}`);
  const outcomesOf = (all: readonly Fact[]) => {
    const counted = countBy(all, fact => resultOf.get(fact.name)!.outcome);
    return outcomes.filter(outcome => counted.has(outcome)).map(outcome => [outcome, counted.get(outcome)!] as const);
  };
  const byOutcome = { E: outcomesOf(ranE), C: outcomesOf(ranC) };
  for (const kind of ["E", "C"] as const) {
    const counted = byOutcome[kind].map(([outcome, n]) => `${outcome} ${n}`);
    if (counted.length > 0) say(`by outcome, ${kind}: ${counted.join(", ")}`);
  }
  // The plain format of a compiler holds the first section of a baseline and no more: such a match is counted apart.
  const headerOnly = results.filter(r => r.headerOnly === true).length;
  if (headerOnly > 0) say(`first section alone: ${headerOnly} instances, none of which is a pass`);
  if (results.length <= 20) {
    for (const r of results) {
      say(`  ${r.outcome} ${r.instance.name}${r.reason === "" ? "" : `: ${r.reason}`}`);
      for (const line of r.diff?.split("\n") ?? []) say(`      ${line}`);
    }
  } else {
    const others = results.filter(r => r.outcome !== "pass");
    const reasons = mostFirst(countBy(others, r => `${r.outcome}: ${r.reason.replace(/\d+/g, "n").slice(0, 100)}`));
    for (const [reason, n] of reasons.slice(0, 10)) say(`  ${String(n).padStart(6)}  ${reason}`);
    if (reasons.length > 10) say(`  and ${reasons.length - 10} more reasons in the report`);
  }
  // An instance counts once for a part, however many times its check reached the part.
  const standIns = countBy(
    results.flatMap(r => [...new Set(r.standIns ?? [])]),
    name => name,
  );
  if (standIns.size > 0) {
    say();
    say(`by stand-in: ${standIns.size} parts that the check does not have yet; instances that reached the part`);
    for (const [name, n] of mostFirst(standIns).slice(0, 10)) say(`  ${String(n).padStart(6)}  ${name}`);
    if (standIns.size > 10) say(`  and ${standIns.size - 10} more in the report`);
  }

  const directories = rowsBy(ran, passes, fact => fact.directory);
  if (directories.size > 0) {
    const cut = cutOf([...directories.keys()]);
    const groups = rowsBy(ran, passes, fact => cut(fact.directory));
    const width = Math.max(...[...groups.keys()].map(group => group.length));
    const padded = ([pass, all]: Cell) => `${String(pass).padStart(5)} of ${String(all).padEnd(5)}`;
    say();
    say(
      "by directory: instances that pass, of those whose oracle has errors (E) and of those whose oracle has none (C)",
    );
    for (const [group, row] of groups) {
      say(`  ${group.padEnd(width)}  E ${padded(row.E)}  C ${padded(row.C)}`.trimEnd());
    }
  }

  // The codes of the first section of each oracle: an instance counts once for each code that it has.
  const codes = new Map<number, CodeCount>();
  const codesUnread: string[] = [];
  for (const fact of ranE) {
    let all: number[];
    try {
      const oracle = tsgoRules.model.fromBytes(readOracle(fact.run!.oracle));
      all = readErrorBaseline(tsgoRules, oracle).diagnostics.map(d => d.code);
    } catch {
      codesUnread.push(fact.name);
      continue;
    }
    for (const code of new Set(all)) {
      let count = codes.get(code);
      if (count === undefined) codes.set(code, (count = { instances: 0, pass: 0, diagnostics: 0 }));
      count.instances++;
      if (passes(fact)) count.pass++;
      count.diagnostics += all.filter(other => other === code).length;
    }
  }
  const byCode = [...codes].sort((a, b) => b[1].instances - a[1].instances || a[0] - b[0]);
  if (byCode.length > 0) {
    say();
    say(`by diagnostic code: ${byCode.length} codes; instances that pass, of those whose oracle has the code`);
    for (const [code, count] of byCode.slice(0, 25)) {
      say(`  ${`TS${code}`.padEnd(8)} ${String(count.pass).padStart(5)} of ${count.instances}`);
    }
    if (byCode.length > 25) say(`  and ${byCode.length - 25} more codes in the report`);
  }
  if (codesUnread.length > 0) say(`${codesUnread.length} oracles were not read for their codes: the report names them`);

  // The lists: a listed name that does not pass fails the sweep, and a name that passes and is not listed is printed.
  const resultFacts = new Map<string, ResultFacts>();
  for (const { instance, outcome, reason } of results) {
    resultFacts.set(instance.name, { name: instance.name, status: outcome, level: "baseline", detail: reason });
  }
  const notPassing = verify(lists, resultFacts);
  const listedAndRun = ran.filter(fact => listed.has(fact.name)).length;
  say();
  say(
    `listed: E ${lists.E.length}, C ${lists.C.length}; of them run ${listedAndRun}, not passing ${notPassing.length}`,
  );
  for (const f of notPassing) say(`  FAIL ${f.list} ${f.name}: ${f.reason}: ${f.detail.split("\n")[0]}`);
  // A listed name of a case that was not read counts for its directory as what its list says it is: an instance that runs. It has no outcome, so the plan asks no rule about it.
  const known = new Map<string, InstanceFacts>(facts);
  for (const kind of ["E", "C"] as const) {
    for (const name of lists[kind]) {
      const casePath = caseOf(name);
      if (casePath === undefined || read.has(casePath)) continue;
      const directory = directoryOf(casePath);
      known.set(name, { name, directory, casePath, status: "run", reason: "", kind, platformLimited: undefined });
    }
  }
  const planned = plan(lists, known, resultFacts);
  const mayEnter = reportText(planned, updateCommand(argv, checked.binary));
  if (mayEnter !== "") say(mayEnter);
  const added = planned.added.E.length + planned.added.C.length;
  if (o.update) {
    try {
      if (added > 0) writeFileSync(expectationsPath, formatExpectations(planned.next));
    } catch (error) {
      throw new FileError(`--update ${expectationsPath}: ${messageOf(error)}`);
    }
    say(`added E ${planned.added.E.length}, C ${planned.added.C.length} to ${expectationsPath}`);
  }

  const report = {
    version: 1,
    check: checked.name,
    corpus: corpusRoot,
    selectors: o.selectors,
    only: { listed: o.listed, kind: o.kind, tag: o.tag },
    seconds: Math.round((performance.now() - started) / 100) / 10,
    totals: {
      selected: selected.length,
      run: ran.length,
      skipped,
      invalid,
      E: cellOf(ranE),
      C: cellOf(ranC),
      outcomes: { E: Object.fromEntries(byOutcome.E), C: Object.fromEntries(byOutcome.C) },
      headerOnly,
    },
    directories: Object.fromEntries(directories),
    codes: Object.fromEntries(byCode.map(([code, count]) => [`TS${code}`, count])),
    codesUnread,
    standIns: Object.fromEntries(mostFirst(standIns)),
    notRun: Object.fromEntries(mostFirst(notRun)),
    listed: {
      E: lists.E.length,
      C: lists.C.length,
      run: listedAndRun,
      notInstances,
      notPassing,
      since: shrink,
      losses,
    },
    notListed: planned.added,
    refused: planned.refused,
    updated: o.update && added > 0,
    instances: Object.fromEntries(
      ran.map(fact => {
        const r = resultOf.get(fact.name)!;
        const more = { headerOnly: r.headerOnly, standIns: r.standIns, diff: r.diff };
        return [fact.name, { kind: fact.kind, casePath: fact.casePath, outcome: r.outcome, reason: r.reason, ...more }];
      }),
    ),
    text,
  };
  try {
    writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\n");
  } catch (error) {
    throw new FileError(`--report ${reportPath}: ${messageOf(error)}`);
  }
  console.log(`report ${reportPath}`);
  return notInstances.length > 0 || losses.length > 0 || notPassing.length > 0 ? 1 : 0;
}

let exitCode: number;
try {
  exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError) && !(error instanceof FileError)) throw error;
  console.error(`sweep: ${error.message}${error instanceof UsageError ? `\n\n${usage}` : ""}`);
  exitCode = 2;
}
process.exit(exitCode);
