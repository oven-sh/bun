import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// A file writes the name of a Worker's file out, and the name goes through one more function of the library before a Worker gets it: Bun.fileURLToPath(),
// Bun.pathToFileURL(), URL.parse(), path.normalize(), path.resolve() of one path. Each answers with the file that it was given, so the build reads through it
// as it reads through the two functions of node:url. At the constructor that is the file the Worker starts from, and the build warns of nothing. Handed to a
// function of another file it is a name that the program writes out and passes along: the start there stays nameless, and the file is compiled all the same.
// An executable tells: the sources are moved away before it runs, and a Worker without its file never answers.
type Way = [name: string, write: (file: string) => string];
const written: Way[] = [
  ["Bun.fileURLToPath() of a URL", file => `Bun.fileURLToPath(new URL("./${file}", import.meta.url))`],
  ['fileURLToPath() of "bun"', file => `pathOf(new URL("./${file}", import.meta.url))`],
  ["Bun.fileURLToPath() of import.meta.resolve()", file => `Bun.fileURLToPath(import.meta.resolve("./${file}"))`],
  ["Bun.pathToFileURL()", file => `Bun.pathToFileURL(import.meta.dir + "/${file}")`],
  ["URL.parse() from import.meta.url", file => `URL.parse("./${file}", import.meta.url)`],
  ["URL.parse() from a constant that holds import.meta.url", file => `URL.parse("./${file}", base)`],
  ["a URL made again by URL.parse()", file => `URL.parse(new URL("./${file}", import.meta.url))`],
  ["path.normalize()", file => `normalize(join(import.meta.dir, "lib", "..", "${file}"))`],
  ["path.resolve() of one path", file => `resolve(join(import.meta.dir, "${file}"))`],
];
const ways = written.map(([name, write], index) => [name, write(`w${index + 1}.mjs`)]);
const answers = ways.map(([name], index) => `SEEN ${name} | w${index + 1}`);

// A file that is its own Worker hands its own path on.
const ownPaths: Way[] = [
  ["Bun.fileURLToPath() of import.meta.url", () => `Bun.fileURLToPath(import.meta.url)`],
  ["Bun.pathToFileURL() of import.meta.path", () => `Bun.pathToFileURL(import.meta.path)`],
  ["the text of that URL", () => `Bun.pathToFileURL(import.meta.path).href`],
  ["URL.parse() of import.meta.url", () => `URL.parse(import.meta.url)`],
  ["path.normalize() of import.meta.path", () => `normalize(import.meta.path)`],
  ["path.resolve() of import.meta.path", () => `resolve(import.meta.path)`],
];
const jobs = ownPaths.map(([name, write], index) => [name, write(""), `j${index + 1}`]);
const answersOfJobs = jobs.map(([name, , job]) => `SEEN ${name} | ${job}`);

// import(), require() and createRequire() read a name through the same functions. Each road leads to a file of its own.
const moduleRoads: Way[] = [
  [
    "import() of what Bun.fileURLToPath() answers",
    file => `(await import(Bun.fileURLToPath(new URL("./${file}", import.meta.url)))).default`,
  ],
  [
    "import() of the text of what Bun.pathToFileURL() answers",
    file => `(await import(Bun.pathToFileURL(import.meta.dir + "/${file}").href)).default`,
  ],
  [
    "import() of the text of what URL.parse() answers",
    file => `(await import(URL.parse("./${file}", import.meta.url).href)).default`,
  ],
  [
    "createRequire() of what Bun.fileURLToPath() answers",
    file => `createRequire(Bun.fileURLToPath(import.meta.url))("./${file}")`,
  ],
  [
    "createRequire() of what Bun.pathToFileURL() answers",
    file => `createRequire(Bun.pathToFileURL(import.meta.path))("./${file}")`,
  ],
  ["createRequire() of what URL.parse() answers", file => `createRequire(URL.parse(import.meta.url))("./${file}")`],
  [
    "createRequire() of what path.normalize() answers",
    file => `createRequire(normalize(import.meta.path))("./${file}")`,
  ],
];
const commonJsRoads: Way[] = [
  [
    "require() of a path that went through both functions of Bun",
    file => `require(Bun.fileURLToPath(Bun.pathToFileURL(__dirname + "/${file}")))`,
  ],
  [
    "require() of what require.resolve() answers, through both",
    file => `require(Bun.fileURLToPath(Bun.pathToFileURL(require.resolve("./${file.slice(0, -4)}"))))`,
  ],
  [
    "createRequire() of what Bun.pathToFileURL() answers, in a CommonJS file",
    file => `require("node:module").createRequire(Bun.pathToFileURL(__filename))("./${file}")`,
  ],
  [
    "createRequire() of what path.resolve() answers for one path, in a CommonJS file",
    file => `require("node:module").createRequire(require("node:path").resolve(__filename))("./${file}")`,
  ],
];
const roads = [...moduleRoads, ...commonJsRoads].map(([name, write], index) => [name, write(`l${index + 1}.cjs`)]);
const answersOfRoads = roads.map(([name], index) => `SEEN ${name} | l${index + 1}`);

const project: Record<string, string> = {
  ...Object.fromEntries(roads.map((_, index) => [`src/l${index + 1}.cjs`, `module.exports = "l${index + 1}";\n`])),
  "src/loads.cjs": roads
    .slice(moduleRoads.length)
    .map(([name, code]) => `exports[${JSON.stringify(name)}] = () => ${code};\n`)
    .join(""),
  "src/ask.mjs": `export const ask = worker => new Promise(done => {
  worker.onmessage = event => { done(event.data); worker.terminate(); };
  worker.onerror = event => { event.preventDefault(); done("error"); };
});
`,
  "src/pool.mjs": `import { ask } from "./ask.mjs";\nexport const start = entry => ask(new Worker(entry));\n`,
  // A pool from a package starts its Worker from an option.
  "node_modules/a-pool/package.json": `{ "name": "a-pool", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  "node_modules/a-pool/index.js": `export const run = options => new Promise(done => {
  const worker = new Worker(options.filename);
  worker.onmessage = event => { done(event.data); worker.terminate(); };
  worker.onerror = event => { event.preventDefault(); done("error"); };
});
`,
  ...Object.fromEntries(ways.map((_, index) => [`src/w${index + 1}.mjs`, `postMessage("w${index + 1}");\n`])),
  ...Object.fromEntries(
    jobs.map(([, code, job]) => [
      `src/${job}.mjs`,
      `import { normalize, resolve } from "node:path";
import { start } from "./pool.mjs";
export const answer = Bun.isMainThread ? start(${code}) : void postMessage("${job}");
`,
    ]),
  ),
};
const head = (helper: string) => `import { join, normalize, resolve } from "node:path";
import { fileURLToPath as pathOf } from "bun";
import ${helper};
const base = import.meta.url;
const say = async (name, answer) => console.log("SEEN " + name + " | " + (await answer().catch(() => "no file")));
`;
const said = (write: (code: string, index: number) => string) =>
  ways
    .map(([name, code], index) => `await say(${JSON.stringify(name)}, async () => ${write(code, index)});\n`)
    .join("");
const atTheConstructor = said(code => `ask(new Worker(${code}))`);

// What the load reads doesn't hang on the threads of a build. One thread keeps these builds out of a race between the threads of the engine that a debug build
// of Bun dies of now and then. The stored program workers/the-build-warns-of-no-worker-whose-file-it-has-named/through-one-more-function-of-the-library
// builds the same names on every thread.
const compile = (executable: string, entry: string) => [
  bunExe(),
  ...compileCommand,
  withThreads(1),
  "--outfile",
  executable,
  entry,
];
const warnings = (text: string) => [...text.matchAll(/^warn: (TS\d+)/gm)].map(match => match[1]);
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN "));
const seenBy = async (command: string[], cwd: string) => {
  const { stdout, stderr, exitCode } = await run(command, cwd, bunEnv);
  return { seen: seenIn(stdout), stderr: exitCode ? stderr : "", exitCode };
};

async function seeInAnExecutable(program: string, seen: string[], warned: string[]) {
  const files = { ...project, "main.mjs": `import "./src/starts.mjs";\n`, "src/starts.mjs": program };
  using dir = tempDir("aot-workers-named-through-the-library", files);
  const cwd = String(dir);
  const asWritten = { seen, stderr: "", exitCode: 0 };
  expect(await seenBy([bunExe(), "main.mjs"], cwd)).toEqual(asWritten);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const built = await run(compile(executable, "main.mjs"), cwd, bunEnv);
  expect({
    warnings: warnings(built.stderr),
    stderr: built.exitCode ? built.stderr : "",
    exitCode: built.exitCode,
  }).toEqual({ warnings: warned, stderr: "", exitCode: 0 });
  for (const folder of ["src", "node_modules"]) renameSync(join(cwd, folder), join(cwd, folder + "-moved-away"));
  expect(await seenBy([executable], cwd)).toEqual(asWritten);
}

test("at the constructor, the name is the file that the Worker starts from", async () => {
  await seeInAnExecutable(head(`{ ask } from "./ask.mjs"`) + atTheConstructor, answers, []);
});

test("handed to a function of another file or of a package, the name is a file that a Worker may start from", async () => {
  const handed = said((code, index) => (index % 2 ? `run({ filename: ${code} })` : `start(${code})`));
  const program = head(`{ start } from "./pool.mjs";\nimport { run } from "a-pool"`) + handed;
  // One start in the file of the project, one in the package.
  await seeInAnExecutable(program, answers, ["TS100082", "TS100082"]);
});

test("a file that hands its own path to a function of another file is a file that a Worker may start from", async () => {
  const imports = jobs.map(([, , job]) => `import { answer as ${job} } from "./${job}.mjs";\n`).join("");
  const says = jobs.map(([name, , job]) => `await say(${JSON.stringify(name)}, () => ${job});\n`).join("");
  await seeInAnExecutable(imports + head(`"./pool.mjs"`) + says, answersOfJobs, ["TS100082"]);
});

// A test run has no switch for one thread, so a debug build of Bun is left out here.
test.skipIf(isDebug)("a test run compiles the file of each Worker that is named at the constructor", async () => {
  const files = {
    ...project,
    // A file that was compiled answers with what it said when the build read it.
    "src/starts.test.mjs": `import { test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
${head(`{ ask } from "./ask.mjs"`)}test("the Workers answer", async () => {
  for (let n = 1; process.env.WRITES_OVER_WORKERS && n <= ${ways.length}; n++) {
    const file = join(import.meta.dir, "w" + n + ".mjs");
    writeFileSync(file, readFileSync(file, "utf8").replace('"w' + n + '"', '"from disk"'));
  }
${atTheConstructor}});
`,
  };
  const see = async (flags: string[], env: Record<string, string>) => {
    using dir = tempDir("aot-workers-named-through-the-library", files);
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
    return { seen: seenIn(stdout), stderr: exitCode ? stderr : "", exitCode };
  };
  const plain = await see([], {});
  expect(plain).toEqual({ seen: answers, stderr: "", exitCode: 0 });
  expect(await see(["--aot"], { WRITES_OVER_WORKERS: "1" })).toEqual(plain);
});

test("import(), require() and createRequire() load the file that such a name names", async () => {
  const loads = roads.map(([name, code], index) =>
    index < moduleRoads.length
      ? `await say(${JSON.stringify(name)}, async () => ${code});\n`
      : `await say(${JSON.stringify(name)}, async () => loads[${JSON.stringify(name)}]());\n`,
  );
  const imports = `import { createRequire } from "node:module";\nimport loads from "./loads.cjs";\n`;
  await seeInAnExecutable(imports + head(`"./ask.mjs"`) + loads.join(""), answersOfRoads, []);
});

test("a file that the constructor names stops the build if it can't be compiled, and one that is handed on doesn't", async () => {
  using dir = tempDir("aot-workers-named-through-the-library", {
    "named.mjs": `new Worker(Bun.fileURLToPath(new URL("./w.mjs", import.meta.url)));\n`,
    "handed.mjs": `import { start } from "./pool.mjs";\nstart(Bun.fileURLToPath(new URL("./w.mjs", import.meta.url)));\n`,
    "pool.mjs": `export const start = entry => new Worker(entry);\n`,
    "w.mjs": `import "a-package-that-nobody-installed";\n`,
  });
  const build = async (entry: string) => {
    const executable = join(String(dir), entry.replace(".mjs", isWindows ? ".exe" : ""));
    const built = await run(compile(executable, entry), String(dir), bunEnv);
    return {
      errors: [...built.stderr.matchAll(/^error: (TS\d+)/gm)].map(match => match[1]),
      warnings: warnings(built.stderr).sort(),
      exitCode: built.exitCode,
    };
  };
  expect(await build("named.mjs")).toEqual({ errors: ["TS100151"], warnings: [], exitCode: 1 });
  // There the build says that it can't resolve the package, and goes on.
  expect(await build("handed.mjs")).toEqual({ errors: [], warnings: ["TS100082", "TS100151"], exitCode: 0 });
});
