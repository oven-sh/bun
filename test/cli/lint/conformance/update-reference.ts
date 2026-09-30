// Writes again the answers of the reference that conformance.test.ts holds the runner against, for the commits that UPSTREAM pins.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Suite, corpusPaths, suites } from "./runner/paths";

const usage = `usage: bun test/cli/lint/conformance/update-reference.ts [options] <typescript-go clone>

Writes again, beside this script, the answers of the reference that conformance.test.ts holds the runner against, for
the commits that UPSTREAM pins and the corpus that sync.sh wrote. The clone is read through git plumbing only, at the
pinned commit: nothing is fetched and nothing is written into it.

  fixtures/instances.tsv    every instance of the reference's suite TestSubmodule, one line each, in the byte order
                            of the names: <name> TAB E (it runs and has an error baseline), <name> TAB C (it runs
                            and has none), or <name> TAB skipped TAB <reason>
  reference_counts.json     the pinned commits, the counts of that list and of the corpus, the digest of the corpus,
                            what upstream's files confirm of the list, the digests of what Go answered, and the
                            digests of a run of the reference's suite when one is recorded

Where the names, the skips and their reasons come from:
  --log <file>      the output of the reference's own run of its suite at the pinned commit, in its checkout:
                      go test ./internal/testrunner -run '^TestSubmodule$' -count=1 -v > <file>
                    The digests of that run are recorded (suiteRun): from then on the list has to match them.
  --enumerate       the enumerator of the runner. That is the runner's own word: only upstream's files hold the
                    list then (see the checks), and the record of a run of another commit is dropped.
  (neither)         the list that is there. Refused when UPSTREAM pins other commits than reference_counts.json.
Whether an instance that runs is E or C comes from the clone in every case: E when typescript-go has its
<name>.errors.txt.

  --check           write nothing, print what would change, exit 1 if anything differs
  --go <command>    build with that go command, without network, the reference's own functions as the clone has
                    them, and write again what only Go can answer: fixtures/directives-expected.json (the
                    reference's parser on fixtures/directives-inputs.json) and the digests of Go's case and space
                    tables. A run without it says when this is needed: when those functions, the go directive of
                    typescript-go, update-reference.go or the inputs are not the ones that are recorded. The go
                    command has to be at least the version that typescript-go's go.mod asks for.
  --go-version <v>  with --log: the version of Go that ran the suite, recorded with the digests
  -h, --help

Checked in every run; when one does not hold nothing is written and the exit code is 1:
  - every line is an instance of one case of the corpus, and the cases without a line are the ones that
    compiler_runner.go leaves out by name (skippedTests, read from the clone);
  - every baseline file of typescript-go (testdata/baselines/reference/submodule*) has the name of an instance that
    runs. The instances that run and that no such file names are printed: for them the list is the only witness
    unless a run is recorded;
  - an instance that runs has an error baseline in the corpus exactly when typescript-go has one: so the list cannot
    run an instance that the reference skips while TypeScript has an error baseline of its name. The other skips,
    and the reason of every skip, have no witness but a run;
  - while a run is recorded for the pinned commit, the list has its digests.

Exit code 0: written, or nothing to write. 1: a check does not hold, or --check found a difference. 2: the command
line, a file or the clone cannot be used.`;

const self = "update-reference.ts";
const home = import.meta.dir;
const paths = corpusPaths(join(home, "corpus"));
const listPath = join(home, "fixtures", "instances.tsv");
const countsPath = join(home, "reference_counts.json");
const inputsPath = join(home, "fixtures", "directives-inputs.json");
const expectedPath = join(home, "fixtures", "directives-expected.json");
const driverPath = join(home, "update-reference.go");

type Kind = "E" | "C";

// 1: a check does not hold. 2: the command line, a file or the clone cannot be used.
function stop(code: 1 | 2, message: string): never {
  console.error(`${self}: ${message}`);
  process.exit(code);
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
// The order of Go's strings.Compare: the bytes of the UTF-8 text.
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const some = (names: readonly string[], n = 20) =>
  names.slice(0, n).join(" ") + (names.length > n ? ` ... (${names.length} in all)` : "");

interface Options {
  check: boolean;
  enumerate: boolean;
  log: string | undefined;
  goVersion: string | undefined;
  go: string | undefined;
  clone: string;
}

function parseArguments(argv: readonly string[]): Options {
  const o: Options = { check: false, enumerate: false, log: undefined, goVersion: undefined, go: undefined, clone: "" };
  const rest: string[] = [];
  for (let k = 0; k < argv.length; k++) {
    const arg = argv[k];
    const value = () => argv[++k] ?? stop(2, `${arg} needs a value\n\n${usage}`);
    if (arg === "-h" || arg === "--help") {
      console.log(usage);
      process.exit(0);
    } else if (arg === "--check") o.check = true;
    else if (arg === "--enumerate") o.enumerate = true;
    else if (arg === "--log") o.log = resolve(value());
    else if (arg === "--go-version") o.goVersion = value();
    else if (arg === "--go") o.go = value();
    else if (arg.startsWith("-")) stop(2, `unknown option ${arg}\n\n${usage}`);
    else rest.push(arg);
  }
  if (rest.length !== 1) stop(2, usage);
  if (o.log !== undefined && o.enumerate) stop(2, "--log and --enumerate are two sources of one list: give one");
  if (o.goVersion !== undefined && o.log === undefined) stop(2, "--go-version names the Go of a run: it needs --log");
  o.clone = resolve(rest[0]);
  return o;
}

interface Pins {
  "typescript-go": string;
  TypeScript: string;
}

// The pin of a repository is the first full commit id after its name, as sync.sh reads UPSTREAM.
function readPins(text: string): Pins {
  const token = /(?<![A-Za-z0-9_])(?:[Tt]ype[Ss]cript(?:-[Gg]o)?|[0-9a-f]{40})(?![A-Za-z0-9_])/g;
  const found: Partial<Pins> = {};
  let repository: keyof Pins | undefined;
  for (const [word] of text.matchAll(token)) {
    if (!/^[0-9a-f]{40}$/.test(word)) repository = /-[Gg]o$/.test(word) ? "typescript-go" : "TypeScript";
    else if (repository !== undefined) found[repository] ??= word;
  }
  const go = found["typescript-go"];
  const ts = found.TypeScript;
  if (go === undefined || ts === undefined) {
    return stop(2, "UPSTREAM has to name typescript-go and TypeScript, each followed by its full commit id");
  }
  return { "typescript-go": go, TypeScript: ts };
}

// Git on the clone, with no variable of a surrounding git command and no way to fetch.
function git(clone: string, args: readonly string[]): { ok: boolean; out: Buffer; err: string } {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  Object.assign(env, { LC_ALL: "C", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "" });
  const p = Bun.spawnSync(["git", "-C", clone, "-c", "core.quotePath=false", ...args], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return { ok: p.exitCode === 0, out: p.stdout, err: p.stderr.toString().trim() };
}

function gitText(clone: string, args: readonly string[]): string {
  const r = git(clone, args);
  if (!r.ok) stop(2, `git ${args.join(" ")} in ${clone}: ${r.err}`);
  return r.out.toString("utf8");
}

interface CaseFile {
  suite: Suite;
  // The path below the cases of the corpus: "compiler/2dArrays.ts".
  path: string;
}

// Every case by its file name, which no two cases share.
function listCases(): Map<string, CaseFile> {
  const out = new Map<string, CaseFile>();
  const walk = (suite: Suite, rel: string) => {
    for (const entry of readdirSync(`${paths.cases}/${rel}`, { withFileTypes: true })) {
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(suite, path);
      else if (/\.tsx?$/.test(entry.name)) {
        const other = out.get(entry.name);
        if (other !== undefined) stop(2, `two cases are named ${entry.name}: ${other.path} and ${path}`);
        out.set(entry.name, { suite, path });
      }
    }
  };
  for (const suite of suites) walk(suite, suite);
  return out;
}

interface CorpusFiles {
  files: number;
  bytes: number;
  sha256: string;
  // The paths of the error baselines in the pretty form, which colours its text.
  pretty: Set<string>;
}

// Every file below corpus/ but its own dot files: the digest is over the lines "<id that git gives the blob> <path>" in the byte order of the paths.
function readCorpusFiles(): CorpusFiles {
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(rel === "" ? paths.root : `${paths.root}/${rel}`, { withFileTypes: true })) {
      if (rel === "" && entry.name.startsWith(".")) continue;
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk("");
  files.sort(byBytes);
  const digest = createHash("sha256");
  const pretty = new Set<string>();
  let bytes = 0;
  for (const path of files) {
    const content = readFileSync(`${paths.root}/${path}`);
    bytes += content.length;
    const id = createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
    digest.update(`${id} ${path}\n`);
    if (path.endsWith(".errors.txt") && content.includes("\x1b[")) pretty.add(`${paths.root}/${path}`);
  }
  return { files: files.length, bytes, sha256: digest.digest("hex"), pretty };
}

// A list names a file once however often its line is there; "#" starts a comment.
function readNameList(path: string): Set<string> {
  const out = new Set<string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const name = line.trim();
    if (name !== "" && !name.startsWith("#")) out.add(name);
  }
  return out;
}

interface Row {
  // The configured name of the reference: "ES5For-of1(target=es2015).ts".
  name: string;
  suite: Suite;
  status: "run" | "skipped";
  // Why the reference skips the instance; empty for one that runs.
  reason: string;
}

// "a(target=es2015).ts" is the instance of the case "a.ts" with the configuration "target=es2015".
const configured = /^(.*)\(([^()]*)\)(\.tsx?)$/s;
// The name of the subtest as Go prints it: "a.ts_target=es2015".
const goNameOf = (name: string) => {
  const m = configured.exec(name);
  return m === null ? name : `${m[1]}${m[3]}_${m[2]}`;
};
// The stem that the names of the baselines of an instance start with.
const stemOf = (name: string) => name.replace(/\.tsx?$/, "");

function caseOf(cases: ReadonlyMap<string, CaseFile>, name: string): CaseFile | undefined {
  const m = configured.exec(name);
  const plain = cases.get(name);
  const varied = m === null ? undefined : cases.get(m[1] + m[3]);
  if (plain !== undefined && varied !== undefined) {
    stop(1, `${name} is the name of a case and of an instance of the case ${varied.path}`);
  }
  return plain ?? varied;
}

interface RunDigests {
  subtests: number;
  sha256: string;
  skipReasonsSha256: string;
}

// The subtests as Go prints them, in the order of their names, and the reason of every skip: the two texts that a run is recorded by.
function runDigestsOf(rows: readonly Row[]): RunDigests {
  const subtests = rows
    .map(r => ({ name: goNameOf(r.name), status: r.status === "run" ? "PASS" : "SKIP" }))
    .sort((a, b) => byBytes(a.name, b.name))
    .map(s => `${s.status}\t${s.name}\n`);
  const reasons = rows
    .filter(r => r.status === "skipped")
    .map(r => `${goNameOf(r.name)}\t${r.reason}`)
    .sort(byBytes)
    .map(line => line + "\n");
  return { subtests: subtests.length, sha256: sha256(subtests.join("")), skipReasonsSha256: sha256(reasons.join("")) };
}

// The subtests of TestSubmodule at depth one in the output of go test -v: whether each passed or was skipped, and what a skip logged.
function rowsOfLog(path: string, cases: ReadonlyMap<string, CaseFile>): Row[] {
  const prefix = "TestSubmodule/";
  const status = new Map<string, string>();
  const logged = new Map<string, string[]>();
  let current: string | undefined;
  let ended: string | undefined;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    return stop(2, `cannot read the log ${path}: ${(e as Error).message}`);
  }
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    let m: RegExpExecArray | null;
    if ((m = /^=== (?:RUN|PAUSE|CONT|NAME) +(.*)$/.exec(line)) !== null) {
      current = m[1].startsWith(prefix) ? m[1].slice(prefix.length) : undefined;
    } else if ((m = /^--- (PASS|FAIL|SKIP): TestSubmodule \(/.exec(line)) !== null) {
      ended = m[1];
    } else if ((m = /^    --- (PASS|FAIL|SKIP): TestSubmodule\/(.+) \([0-9.]+s\)$/.exec(line)) !== null) {
      if (m[2].includes("/")) continue;
      if (status.has(m[2])) stop(2, `the log ends the subtest ${m[2]} twice`);
      status.set(m[2], m[1]);
    } else if ((m = /^    [^\s:]+\.go:\d+: (.*)$/.exec(line)) !== null) {
      if (current === undefined || current.includes("/")) continue;
      const lines = logged.get(current);
      if (lines === undefined) logged.set(current, [m[1]]);
      else lines.push(m[1]);
    }
  }
  if (ended === undefined) stop(2, `${path} is not the whole output of go test -v: it does not end TestSubmodule`);
  const notPassed = [...status].filter(([, s]) => s === "FAIL").map(([name]) => name);
  if (ended !== "PASS" || notPassed.length > 0) {
    stop(1, `the run of the reference did not pass (${ended}): ${some(notPassed)}`);
  }
  if (status.size === 0) stop(2, `${path} holds no subtest of TestSubmodule`);

  const rows: Row[] = [];
  for (const [goName, result] of status) {
    // Go writes a space of the name as "_": the case is the one whose file name the subtest starts with.
    const candidates: { base: string; config: string }[] = cases.has(goName) ? [{ base: goName, config: "" }] : [];
    for (let k = goName.indexOf("_"); k >= 0; k = goName.indexOf("_", k + 1)) {
      if (cases.has(goName.slice(0, k))) candidates.push({ base: goName.slice(0, k), config: goName.slice(k + 1) });
    }
    if (candidates.length !== 1) {
      const found = candidates.length === 0 ? "no case" : candidates.map(c => c.base).join(" and ");
      stop(1, `the subtest ${goName} of the log is of ${found} of the corpus: the log is of another commit`);
    }
    const { base, config } = candidates[0];
    const dot = base.lastIndexOf(".");
    const name = config === "" ? base : `${base.slice(0, dot)}(${config})${base.slice(dot)}`;
    if (goNameOf(name) !== goName) stop(2, `the subtest ${goName} cannot be named as an instance: ${name}`);
    const lines = logged.get(goName) ?? [];
    if (result === "SKIP" && lines.length !== 1) {
      stop(2, `the skipped subtest ${goName} logged ${lines.length} lines: its reason is one line`);
    }
    rows.push({
      name,
      suite: cases.get(base)!.suite,
      status: result === "SKIP" ? "skipped" : "run",
      reason: result === "SKIP" ? lines[0] : "",
    });
  }
  return rows;
}

// The instances of the runner's port of the enumeration; one that the reference would fail on has no line, so it stops the run.
async function rowsOfEnumerator(): Promise<Row[]> {
  const { enumerateInstances } = await import("./runner/compiler_runner");
  const rows: Row[] = [];
  const invalid: string[] = [];
  let instances: ReturnType<typeof enumerateInstances>;
  try {
    instances = enumerateInstances(paths.cases);
  } catch (e) {
    return stop(1, `the enumerator stops where the reference's run does not: ${(e as Error).message}`);
  }
  for (const i of instances) {
    if (i.status === "invalid") {
      invalid.push(`${i.name} (${i.invalidReason})`);
      continue;
    }
    const run = i.status === "run";
    rows.push({ name: i.name, suite: i.suite, status: run ? "run" : "skipped", reason: i.skipReason ?? "" });
  }
  if (invalid.length > 0) stop(1, `the enumerator makes instances that the reference would fail on: ${some(invalid)}`);
  return rows;
}

function rowsOfList(text: string, cases: ReadonlyMap<string, CaseFile>): Row[] {
  const rows: Row[] = [];
  const lines = text.split("\n");
  if (lines.pop() !== "") stop(2, "fixtures/instances.tsv does not end with a line feed");
  for (const [k, line] of lines.entries()) {
    const [name, kind, ...rest] = line.split("\t");
    const run = (kind === "E" || kind === "C") && rest.length === 0;
    if (!run && !(kind === "skipped" && rest.length === 1)) {
      stop(
        2,
        `line ${k + 1} of fixtures/instances.tsv is neither <name> TAB E, <name> TAB C nor <name> TAB skipped TAB <reason>`,
      );
    }
    const file = caseOf(cases, name);
    if (file === undefined)
      stop(1, `line ${k + 1} of fixtures/instances.tsv, ${name}, is an instance of no case of the corpus`);
    rows.push({ name, suite: file.suite, status: run ? "run" : "skipped", reason: run ? "" : rest[0] });
  }
  return rows;
}

// The strings that start the entries of a list or a map of the Go source.
function goNames(source: string, head: string): string[] {
  const from = source.indexOf(head);
  const to = source.indexOf("\n}\n", from);
  if (from < 0 || to < 0) stop(2, `compiler_runner.go of the pinned commit has no "${head}": read it and this script`);
  const entries = source.slice(from + head.length, to).matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*[,:]/gm);
  return [...entries].map(m => JSON.parse(m[1]) as string);
}

// The top-level declarations of a gofmt-formatted file by name; a name that a block declares gives the block.
function goDeclarations(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(func|type|var|const) (.*)$/.exec(lines[i]);
    if (m === null) continue;
    const [, keyword, rest] = m;
    const first = lines[i].trimEnd();
    let end = i;
    let names: string[];
    if (keyword === "func") {
      // A function ends at the brace in the first column, or in its one line.
      if (!first.endsWith("}")) while (end < lines.length && lines[end] !== "}") end++;
      const f = /^(\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
      names = f === null || f[1] !== undefined ? [] : [f[2]];
    } else if (rest.trim() === "(") {
      while (end < lines.length && !lines[end].startsWith(")")) end++;
      names = lines.slice(i + 1, end).flatMap(line => /^\t([A-Za-z_][A-Za-z0-9_]*)/.exec(line)?.[1] ?? []);
    } else {
      if (first.endsWith("{")) while (end < lines.length && !lines[end].startsWith("}")) end++;
      else if (first.endsWith("(")) while (end < lines.length && !lines[end].startsWith(")")) end++;
      names = [/^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)?.[0] ?? ""];
    }
    const text = lines.slice(i, end + 1).join("\n");
    for (const name of names) if (name !== "" && !out.has(name)) out.set(name, text);
    i = end;
  }
  return out;
}

// The imports of a Go file: the name that the file uses for each package, and its path.
function goImports(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const block = /^import \(\n([\s\S]*?)\n\)/m.exec(source);
  const lines = block !== null ? block[1].split("\n") : [...source.matchAll(/^import (.*)$/gm)].map(m => m[1]);
  for (const line of lines) {
    const m = /^\s*(?:([A-Za-z_][A-Za-z0-9_]*)\s+)?"([^"]+)"/.exec(line);
    if (m !== null) out.set(m[1] ?? m[2].slice(m[2].lastIndexOf("/") + 1), m[2]);
  }
  return out;
}

// Applies f to the code of a Go text and leaves its comments, strings and runes as they are.
function outsideGoLiterals(text: string, f: (code: string) => string): string {
  const literal = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|`[^`]*`|'(?:[^'\\\n]|\\.)*'/g;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(literal)) {
    out += f(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + f(text.slice(last));
}

// The declarations of the reference that the Go program is built from, by the file that holds them.
const goSources: readonly (readonly [string, readonly string[]])[] = [
  ["internal/ast/utilities.go", ["PositionIsSynthesized"]],
  ["internal/stringutil/util.go", ["IsWhiteSpaceLike", "IsWhiteSpaceSingleLine", "IsLineBreak"]],
  [
    "internal/scanner/scanner.go",
    [
      "SkipTriviaOptions",
      "SkipTrivia",
      "SkipTriviaEx",
      "mergeConflictMarkerLength",
      "isConflictMarkerTrivia",
      "scanConflictMarkerTrivia",
      "isShebangTrivia",
      "scanShebangTrivia",
    ],
  ],
  [
    "internal/tspath/path.go",
    [
      "DirectorySeparator",
      "isAnyDirectorySeparator",
      "HasTrailingDirectorySeparator",
      "IsVolumeCharacter",
      "getFileUrlVolumeSeparatorEnd",
      "GetEncodedRootLength",
      "GetRootLength",
      "NormalizeSlashes",
      "RemoveTrailingDirectorySeparator",
      "GetBaseFileName",
    ],
  ],
  ["internal/vfs/internal/internal.go", ["decodeBytes", "decodeUtf16"]],
  ["internal/testutil/harnessutil/harnessutil.go", ["GetConfigNameFromFileName"]],
  [
    "internal/testrunner/test_case_parser.go",
    [
      "lineDelimiter",
      "rawCompilerSettings",
      "optionRegex",
      "linkRegex",
      "fourslashDirectives",
      "ParseTestFilesOptions",
      "ParseTestFilesAndSymlinksWithOptions",
      "extractCompilerSettings",
      "parseSymlinkFromTest",
    ],
  ],
];

interface GoProgram {
  // The files of the module that is built: go.mod, the declarations of the reference, and update-reference.go as main.go.
  files: [name: string, text: string][];
  sha256: string;
}

// One package holds what the reference keeps in several: the declarations are as the clone has them, but for the names of those packages.
function goProgram(clone: string, commit: string): GoProgram {
  const internal = "github.com/microsoft/typescript-go/internal/";
  const imports = new Set<string>();
  const parts: string[] = [];
  const taken = new Set<string>();
  for (const [path, names] of goSources) {
    const source = gitText(clone, ["show", `${commit}:${path}`]);
    const declarations = goDeclarations(source);
    const packages = goImports(source);
    for (const name of names) {
      const text = declarations.get(name);
      if (text === undefined) {
        return stop(
          2,
          `${path} of the pinned commit declares no ${name}: bring goSources of this script in line with it`,
        );
      }
      if (taken.has(text)) continue;
      taken.add(text);
      const flat = outsideGoLiterals(text, code => {
        for (const [qualifier, from] of packages) {
          const use = new RegExp(`(?<![A-Za-z0-9_.])${qualifier}\\.(?=[A-Za-z_])`, "g");
          if (!use.test(code)) continue;
          if (from.startsWith(internal)) code = code.replace(use, "");
          else if (!from.split("/")[0].includes(".")) imports.add(from);
          else stop(2, `${name} of ${path} needs the module ${from}, which this script does not build`);
        }
        return code;
      });
      parts.push(`// ${path}\n${flat}`);
    }
  }
  const directive = /^go (\S+)$/m.exec(gitText(clone, ["show", `${commit}:go.mod`]));
  if (directive === null) return stop(2, "go.mod of the pinned commit has no go directive");
  const header = [
    "// Code generated by update-reference.ts from a clone of typescript-go. DO NOT EDIT.",
    "package main",
    "",
    "import (",
    ...[...imports].sort(byBytes).map(path => `\t"${path}"`),
    ")",
  ].join("\n");
  const files: [string, string][] = [
    ["go.mod", `module reference\n\ngo ${directive[1]}\n`],
    ["reference.go", `${header}\n\n${parts.join("\n\n")}\n`],
    // The file as it is committed, whatever line ends a checkout gave it.
    ["main.go", readFileSync(driverPath, "utf8").replaceAll("\r\n", "\n")],
  ];
  const digest = createHash("sha256");
  for (const [name, text] of files) digest.update(`${name} ${Buffer.byteLength(text)}\n${text}`);
  return { files, sha256: digest.digest("hex") };
}

interface GoAnswers {
  // What the toolchain that built the program calls itself, and the Unicode version of its tables.
  version: string;
  unicode: string;
  tables: { lower: string; foldKey: string; space: string; white: string };
  // The digest of the program that answered, and of the inputs and the answer of the directive vectors.
  program: string;
  directives: { inputs: string; expected: string };
}

// Builds the program in a temporary directory and runs it: the tables, and the reference's parser on the inputs.
function askGo(go: string, program: GoProgram): { answers: GoAnswers; expected: Buffer } {
  const directory = mkdtempSync(join(tmpdir(), "lint-conformance-reference-"));
  try {
    for (const [name, text] of program.files) writeFileSync(join(directory, name), text);
    const env = {
      ...process.env,
      GOTOOLCHAIN: "local",
      GOPROXY: "off",
      GOSUMDB: "off",
      GOFLAGS: "-mod=mod",
      GOWORK: "off",
    };
    const run = (cmd: string[]) => {
      const p = Bun.spawnSync(cmd, { cwd: directory, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      if (p.exitCode !== 0) {
        stop(
          2,
          `${cmd.join(" ")} failed in a copy of the program (${program.files.map(f => f[0]).join(", ")}):\n${p.stderr}`,
        );
      }
      return p.stdout;
    };
    run([go, "build", "-o", "reference", "."]);
    const binary = join(directory, "reference");
    const t = JSON.parse(run([binary, "tables"]).toString("utf8"));
    const expected = Buffer.from(run([binary, "directives", inputsPath]));
    return {
      answers: {
        version: t.go,
        unicode: t.unicode,
        tables: { lower: t.lower, foldKey: t.foldKey, space: t.space, white: t.white },
        program: program.sha256,
        directives: { inputs: sha256(readFileSync(inputsPath)), expected: sha256(expected) },
      },
      expected,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// What the clone says of the list: the cases that are left out by name, and the names that its baseline files confirm.
interface Reference {
  leftOut: Set<string>;
  emitNotCompared: number;
  baselineFiles: number;
  // The instances that run and that a baseline file of typescript-go names.
  named: Set<string>;
  // "<suite>/<name>.errors.txt" of every error baseline of typescript-go.
  errors: Set<string>;
}

function readReference(
  clone: string,
  commit: string,
  cases: ReadonlyMap<string, CaseFile>,
  rows: readonly Row[],
): Reference {
  const source = gitText(clone, ["show", `${commit}:internal/testrunner/compiler_runner.go`]);
  const leftOut = new Set(goNames(source, "var skippedTests = []string{").filter(name => cases.has(name)));
  const emitNotCompared = goNames(source, "var skippedEmitTests = map[string]string{").filter(name => cases.has(name));
  const withLine = new Set(rows.map(r => caseOf(cases, r.name)!.path));
  const notLeftOut = [...cases]
    .filter(([name, file]) => !withLine.has(file.path) && !leftOut.has(name))
    .map(([name]) => name);
  const leftOutWithLine = [...leftOut].filter(name => withLine.has(cases.get(name)!.path));
  if (notLeftOut.length > 0 || leftOutWithLine.length > 0) {
    stop(
      1,
      `the list and skippedTests of compiler_runner.go differ. Cases without a line that are not left out by name: ${some(notLeftOut)}. Cases that are left out by name and have a line: ${some(leftOutWithLine)}`,
    );
  }

  const stems = new Map<string, Row>(rows.map(r => [`${r.suite}/${stemOf(r.name)}`, r]));
  if (stems.size !== rows.length) stop(1, "two instances of a suite share the stem of their baselines");
  const errors = new Set<string>();
  const named = new Set<string>();
  const strays: string[] = [];
  let baselineFiles = 0;
  for (const root of ["submodule", "submoduleAccepted", "submoduleTriaged"]) {
    for (const suite of suites) {
      const directory = `testdata/baselines/reference/${root}/${suite}/`;
      const listing = gitText(clone, ["ls-tree", "-z", "--name-only", commit, directory]).split("\0");
      const files = listing.filter(path => path !== "").map(path => path.slice(directory.length));
      if (root === "submodule" && files.length === 0) stop(2, `typescript-go ${commit} has nothing in ${directory}`);
      for (const file of files) {
        baselineFiles++;
        // The name of the instance is what stands before one of the dots of the file name.
        let row: Row | undefined;
        for (let cut = file.lastIndexOf("."); cut > 0 && row === undefined; cut = file.lastIndexOf(".", cut - 1)) {
          row = stems.get(`${suite}/${file.slice(0, cut)}`);
        }
        if (row === undefined || row.status !== "run") strays.push(`${root}/${suite}/${file}`);
        else if (root === "submodule" && !file.endsWith(".diff")) named.add(row.name);
        if (root === "submodule" && file.endsWith(".errors.txt")) errors.add(`${suite}/${file}`);
      }
    }
  }
  if (strays.length > 0) {
    stop(1, `baseline files of typescript-go that do not have the name of an instance that runs: ${some(strays)}`);
  }
  return { leftOut, emitNotCompared: emitNotCompared.length, baselineFiles, named, errors };
}

interface Corpus {
  files: CorpusFiles;
  // The names of the error baselines of TypeScript and of typescript-go, and the three lists.
  typescript: Set<string>;
  typescriptGo: Record<Suite, Set<string>>;
  expectsNoErrors: Set<string>;
  accepted: Set<string>;
  triaged: Set<string>;
}

function readCorpus(): Corpus {
  const errorBaselines = (directory: string) =>
    new Set(readdirSync(directory).filter(name => name.endsWith(".errors.txt")));
  return {
    files: readCorpusFiles(),
    typescript: errorBaselines(paths.typescriptBaselines),
    typescriptGo: {
      compiler: errorBaselines(paths.typescriptGoBaselines.compiler),
      conformance: errorBaselines(paths.typescriptGoBaselines.conformance),
    },
    expectsNoErrors: readNameList(paths.noErrors),
    accepted: readNameList(paths.submoduleAccepted),
    triaged: readNameList(paths.submoduleTriaged),
  };
}

// Where the corpus takes the oracle of an instance from: typescript-go's file, none by its list, TypeScript's file, or none.
type Source = "typescript-go" | "expects-no-errors" | "typescript" | "none";
function sourceOf(corpus: Corpus, r: Row): Source {
  const file = `${stemOf(r.name)}.errors.txt`;
  if (corpus.typescriptGo[r.suite].has(file)) return "typescript-go";
  if (corpus.expectsNoErrors.has(`${r.suite}/${file}`)) return "expects-no-errors";
  return corpus.typescript.has(file) ? "typescript" : "none";
}

interface SuiteRun extends RunDigests {
  "typescript-go": string;
  go?: string;
}

// A run that is recorded for the pinned commit holds the list; a run of another commit says nothing and is dropped.
function suiteRunOf(
  o: Options,
  recorded: SuiteRun | undefined,
  commit: string,
  rows: readonly Row[],
): SuiteRun | undefined {
  const digests = runDigestsOf(rows);
  if (o.log !== undefined) {
    const same = recorded?.sha256 === digests.sha256 && recorded?.skipReasonsSha256 === digests.skipReasonsSha256;
    const go = o.goVersion ?? (same ? recorded?.go : undefined);
    return { "typescript-go": commit, ...(go === undefined ? {} : { go }), ...digests };
  }
  if (recorded === undefined) {
    console.log(`no run of the reference's suite is recorded for ${commit}: only upstream's files hold the list`);
    return undefined;
  }
  for (const key of ["subtests", "sha256", "skipReasonsSha256"] as const) {
    if (recorded[key] !== digests[key]) {
      stop(
        1,
        `the list is not the run of the reference that is recorded for ${commit}: ${key} is ${digests[key]}, recorded ${recorded[key]}`,
      );
    }
  }
  return recorded;
}

// What only Go can answer: made again with --go, else the answers that are there, when they were made of what is there now.
function goAnswersOf(
  o: Options,
  recorded: GoAnswers | undefined,
  commit: string,
): { go: GoAnswers; expected?: Buffer } {
  const program = goProgram(o.clone, commit);
  if (o.go !== undefined) {
    const { answers, expected } = askGo(o.go, program);
    console.log(
      `${answers.version} built the reference's functions and answered for fixtures/directives-inputs.json and for its tables`,
    );
    return { go: answers, expected };
  }
  const now = {
    program: program.sha256,
    inputs: sha256(readFileSync(inputsPath)),
    expected: existsSync(expectedPath) ? sha256(readFileSync(expectedPath)) : "no file",
  };
  const was = {
    program: recorded?.program,
    inputs: recorded?.directives?.inputs,
    expected: recorded?.directives?.expected,
  };
  const what = {
    program: "the reference's functions, the go directive of typescript-go or update-reference.go",
    inputs: "fixtures/directives-inputs.json",
    expected: "fixtures/directives-expected.json",
  };
  const stale = (Object.keys(now) as (keyof typeof now)[]).filter(key => now[key] !== was[key]);
  if (recorded === undefined || stale.length > 0) {
    stop(
      1,
      `Go's answers were not made of what is there now: ${stale.map(key => what[key]).join("; ")}. Run again with --go <go command>`,
    );
  }
  return { go: recorded };
}

// The leaves of a JSON value by their path, for the lines that say what changed.
function leaves(value: unknown, path = "", out = new Map<string, string>()): Map<string, string> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, member] of Object.entries(value)) leaves(member, path === "" ? key : `${path}.${key}`, out);
  } else if (value !== undefined) out.set(path, JSON.stringify(value));
  return out;
}

// Prints A, D or M for every entry that differs between two maps, as sync.sh does for paths.
function printChanges(title: string, old: ReadonlyMap<string, string> | undefined, now: ReadonlyMap<string, string>) {
  const lines: string[] = [];
  for (const [key, value] of now) {
    if (old?.has(key) !== true) lines.push(`  A ${key}${value}`);
    else if (old.get(key) !== value) lines.push(`  M ${key}${old.get(key)} -> ${value}`);
  }
  for (const [key, value] of old ?? []) if (!now.has(key)) lines.push(`  D ${key}${value}`);
  console.log(`${old === undefined ? "A" : "M"} ${title}`);
  for (const line of lines.slice(0, 40)) console.log(line);
  if (lines.length > 40) console.log(`  ... and ${lines.length - 40} more`);
  if (lines.length === 0) console.log("  the same entries in other bytes");
}

async function main(): Promise<number> {
  const o = parseArguments(process.argv.slice(2));
  const corpusParts = [
    paths.cases,
    paths.typescriptBaselines,
    ...suites.map(suite => paths.typescriptGoBaselines[suite]),
    paths.noErrors,
    paths.submoduleAccepted,
    paths.submoduleTriaged,
  ];
  for (const path of [join(home, "UPSTREAM"), ...corpusParts, inputsPath, driverPath]) {
    if (!existsSync(path)) stop(2, `missing ${path}`);
  }
  const pins = readPins(readFileSync(join(home, "UPSTREAM"), "utf8"));
  const commit = pins["typescript-go"];
  if (!git(o.clone, ["rev-parse", "--git-dir"]).ok) stop(2, `${o.clone} is not a git repository that can be read`);
  if (!git(o.clone, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]).ok) {
    stop(2, `commit ${commit} is not in ${o.clone}: fetch it yourself, this script uses no network`);
  }
  const countsBefore = existsSync(countsPath) ? readFileSync(countsPath, "utf8") : undefined;
  let before: any;
  try {
    before = countsBefore === undefined ? undefined : JSON.parse(countsBefore);
  } catch (e) {
    return stop(2, `reference_counts.json is no JSON: ${(e as Error).message}`);
  }
  const listBefore = existsSync(listPath) ? readFileSync(listPath, "utf8") : undefined;
  const pinned = before?.upstream?.["typescript-go"] === commit && before?.upstream?.TypeScript === pins.TypeScript;
  console.log(`typescript-go ${commit}`);
  console.log(`TypeScript    ${pins.TypeScript}`);

  const cases = listCases();
  let rows: Row[];
  if (o.log !== undefined) {
    rows = rowsOfLog(o.log, cases);
    console.log(`the list is the run of the reference in ${o.log}`);
  } else if (o.enumerate) {
    rows = await rowsOfEnumerator();
    console.log("the list is the one of the enumerator of the runner");
  } else if (listBefore !== undefined && pinned) {
    rows = rowsOfList(listBefore, cases);
    console.log("the list is the one that is there");
  } else {
    const there = listBefore !== undefined && before !== undefined;
    const why = there
      ? "UPSTREAM pins other commits than reference_counts.json"
      : "the list or reference_counts.json is not there";
    return stop(2, `${why}: give --log with the output of the reference's run at the pinned commit, or --enumerate`);
  }
  rows.sort((a, b) => byBytes(a.name, b.name));
  const twice = rows.filter((r, k) => k > 0 && rows[k - 1].name === r.name).map(r => r.name);
  if (twice.length > 0) stop(1, `instances that the list names twice: ${some(twice)}`);
  const noCase = rows.filter(r => caseOf(cases, r.name)?.suite !== r.suite).map(r => r.name);
  if (noCase.length > 0) stop(1, `instances of no case of their suite in the corpus: ${some(noCase)}`);
  const odd = rows.filter(r => /[\t\r\n]/.test(r.name + r.reason) || (r.status === "skipped" && r.reason === ""));
  if (odd.length > 0) {
    stop(1, `names or reasons with a tab or a line break, or skips without a reason: ${some(odd.map(r => r.name))}`);
  }

  const suiteRun = suiteRunOf(
    o,
    before?.suiteRun?.["typescript-go"] === commit ? before.suiteRun : undefined,
    commit,
    rows,
  );
  const reference = readReference(o.clone, commit, cases, rows);
  const kindOf = (r: Row): Kind => (reference.errors.has(`${r.suite}/${stemOf(r.name)}.errors.txt`) ? "E" : "C");
  const running = rows.filter(r => r.status === "run");
  const skipped = rows.filter(r => r.status === "skipped");
  const withErrors = running.filter(r => kindOf(r) === "E");
  if (withErrors.length !== reference.errors.size) {
    stop(
      1,
      `typescript-go has ${reference.errors.size} error baselines, and ${withErrors.length} of them are of an instance that runs`,
    );
  }
  const corpus = readCorpus();
  const otherOracle = running.filter(
    r => ["typescript-go", "typescript"].includes(sourceOf(corpus, r)) !== (kindOf(r) === "E"),
  );
  if (otherOracle.length > 0) {
    stop(
      1,
      `an instance that runs has an error baseline in the corpus exactly when typescript-go has one. Not so, because the reference skips the instance or because the corpus is not what sync.sh writes: ${some(otherOracle.map(r => r.name))}`,
    );
  }
  const { go, expected: expectedAfter } = goAnswersOf(o, before?.go, commit);

  const count = (all: readonly Row[], f: (r: Row) => boolean) => all.filter(f).length;
  const suiteCounts = (suite: Suite) => ({
    instances: count(rows, r => r.suite === suite),
    run: count(running, r => r.suite === suite),
    skipped: count(skipped, r => r.suite === suite),
    E: count(withErrors, r => r.suite === suite),
    C: count(running, r => r.suite === suite && kindOf(r) === "C"),
  });
  // Two of the reasons end with the value of the option.
  const because = new Map<string, number>();
  for (const r of skipped) {
    const reason = r.reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1");
    because.set(reason, (because.get(reason) ?? 0) + 1);
  }
  const oracleFile = (r: Row) =>
    `${sourceOf(corpus, r) === "typescript-go" ? paths.typescriptGoBaselines[r.suite] : paths.typescriptBaselines}/${stemOf(r.name)}.errors.txt`;
  const diffName = (r: Row) => `${r.suite}/${stemOf(r.name)}.errors.txt.diff`;
  const listAfter = rows
    .map(r => (r.status === "run" ? `${r.name}\t${kindOf(r)}\n` : `${r.name}\tskipped\t${r.reason}\n`))
    .join("");
  const after = {
    upstream: pins,
    cases: { files: cases.size, droppedByName: reference.leftOut.size, emitNotCompared: reference.emitNotCompared },
    instances: {
      sha256: sha256(listAfter),
      all: rows.length,
      run: running.length,
      skipped: skipped.length,
      E: withErrors.length,
      C: running.length - withErrors.length,
      compiler: suiteCounts("compiler"),
      conformance: suiteCounts("conformance"),
      skippedBecause: Object.fromEntries([...because].sort((a, b) => byBytes(a[0], b[0]))),
      pretty: count(withErrors, r => corpus.files.pretty.has(oracleFile(r))),
      accepted: count(running, r => corpus.accepted.has(diffName(r))),
      triaged: count(running, r => corpus.triaged.has(diffName(r))),
    },
    oracle: {
      "typescript-go": count(running, r => sourceOf(corpus, r) === "typescript-go"),
      typescript: count(running, r => sourceOf(corpus, r) === "typescript"),
      "expects-no-errors": count(running, r => sourceOf(corpus, r) === "expects-no-errors"),
      none: count(running, r => sourceOf(corpus, r) === "none"),
    },
    corpus: {
      files: corpus.files.files,
      bytes: corpus.files.bytes,
      sha256: corpus.files.sha256,
      typescriptBaselines: corpus.typescript.size,
      typescriptGoBaselines: {
        compiler: corpus.typescriptGo.compiler.size,
        conformance: corpus.typescriptGo.conformance.size,
      },
      expectsNoErrors: corpus.expectsNoErrors.size,
      accepted: corpus.accepted.size,
      triaged: corpus.triaged.size,
    },
    witness: {
      typescriptGoBaselineFiles: reference.baselineFiles,
      runInstancesNamedByOne: reference.named.size,
      runInstancesNamedByNone: running.length - reference.named.size,
      skippedInstancesWithTypescriptBaseline: count(skipped, r =>
        corpus.typescript.has(`${stemOf(r.name)}.errors.txt`),
      ),
    },
    go,
    suiteRun,
  };
  const countsAfter = JSON.stringify(after, null, 2) + "\n";

  const { instances: i, witness } = after;
  const unnamed = running.filter(r => !reference.named.has(r.name)).map(r => r.name);
  console.log(
    `cases ${cases.size}, of which ${reference.leftOut.size} are left out by name; instances ${i.all}: ${i.run} run (E ${i.E}, C ${i.C}), ${i.skipped} skipped`,
  );
  console.log(
    `baseline files of typescript-go: ${reference.baselineFiles}, each of an instance that runs; they name ${reference.named.size} of the ${i.run}, and not: ${some(unnamed, 40)}`,
  );
  console.log(
    `skipped instances with an error baseline of TypeScript: ${witness.skippedInstancesWithTypescriptBaseline} of ${i.skipped}`,
  );

  // The lines of the list by the name and its tab, the leaves of the counts by their path.
  const byName = (text: string) =>
    new Map(
      text
        .split("\n")
        .filter(l => l !== "")
        .map(l => [l.slice(0, l.indexOf("\t") + 1), l.slice(l.indexOf("\t") + 1)]),
    );
  const byPath = (value: unknown) => new Map([...leaves(value)].map(([path, leaf]) => [`${path}: `, leaf]));
  const expectedBefore = existsSync(expectedPath) ? readFileSync(expectedPath) : undefined;
  const changes = {
    list: listAfter !== listBefore,
    counts: countsAfter !== countsBefore,
    expected: expectedAfter !== undefined && expectedBefore?.equals(expectedAfter) !== true,
  };
  if (changes.list)
    printChanges(
      "fixtures/instances.tsv",
      listBefore === undefined ? undefined : byName(listBefore),
      byName(listAfter),
    );
  if (changes.counts)
    printChanges("reference_counts.json", before === undefined ? undefined : byPath(before), byPath(after));
  if (changes.expected) console.log(`${expectedBefore === undefined ? "A" : "M"} fixtures/directives-expected.json`);
  const any = changes.list || changes.counts || changes.expected;
  console.log(!any ? "nothing changes" : o.check ? "not written (--check)" : "written");
  if (o.check) return any ? 1 : 0;
  if (changes.list) writeFileSync(listPath, listAfter);
  if (changes.counts) writeFileSync(countsPath, countsAfter);
  if (changes.expected) writeFileSync(expectedPath, expectedAfter!);
  return 0;
}

process.exit(await main());
