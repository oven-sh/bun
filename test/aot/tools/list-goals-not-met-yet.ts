// Writes test/aot/goals-not-met-yet.md: every goal of the compiler that a test says is not met yet, out of the marks in the tree.
//
//   bun test/aot/tools/list-goals-not-met-yet.ts                   writes the page and prints its counts
//   bun test/aot/tools/list-goals-not-met-yet.ts --check           writes nothing; prints the difference and exits with 1 where the page is stale
//   bun test/aot/tools/list-goals-not-met-yet.ts --since <a tree>  also prints how many of the goals that older tree does not have
//
// It reads the tree and builds nothing. The marks of a goal, each of which runs at every run and turns red once the goal is met:
//   a case of a test file that is declared with `failing`, in whatever way the file spells it and puts its name together: a row of a table that is wrapped in `gap()` is one
//   `// STATISTIC: <count> <= <bound> Todo: <why>`, `// Todo: <why>`, `// Todo on <platform>: <why>` in a program under test/aot/parallel
//   `# TODO: <why>` in an IR test, under test/aot and among the tests of the engine ($AOT_ENGINE_TESTS, or aot/tests in $BUN_WEBKIT_PATH)
//   `// Todo: <why>` on the line above `#[should_panic]` in a crate of the front end
// A mark may stand on a wrong answer: a right program answers otherwise compiled than plain, and nothing says so when it runs. That is no goal, and is
// listed apart, in front of the goals. The name of the case, or the reason of the mark, says it:
//   <what is to hold>: a wrong answer today: under `<the compiled run>` <what happens>, where `<the plain run>` <what happens>
// A name that is put together while the file runs cannot be read off its text. So each test file from which a mark can be reached is
// loaded by a `bun test` of its own in which a stand-in takes the place of bun:test: `describe` runs what it is handed, every case is
// written down under its name, and no case and no hook is run. What a test writes into a file for a Bun that it starts is text, and is
// left out. A test file outside test/aot that never speaks of the compiler is Bun's own, and is left out too.
// A file may choose its mark by the platform: `(isWindows ? test.failing : test)(..)`. The stand-in writes down on which lines a mark was evaluated, and
// a line that spells a mark and was not is listed at the end of the page: what it marks is declared elsewhere, and is missing from the tables.
// Run it with the Bun under test on Linux: some files ask that Bun what it can do before they declare their cases.
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

let root = resolve(import.meta.dir, "../../..");
const page = "test/aot/goals-not-met-yet.md";
const foldersOfTests = ["test/aot", "test/bundler", "test/cli", "test/internal"];
const wholeFileIsDeclared = "the whole file is declared and nothing of it has run";

const writesTo = "GOALS_NOT_MET_YET_ARE_WRITTEN_TO";

type Declared = { name: string; failing: boolean; todo: boolean };
type Goal = { file: string; name: string; measured: string; bound: string; keeps: string };
type Apart = { file: string; name: string };
type WrongAnswer = { file: string; name: string; plain: string; compiled: string };
type Found = {
  wrongAnswers: WrongAnswer[];
  goals: Goal[];
  declareNothing: string[];
  withEngine: boolean;
};

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
  const evaluated = new Set<string>();
  let groupsToDo = 0;

  // Every frame, and not the nearest: a file may read `test` through a proxy of a helper, which reads the mark for it.
  const noteWhereTheMarkIsEvaluated = () => {
    for (const [, file, line] of (new Error().stack ?? "").matchAll(/\(?(\/[^\s():]+):(\d+):\d+\)?/g)) evaluated.add(`${file}:${line}`);
  };

  const anything: any = new Proxy(function () {}, {
    get: (_, key) => (key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : anything),
    apply: () => anything,
    construct: () => anything,
  });

  type Marks = { failing: boolean; todo: boolean };
  const declarer = (isGroup: boolean, marks: Marks): any => {
    const one = (name: unknown, second?: unknown, third?: unknown, values: unknown[] = []) => {
      const text = String(typeof name === "function" ? name.name : name);
      if (!isGroup) {
        declared.push({ name: [...groups, text].join(" > "), failing: marks.failing, todo: marks.todo || groupsToDo > 0 });
        return;
      }
      const body = typeof second === "function" ? second : third;
      groups.push(text);
      groupsToDo += Number(marks.todo);
      try {
        if (typeof body === "function") stillDeclaring.push(body(...values));
      } finally {
        groupsToDo -= Number(marks.todo);
        groups.pop();
      }
    };
    const where = (changed: Partial<Marks>) => (holds: unknown) => {
      if (holds && (changed.failing || changed.todo)) noteWhereTheMarkIsEvaluated();
      return declarer(isGroup, holds ? { ...marks, ...changed } : marks);
    };
    return new Proxy(one, {
      get(target, key) {
        if (key === "failing" || key === "todo") noteWhereTheMarkIsEvaluated();
        if (key === "failing") return declarer(isGroup, { ...marks, failing: true });
        if (key === "todo") return declarer(isGroup, { ...marks, todo: true });
        if (key === "skip" || key === "only" || key === "concurrent" || key === "serial") return declarer(isGroup, marks);
        if (key === "todoIf") return where({ todo: true });
        if (key === "failingIf") return where({ failing: true });
        if (key === "if" || key === "skipIf" || key === "concurrentIf" || key === "serialIf") return where({});
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
  const plain = { failing: false, todo: false };
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
    writeFileSync(out, JSON.stringify({ declared, evaluated: [...evaluated] }));
    process.exit(0);
  };
}

// ---- the files from which a mark can be reached

function filesBelow(folder: string, wanted: (name: string) => boolean, base = root): string[] {
  const found: string[] = [];
  const walk = (below: string) => {
    for (const entry of readdirSync(join(base, below), { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = join(below, entry.name);
      const kind = entry.isSymbolicLink() ? statSync(join(base, path), { throwIfNoEntry: false }) : entry;
      if (kind?.isDirectory()) walk(path);
      else if (kind?.isFile() && wanted(entry.name)) found.push(path);
    }
  };
  if (existsSync(join(base, folder))) walk(folder);
  return found.sort();
}

// `gap()` of supported.ts marks a row of a table that `eachRow()` then declares with `failing`. That file defines the two and marks nothing.
const spelling = /\.failing(?:If)?\b|\bgap\(/;
const marksNothingItself = "test/aot/supported.ts";
const speaksOfTheCompiler = /\baot\b|--trim\b/i;
const marksReachedFrom = new Map<string, Set<string>>();

function filesWithMarksReachedFrom(file: string): Set<string> {
  const known = marksReachedFrom.get(file);
  if (known) return known;
  const reached = new Set<string>();
  marksReachedFrom.set(file, reached);
  const text = readFileSync(join(root, file), "utf8");
  if (file !== marksNothingItself && spelling.test(text)) reached.add(file);
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
function marksInTheCodeOf(text: string, mark: "failing" | "todo"): [number, string][] {
  const spelled = new RegExp(`^\\.${mark}(?:If)?(?:\\s*[():]|\\.(?:each|if|skipIf|todoIf|only|concurrent|serial)\\b|$)`);
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
      else if (here === "." && spelled.test(line.slice(at))) {
        found.push([index + 1, line.trim()]);
        break;
      }
    }
  });
  return found;
}

// ---- what a name says

const saysWrongAnswer = "a wrong answer today: ";

function wrongAnswerIn(file: string, name: string): WrongAnswer | undefined {
  const at = name.indexOf(saysWrongAnswer);
  if (at < 0) return undefined;
  const said = name.slice(at + saysWrongAnswer.length);
  const both = /^under (`[^`]+`) (.+), where (`[^`]+`) (.+)$/.exec(said);
  return {
    file,
    name: name.slice(0, at).replace(/: $/, "") || name,
    plain: both ? `${both[3]} ${both[4]}` : "not said",
    compiled: both ? `under ${both[1]} ${both[2]}` : said,
  };
}

function take(found: Found, goal: Goal) {
  const wrong = wrongAnswerIn(goal.file, goal.name);
  if (wrong) found.wrongAnswers.push(wrong);
  else found.goals.push(goal);
}

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
const cannotGrowWorse = "nothing need";
const comparedBetweenRuns =
  "two runs compared: the driver prints what it counted, and test/aot/tools/goals-that-grew.ts names a count that moved further from its bound";

// A case holds a goal to what is reached today where it stands in the same file, is not itself marked, and says so in one of three ways:
//   under the same head, a ceiling or a floor with the number: "no more .. than 15", "at most 15", "at least 59%"
//   the title of the goal and then what is left: "hello world keeps no family but those of proxies and of .."
//   the title of the goal and then ": what is reached", ": what the two builds hold today" and the like; ": what it prints" is none
// A case under the title of the goal alone is none: it may as well take whatever the mark is about.
const saysWhatIsReached = (behindTheTitle: string) => /^: what\b.*\b(?:reached|holds?|held|today)\b/.test(behindTheTitle);

function whatKeeps(goal: { name: string; measured: string }, others: Declared[]): string {
  if (!goal.measured) {
    return /\bthe (?:bound|goal|limit|floor|budget) (?:is|of)\b/.test(goal.name) ? "nothing: the name says no measured number beside its bound" : yesOrNo;
  }
  let endOfTitle = goal.name.indexOf(": ", goal.name.lastIndexOf(" > ") + 1);
  if (/(?:^|> )known bug$/.test(goal.name.slice(0, endOfTitle))) endOfTitle = goal.name.indexOf(": ", endOfTitle + 2);
  const title = goal.name.slice(0, endOfTitle);
  const byTitle = title && others.find(other => !other.failing && !other.todo && (other.name.startsWith(`${title} but `) || (other.name.startsWith(title) && saysWhatIsReached(other.name.slice(title.length)))));
  if (byTitle) return `the case beside it: ${byTitle.name}`;
  const spelled = [goal.measured.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), inWords[Number(goal.measured)]].filter(Boolean).join("|");
  const holdsToTheNumber = new RegExp(
    `(?:\\bno (?:more|fewer|less)\\b[^:;]*? than|\\bat (?:most|least)|\\bnot (?:more|over|under|fewer|less) than) (?:${spelled})(?![\\w]|,\\d|\\.\\d)`,
  );
  const [pin] = others
    .filter(other => !other.failing && !other.todo && holdsToTheNumber.test(other.name) && sharesItsHead(other.name, goal.name))
    .sort((one, other) => commonHead(other.name, goal.name) - commonHead(one.name, goal.name));
  if (pin) return `the case beside it: ${pin.name}`;
  if (Number(goal.measured.replaceAll(",", "")) === 0) return `${cannotGrowWorse}: it stands at zero, and nothing lies under that`;
  if (new RegExp(`\\b(?:${spelled}) of (?:the |its |all )?(?:${spelled})\\b`).test(goal.name)) return `${cannotGrowWorse}: it counts all that there are`;
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

// ---- the marks

async function marksOfTestFiles(found: Found) {
  const files = foldersOfTests
    .flatMap(folder => filesBelow(folder, name => /\.test\.[cm]?[jt]sx?$/.test(name)))
    .filter(file => filesWithMarksReachedFrom(file).size)
    .filter(file => speaksOfTheCompiler.test(file) || speaksOfTheCompiler.test(readFileSync(join(root, file), "utf8")));
  const room = mkdtempSync(join(tmpdir(), "goals-not-met-yet-"));
  const refused: string[] = [];
  const withMarks = new Set(files.flatMap(file => [...filesWithMarksReachedFrom(file)]));
  const evaluated = new Set<string>();
  const roots = [...new Set([root, realpathSync(root)])].map(path => path + "/");
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      const out = join(room, `${index}.json`);
      const loads = join(room, `${index}.test.ts`);
      writeFileSync(
        loads,
        `await import(${JSON.stringify(join(root, file))});\nawait (globalThis as any)[Symbol.for(${JSON.stringify(wholeFileIsDeclared)})]();\n`,
      );
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
      const { declared, evaluated: lines }: { declared: Declared[]; evaluated: string[] } = JSON.parse(readFileSync(out, "utf8"));
      for (const line of lines) for (const start of roots) if (line.startsWith(start)) evaluated.add(line.slice(start.length));
      for (const one of declared) {
        if (one.failing) take(found, goalOf(file, one.name, declared));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, availableParallelism()) }, worker));
  rmSync(room, { recursive: true, force: true });
  if (refused.length) {
    console.error(`${refused.length} test files could not be declared:\n` + refused.join("\n"));
    process.exit(2);
  }
  for (const file of [...withMarks].sort()) {
    for (const mark of file.startsWith("test/aot/") ? (["failing", "todo"] as const) : (["failing"] as const)) {
      for (const [line, text] of marksInTheCodeOf(readFileSync(join(root, file), "utf8"), mark)) {
        if (!evaluated.has(`${file}:${line}`)) found.declareNothing.push(`${file}:${line}: ${text}`);
      }
    }
  }
}

function goalOf(file: string, name: string, others: Declared[] = []): Goal {
  const numbers = numbersIn(name);
  return { file, name, ...numbers, keeps: whatKeeps({ name, ...numbers }, others) };
}

function marksOfStoredPrograms(found: Found) {
  for (const file of filesBelow("test/aot/parallel", name => /\.[cm]?[jt]sx?$/.test(name))) {
    const text = readFileSync(join(root, file), "utf8");
    if (!text.includes(" Todo")) continue;
    for (const line of text.split("\n")) {
      const count = /^\/\/ (?:STATISTIC|COUNT|COUNTER): ([\w:]+) (=|>=|<=) (\d+) Todo( [ \w=.-]+)?: (.+)$/.exec(line);
      const answer = /^\/\/ Todo( [ \w=.-]+)?: (.+)$/.exec(line);
      if (count) {
        const [, what, relation, bound, where = "", why] = count;
        take(found, {
          file,
          name: `${what} ${relation} ${bound}${where}: ${why}`,
          measured: "",
          bound: `${relation} ${bound}`,
          keeps: comparedBetweenRuns,
        });
      } else if (answer) {
        const [, where = "", why] = answer;
        take(found, { file, name: `it answers as plain Bun${where}: ${why}`, measured: "", bound: "", keeps: yesOrNo });
      }
    }
  }
}

function marksOfIRTests(found: Found) {
  const { AOT_ENGINE_TESTS, BUN_WEBKIT_PATH } = process.env;
  const inCheckout = "Source/JavaScriptCore/aot/tests";
  const ofEngine = [AOT_ENGINE_TESTS, BUN_WEBKIT_PATH && join(BUN_WEBKIT_PATH, inCheckout), join(root, "vendor/WebKit", inCheckout)].find(
    path => path && existsSync(path),
  );
  found.withEngine = ofEngine !== undefined;
  for (const [base, folder, shown] of [
    [root, "test/aot", ""],
    ...(ofEngine ? [[ofEngine, ".", "the engine: aot/tests/"]] : []),
  ]) {
    for (const file of filesBelow(folder, name => name.endsWith(".ir"), base)) {
      for (const [, why] of readFileSync(join(base, file), "utf8").matchAll(/^# TODO:? *(.+)$/gm)) {
        take(found, goalOf(shown + file, why));
      }
    }
  }
}

function marksOfCrates(found: Found) {
  for (const folder of ["src/aot", "src/sema", "src/bundler/aot"]) {
    for (const file of filesBelow(folder, name => name.endsWith(".rs"))) {
      const lines = readFileSync(join(root, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        const why = /^\s*#\[should_panic/.test(line) && /^\s*\/\/ Todo: (.+)$/.exec(lines[index - 1] ?? "")?.[1];
        if (why) take(found, goalOf(file, why));
      });
    }
  }
}

async function marksIn(tree: string): Promise<Found> {
  root = tree;
  marksReachedFrom.clear();
  const found: Found = { wrongAnswers: [], goals: [], declareNothing: [], withEngine: false };
  await marksOfTestFiles(found);
  marksOfStoredPrograms(found);
  marksOfIRTests(found);
  marksOfCrates(found);
  const inOrder = (one: Apart, other: Apart) =>
    one.file < other.file ? -1 : one.file > other.file ? 1 : one.name < other.name ? -1 : one.name > other.name ? 1 : 0;
  found.wrongAnswers.sort(inOrder);
  found.goals.sort(inOrder);
  return found;
}

// ---- the page

const kinds: [string, RegExp][] = [
  [
    "on what a program reaches of the library and what --trim keeps",
    /trim|reach|functions? for|built-ins?|librar|locale|interpreter stays|Lowered|bytes|escape|opens|left out|unused|keeps nothing|holds none|brings/i,
  ],
  ["on how a build grows with its program", /grow|square|scal|\bG\b|instructions|peak|\bMB\b|seconds|times as|linear/i],
];
const kindOf = ({ file, name }: Goal) => kinds.find(([, words]) => words.test(`${file} ${name}`))?.[0] ?? "on other things";
const filesOf = (rows: Apart[]) => new Set(rows.map(row => row.file)).size;
const inCell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
const rowOf = (...cells: string[]) => `| ${cells.map(inCell).join(" | ")} |`;

function countsOf({ wrongAnswers, goals, declareNothing, withEngine }: Found): string[] {
  const ofKind = Map.groupBy(goals, kindOf);
  const byKind = [...kinds.map(([kind]) => kind), "on other things"].flatMap(kind =>
    ofKind.has(kind) ? [`${ofKind.get(kind)!.length} ${kind}`] : [],
  );
  const count = (start: string) => goals.filter(goal => goal.keeps.startsWith(start)).length;
  return [
    `${wrongAnswers.length} wrong answers in ${filesOf(wrongAnswers)} files stand under a mark. They are no goals, and are not counted among them.`,
    `${goals.length} goals in ${filesOf(goals)} files: ${byKind.join(", ")}.`,
    `${count(yesOrNo)} of them are a yes or a no. Of the others ${count("the case beside it")} are held to what is reached today by a case beside them, ${count("nothing yet")} could be, ${count(cannotGrowWorse)} cannot grow worse, ${count(comparedBetweenRuns)} are counted at every run and compared between runs, ${count("nothing in the tree")} move with the platform and with every change, and ${count("nothing: ")} say no measured number.`,
    ...(declareNothing.length
      ? [`${declareNothing.length} lines spell a mark from which no case was declared where this page was written. What they mark is not counted.`]
      : []),
    ...(withEngine ? [] : ["The tests of the engine were not at hand: their marks are not counted."]),
  ];
}

function write(found: Found): string {
  const said = (text: string, else_: string, goal: Goal) =>
    text || (goal.keeps === yesOrNo ? else_ : goal.keeps === comparedBetweenRuns ? "printed by the run" : "not said");
  return [
    "# Goals that are not met yet",
    "",
    "This page is written by `bun test/aot/tools/list-goals-not-met-yet.ts` out of the marks in the tree. Do not edit it: change the mark and run the tool.",
    "",
    ...countsOf(found).flatMap(line => [line, ""]),
    "## Wrong answers under a mark",
    "",
    "A right program answers otherwise where it is compiled, and nothing says so when it runs. The case expects what plain Bun says and is marked as",
    "known to fail, so the run stays green; it turns red once the compiled run says the same, so that the mark is taken away.",
    "",
    "| file | case | plain | compiled |",
    "|---|---|---|---|",
    ...found.wrongAnswers.map(({ file, name, plain, compiled }) => rowOf(file, name, plain, compiled)),
    "",
    "## Goals",
    "",
    "Each row is a test that is known to fail today, and says so itself. It runs at every run of the tests; the run stays green while the goal",
    "is not met, and turns red once it is met, so that the mark is taken away. A mark does not see its number grow worse: the last column says",
    "what does.",
    "",
    "| file | case | measured | bound | what keeps the number from growing worse |",
    "|---|---|---|---|---|",
    ...found.goals.map(goal => rowOf(goal.file, goal.name, said(goal.measured, "no", goal), said(goal.bound, "yes", goal), goal.keeps)),
    "",
    ...(found.declareNothing.length
      ? [
          "## Marks from which no case was declared",
          "",
          "These lines spell a mark that was not evaluated where this page was written: the file chooses by what that Bun or its platform can do.",
          "What they mark is missing above.",
          "",
          ...found.declareNothing.map(line => `- \`${line.replaceAll("`", "'")}\``),
          "",
        ]
      : []),
  ].join("\n");
}

if (process.env[writesTo]) {
  await declareInTheRunner(process.env[writesTo]!);
} else {
  const operands = process.argv.slice(2);
  const here = root;
  const found = await marksIn(here);
  const written = write(found);
  const stands = existsSync(join(here, page)) ? readFileSync(join(here, page), "utf8") : "";
  if (operands.includes("--check")) {
    if (written !== stands) {
      const [now, before] = [new Set(written.split("\n")), new Set(stands.split("\n"))];
      for (const line of before) if (!now.has(line)) console.log(`- ${line}`);
      for (const line of now) if (!before.has(line)) console.log(`+ ${line}`);
      console.log(`${page} is stale: run bun test/aot/tools/list-goals-not-met-yet.ts`);
      process.exit(1);
    }
  } else {
    writeFileSync(join(here, page), written);
    console.log(`${page}${written === stands ? ", as it stood" : ""}:\n${countsOf(found).join("\n")}`);
  }
  if (operands.includes("--since")) {
    // A goal whose number has moved is the same goal.
    const sameGoal = ({ file, name }: Apart) => `${file} | ${name.replace(/\d[\d,.]*/g, "#")}`;
    const all = ({ wrongAnswers, goals }: Found) => [...wrongAnswers, ...goals];
    const older = resolve(operands[operands.indexOf("--since") + 1]);
    const had = new Set(all(await marksIn(older)).map(sameGoal));
    console.log(`${all(found).filter(goal => !had.has(sameGoal(goal))).length} of the wrong answers and goals are not in ${older}.`);
  }
}
