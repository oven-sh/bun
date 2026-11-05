// Writes test/aot/goals-not-met-yet.md: every goal of the compiler that a test says is not met yet, out of the marks in the tree.
//
//   bun test/aot/tools/list-goals-not-met-yet.ts           writes the page
//   bun test/aot/tools/list-goals-not-met-yet.ts --check   writes nothing; prints the difference and exits with 1 where the page is stale
//
// It reads the tree and builds nothing. The marks:
//   a case of a test file that is declared with `failing`, in whatever way the file spells it and puts its name together
//   `// STATISTIC: <count> <= <bound> Todo: <why>`, `// Todo: <why>` and `// Todo on <platform>: <why>` in a program under test/aot/parallel
//   `#[should_panic]` on a test of a crate whose name ends in `not_met_yet`
// A name that is put together while the file runs cannot be read off its text. So each test file from which a `failing` can be reached is
// loaded by a `bun test` of its own in which a stand-in takes the place of bun:test: `describe` runs what it is handed, every case is
// written down under its name, and no case and no hook is run. What a test writes into a file for a Bun that it starts is text, and is
// left out.
// Run it with the Bun under test on Linux: some files ask that Bun what it can do before they declare their cases.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const page = "test/aot/goals-not-met-yet.md";
const foldersOfTests = ["test/aot", "test/bundler", "test/cli", "test/internal"];
const wholeFileIsDeclared = "the whole file is declared and nothing of it has run";

const writesTo = "GOALS_NOT_MET_YET_ARE_WRITTEN_TO";

type Declared = { name: string; failing: boolean; leftOut: boolean };
type Goal = { file: string; name: string; measured: string; bound: string; keeps: string };

// ---- one test file is declared

function nameOfRow(template: string, row: unknown, index: number): string {
  const values = Array.isArray(row) ? [...row] : [row];
  const shown = (value: unknown) => (typeof value === "string" ? value : Bun.inspect(value));
  let name = template;
  if (!Array.isArray(row) && typeof row === "object" && row !== null) {
    name = name.replace(/\$([A-Za-z_][\w.]*)/g, (whole, keys: string) => {
      let value: any = row;
      for (const key of keys.split(".")) value = value?.[key];
      return value === undefined ? whole : shown(value);
    });
  }
  return name.replace(/\$#/g, String(index)).replace(/%([sdifjop#%])/g, (whole, kind: string) => {
    if (kind === "%") return "%";
    if (kind === "#") return String(index);
    if (!values.length) return whole;
    const value = values.shift();
    if (kind === "s") return typeof value === "object" && value !== null ? Bun.inspect(value) : String(value);
    if (kind === "d" || kind === "f") return String(Number(value));
    if (kind === "i") return String(Math.floor(Number(value)));
    if (kind === "j") return JSON.stringify(value);
    return Bun.inspect(value);
  });
}

async function declareInTheRunner(out: string) {
  const declared: Declared[] = [];
  const groups: string[] = [];
  const stillDeclaring: unknown[] = [];
  let groupsLeftOut = 0;

  const anything: any = new Proxy(function () {}, {
    get: (_, key) => (key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : anything),
    apply: () => anything,
    construct: () => anything,
  });

  type Marks = { failing: boolean; leftOut: boolean };
  const declarer = (isGroup: boolean, marks: Marks): any => {
    const one = (name: unknown, second?: unknown, third?: unknown, values: unknown[] = []) => {
      const text = String(typeof name === "function" ? name.name : name);
      if (!isGroup) {
        const leftOut = marks.leftOut || groupsLeftOut > 0;
        declared.push({ name: [...groups, text].join(" > "), failing: marks.failing, leftOut });
        return;
      }
      const body = typeof second === "function" ? second : third;
      groups.push(text);
      groupsLeftOut += Number(marks.leftOut);
      try {
        if (typeof body === "function") stillDeclaring.push(body(...values));
      } finally {
        groupsLeftOut -= Number(marks.leftOut);
        groups.pop();
      }
    };
    const where = (changed: Partial<Marks>) => (holds: unknown) => declarer(isGroup, holds ? { ...marks, ...changed } : marks);
    return new Proxy(one, {
      get(target, key) {
        if (key === "failing") return declarer(isGroup, { ...marks, failing: true });
        if (key === "skip" || key === "todo") return declarer(isGroup, { ...marks, leftOut: true });
        if (key === "only" || key === "concurrent" || key === "serial") return declarer(isGroup, marks);
        if (key === "if") return (holds: unknown) => declarer(isGroup, holds ? marks : { ...marks, leftOut: true });
        if (key === "skipIf" || key === "todoIf") return where({ leftOut: true });
        if (key === "failingIf") return where({ failing: true });
        if (key === "concurrentIf" || key === "serialIf") return where({});
        if (key === "each") {
          return (table: unknown[]) => (name: string, second?: unknown, third?: unknown) =>
            table.forEach((row, index) =>
              one(nameOfRow(String(name), row, index), second, third, Array.isArray(row) ? row : [row]),
            );
        }
        return Reflect.get(target, key);
      },
    });
  };
  const plain = { failing: false, leftOut: false };
  const nothing = () => {};
  const test = declarer(false, plain);
  const describe = declarer(true, plain);

  const { mock } = await import("bun:test");
  mock.module("bun:test", () => ({
    test,
    it: test,
    xtest: test.skip,
    xit: test.skip,
    describe,
    xdescribe: describe.skip,
    expect: anything,
    expectTypeOf: anything,
    mock: anything,
    spyOn: anything,
    jest: anything,
    vi: anything,
    beforeAll: nothing,
    beforeEach: nothing,
    afterAll: nothing,
    afterEach: nothing,
    onTestFinished: nothing,
    setDefaultTimeout: nothing,
    setSystemTime: nothing,
  }));

  (globalThis as any)[Symbol.for(wholeFileIsDeclared)] = async () => {
    await Promise.all(stillDeclaring);
    writeFileSync(out, JSON.stringify(declared));
    process.exit(0);
  };
}

// ---- the files from which a mark can be reached

function filesBelow(folder: string, wanted: (name: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (below: string) => {
    for (const entry of readdirSync(join(root, below), { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = join(below, entry.name);
      const kind = entry.isSymbolicLink() ? statSync(join(root, path), { throwIfNoEntry: false }) : entry;
      if (kind?.isDirectory()) walk(path);
      else if (kind?.isFile() && wanted(entry.name)) found.push(path);
    }
  };
  if (existsSync(join(root, folder))) walk(folder);
  return found.sort();
}

const spelling = /\.failing(?:If)?\b/;
const marksReachedFrom = new Map<string, Set<string>>();

function filesWithMarksReachedFrom(file: string): Set<string> {
  const known = marksReachedFrom.get(file);
  if (known) return known;
  const reached = new Set<string>();
  marksReachedFrom.set(file, reached);
  const text = readFileSync(join(root, file), "utf8");
  if (spelling.test(text)) reached.add(file);
  for (const [, written] of text.matchAll(/(?:\bfrom|\bimport|\brequire\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    const base = join(dirname(file), written);
    const imported = [base, base + ".ts", base + ".tsx", base + ".js", base + "/index.ts"].find(
      path => /\.[cm]?[jt]sx?$/.test(path) && existsSync(join(root, path)),
    );
    if (imported) for (const marked of filesWithMarksReachedFrom(imported)) reached.add(marked);
  }
  return reached;
}

// The lines on which a mark is spelled in the code itself: not in a string, a template or a comment.
function marksInTheCodeOf(text: string): [number, string][] {
  const found: [number, string][] = [];
  let open = "";
  text.split("\n").forEach((line, index) => {
    if (open !== "`" && open !== "*") open = "";
    for (let at = 0; at < line.length; at++) {
      const here = line[at];
      if (open === "*") {
        if (here === "*" && line[at + 1] === "/") open = "";
      } else if (here === "\\") at++;
      else if (open) {
        if (here === open) open = "";
      } else if (here === "/" && line[at + 1] === "/") break;
      else if (here === "/" && line[at + 1] === "*") open = "*";
      else if (here === '"' || here === "'" || here === "`") open = here;
      else if (here === "." && /^\.failing(?:If)?(?:\s*[():]|\.(?:each|if|skipIf|todoIf|only|concurrent|serial)\b|$)/.test(line.slice(at))) {
        found.push([index + 1, line.trim()]);
        break;
      }
    }
  });
  return found;
}

// ---- what a name says

const number = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?: ?%| ?[KMG]B\b| bytes\b| times\b)?`;
const none = String.raw`none|nothing|no\b|zero`;
const between = String.raw`[^:;]*?`;
const waysToSayBoth = [
  new RegExp(`(${number})${between}[,;] the bound is (${number}|${none})`),
  new RegExp(`(${number})${between}\\bthe goal is (?:at most |at least )?(${number}|${none})`),
  new RegExp(`(${number}) against a limit of (${number})`),
  new RegExp(`(${number}) of the (budget)\\b`),
  new RegExp(`(${number})${between}\\bfor (?:a (?:floor|bound|limit|ceiling) of |at most |at least |no more than )?(${number}|${none})`),
  new RegExp(`(${number})${between}, (none) may\\b`),
  new RegExp(`(${number})${between}, (nothing) need be\\b`),
  new RegExp(`(${number})${between}, the (?:executable|test run|texts name) (${number})`),
];

function numbersIn(name: string): { measured: string; bound: string } {
  for (const way of waysToSayBoth) {
    const found = way.exec(name);
    if (!found) continue;
    const bound = new RegExp(`^(?:${none})$`).test(found[2]) ? "0" : found[2] === "budget" ? "1.00" : found[2];
    return { measured: found[1], bound };
  }
  return { measured: "", bound: "" };
}

const inWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const movesByPlatformAndByChange = (measured: string, name: string) =>
  /[%KMG]|bytes|times|\./.test(measured) ||
  Number(measured.replaceAll(",", "")) >= 1000 ||
  new RegExp(`${measured} (?:\\w+ )?(?:functions|modules|names|built-ins|instructions)\\b`).test(name);

const yesOrNo = "no number: the goal is a yes or a no";

// A case holds a goal to what is reached today where it stands in the same file, is not itself marked, and says so in one of three ways:
//   under the same head, a ceiling or a floor with the number: "no more .. than 15", "at most 15", "at least 59%"
//   the title of the goal and then what is left: "hello world keeps no family but those of proxies and of .."
//   the title of the goal and then ": what is reached"
function whatKeeps(goal: { name: string; measured: string }, others: Declared[]): string {
  if (!goal.measured) {
    return /\bthe (?:bound|goal|limit|floor|budget) (?:is|of)\b/.test(goal.name) ? "nothing: the name says no measured number beside its bound" : yesOrNo;
  }
  const title = goal.name.slice(0, goal.name.indexOf(": ", goal.name.lastIndexOf(" > ") + 1));
  const byTitle = title && others.find(other => !other.failing && (other.name.startsWith(`${title} but `) || other.name === `${title}: what is reached`));
  if (byTitle) return `the case beside it: ${byTitle.name}`;
  const spelled = [goal.measured.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), inWords[Number(goal.measured)]].filter(Boolean).join("|");
  const holdsToTheNumber = new RegExp(
    `(?:\\bno (?:more|fewer|less)\\b[^:;]*? than|\\bat (?:most|least)|\\bnot (?:more|over|under|fewer|less) than) (?:${spelled})(?![\\w]|,\\d|\\.\\d)`,
  );
  const [pin] = others
    .filter(other => !other.failing && holdsToTheNumber.test(other.name) && sharesItsHead(other.name, goal.name))
    .sort((one, other) => commonHead(other.name, goal.name) - commonHead(one.name, goal.name));
  if (pin) return `the case beside it: ${pin.name}`;
  return movesByPlatformAndByChange(goal.measured, goal.name)
    ? "nothing in the tree: the number moves with the platform and with every change, so a run that records it has to watch it"
    : "nothing yet: one more case beside it could hold it to this number";
}

function commonHead(one: string, other: string): number {
  let same = 0;
  while (same < one.length && one[same] === other[same]) same++;
  return same;
}

const sharesItsHead = (one: string, other: string) =>
  commonHead(one, other) >= Math.min(12, Math.floor(Math.min(one.length, other.length) / 3));

// ---- the three kinds of marks

const marksThatDeclareNothing: string[] = [];

async function goalsOfTestFiles(): Promise<Goal[]> {
  const files = foldersOfTests.flatMap(folder => filesBelow(folder, name => /\.test\.[cm]?[jt]sx?$/.test(name))).filter(file => filesWithMarksReachedFrom(file).size);
  const room = mkdtempSync(join(tmpdir(), "goals-not-met-yet-"));
  const goals: Goal[] = [];
  const refused: string[] = [];
  const declaresNone = new Set(files.flatMap(file => [...filesWithMarksReachedFrom(file)]));
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      const out = join(room, `${index}.json`);
      const loads = join(room, `${index}.test.ts`);
      writeFileSync(loads, `await import(${JSON.stringify(join(root, file))});\nawait (globalThis as any)[Symbol.for(${JSON.stringify(wholeFileIsDeclared)})]();\n`);
      const child = Bun.spawn({
        cmd: [process.execPath, "test", "--expose-internals", "--preload", import.meta.path, loads],
        cwd: root,
        env: { ...process.env, NO_COLOR: "1", [writesTo]: out },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        timeout: 120_000,
      });
      const [said] = await Promise.all([child.stderr.text(), child.exited]);
      if (!existsSync(out)) {
        const errors = said.split("\n").filter(line => /error/i.test(line) && !/^\s*\d+ errors?$/.test(line));
        refused.push(`${file}: ${errors.slice(0, 4).join("\n  ") || said.trim().slice(-400)}`);
        continue;
      }
      const declared: Declared[] = JSON.parse(readFileSync(out, "utf8"));
      if (declared.some(one => one.failing)) for (const marked of filesWithMarksReachedFrom(file)) declaresNone.delete(marked);
      for (const one of declared) {
        if (!one.failing) continue;
        const numbers = numbersIn(one.name);
        goals.push({ file, name: one.name, ...numbers, keeps: whatKeeps({ name: one.name, ...numbers }, declared) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, availableParallelism()) }, worker));
  rmSync(room, { recursive: true, force: true });
  if (refused.length) {
    console.error(`${refused.length} test files could not be declared:\n` + refused.join("\n"));
    process.exit(2);
  }
  for (const file of [...declaresNone].sort()) {
    for (const [line, text] of marksInTheCodeOf(readFileSync(join(root, file), "utf8"))) {
      marksThatDeclareNothing.push(`${file}:${line}: ${text}`);
    }
  }
  return goals;
}

function goalsOfStoredPrograms(): Goal[] {
  const goals: Goal[] = [];
  for (const file of filesBelow("test/aot/parallel", name => /\.[cm]?[jt]sx?$/.test(name))) {
    const text = readFileSync(join(root, file), "utf8");
    if (!text.includes(" Todo")) continue;
    for (const line of text.split("\n")) {
      const count = /^\/\/ (?:STATISTIC|COUNT|COUNTER): ([\w:]+) (=|>=|<=) (\d+) Todo(?: on (\w+))?: (.+)$/.exec(line);
      const answer = /^\/\/ Todo(?: on ([\w ]+))?: (.+)$/.exec(line);
      if (count) {
        const [, what, relation, bound, platform, why] = count;
        goals.push({
          file,
          name: `${what} ${relation} ${bound}${platform ? ` on ${platform}` : ""}: ${why}`,
          measured: "",
          bound: `${relation} ${bound}`,
          keeps: "nothing: the line says no measured number",
        });
      } else if (answer) {
        const [, platform, why] = answer;
        goals.push({
          file,
          name: `it answers as plain Bun${platform ? ` on ${platform}` : ""}: ${why}`,
          measured: "",
          bound: "",
          keeps: yesOrNo,
        });
      }
    }
  }
  return goals;
}

function goalsOfCrates(): Goal[] {
  const goals: Goal[] = [];
  for (const file of filesBelow("src", name => name.endsWith(".rs"))) {
    const text = readFileSync(join(root, file), "utf8");
    if (!text.includes("not_met_yet")) continue;
    for (const [, expected, name] of text.matchAll(/#\[should_panic(?:\(expected = "([^"]*)"\))?\]\s*(?:#\[[^\]]*\]\s*)*fn (\w*not_met_yet)\b/g)) {
      const said = `${name.replaceAll("_", " ")}${expected ? `: ${expected}` : ""}`;
      const numbers = numbersIn(said);
      goals.push({ file, name: said, ...numbers, keeps: whatKeeps({ name: said, ...numbers }, []) });
    }
  }
  return goals;
}

// ---- the page

const inCell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

function write(goals: Goal[]): string {
  goals.sort((one, other) => (one.file < other.file ? -1 : one.file > other.file ? 1 : one.name < other.name ? -1 : one.name > other.name ? 1 : 0));
  const files = new Set(goals.map(goal => goal.file)).size;
  const withoutNumbers = goals.filter(goal => goal.keeps.startsWith("nothing: ")).length;
  const areYesOrNo = goals.filter(goal => goal.keeps === yesOrNo).length;
  const held = goals.filter(goal => goal.keeps.startsWith("the case beside it")).length;
  return [
    "# Goals that are not met yet",
    "",
    "This page is written by `bun test/aot/tools/list-goals-not-met-yet.ts` out of the marks in the tree. Do not edit it: change the mark and run the tool.",
    "",
    "Each row is a test that is known to fail today, and says so itself. It runs at every run of the tests; the run stays green while the",
    "goal is not met, and turns red once it is met, so that the mark is taken away. None of them is skipped. A mark does not see its number",
    "grow worse: the last column says what does.",
    "",
    `${goals.length} goals in ${files} files. ${areYesOrNo} are a yes or a no. Of the others ${held} are held to today's number by a case beside them, and ${withoutNumbers} say no measured number.`,
    "",
    "| file | case | measured | bound | what keeps the number from growing worse |",
    "|---|---|---|---|---|",
    ...goals.map(goal => `| ${[goal.file, goal.name, goal.measured || (goal.keeps === yesOrNo ? "no" : "not said"), goal.bound || (goal.keeps === yesOrNo ? "yes" : "not said"), goal.keeps].map(inCell).join(" | ")} |`),
    "",
    ...(marksThatDeclareNothing.length
      ? [
          "## Marks from which no case was declared",
          "",
          "These lines spell a mark in a file from which the Bun that wrote this page declared no case as failing: the file chooses by what",
          "that Bun or its platform can do. Their goals are missing above.",
          "",
          ...marksThatDeclareNothing.map(line => `- \`${line.replaceAll("`", "'")}\``),
          "",
        ]
      : []),
  ].join("\n");
}

if (process.env[writesTo]) {
  await declareInTheRunner(process.env[writesTo]!);
} else {
  const written = write([...(await goalsOfTestFiles()), ...goalsOfStoredPrograms(), ...goalsOfCrates()]);
  const stands = existsSync(join(root, page)) ? readFileSync(join(root, page), "utf8") : "";
  if (process.argv[2] !== "--check") {
    writeFileSync(join(root, page), written);
    console.log(`${page}: ${written.split("\n").filter(line => /^\| (?:test|src)\//.test(line)).length} goals${written === stands ? ", as it stood" : ""}`);
  } else if (written !== stands) {
    const [now, before] = [new Set(written.split("\n")), new Set(stands.split("\n"))];
    for (const line of before) if (!now.has(line)) console.log(`- ${line}`);
    for (const line of now) if (!before.has(line)) console.log(`+ ${line}`);
    console.log(`${page} is stale: run bun test/aot/tools/list-goals-not-met-yet.ts`);
    process.exit(1);
  }
}
