import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// node:url exports the class URL of the global object, and a file written for Node takes it from there: `import { URL } from "node:url"`. With that class a
// file names a file as with the global one. Two parts of the build read such a name, and each has a form that the other doesn't read: a name that is known
// in part, which only the file's own analysis follows, and a URL that another file hands to a Worker, which only the scan of the load finds.
// An executable tells: the sources are moved away before it runs, nothing in it may be interpreted, and a Worker without its file never answers.
const part = (known: string) => `\${process.argv.length > 9 ? process.argv[9] : "${known}"}`;
type Row = [name: string, code: string, answer: string];
type Writer = { file: string; head: string; rows: Row[] };

// How a file takes the class, and how it writes the class then.
const taken: [how: string, file: string, head: string, written: string][] = [
  ["a named import", "named.mjs", `import { URL } from "node:url";`, "URL"],
  ["a named import under another name, from url", "renamed.mjs", `import { URL as Address } from "url";`, "Address"],
  ["a member of the namespace", "space.mjs", `import * as url from "node:url";`, "url.URL"],
  ["a member of the default export", "whole.mjs", `import url from "node:url";`, "url.URL"],
  ["taken out of what require() answers", "apart.mjs", `const { URL } = require("node:url");`, "URL"],
  ["a member of what require() answers", "required.mjs", `const url = require("url");`, "url.URL"],
];
const inPart = (written: string, name: string, base = "import.meta.url") =>
  `ask(new Worker(new ${written}(\`./${name}-${part("job")}.mjs\`, ${base})))`;
const writers: Writer[] = [
  ...taken.map(([how, file, head, written], index): Writer => ({
    file,
    head: `${head}\nimport { start } from "./pool.mjs";`,
    rows: [
      [`${how}: a name that is known in part`, inPart(written, `p${index}`), `p${index}`],
      [
        `${how}: a URL that another file hands to the Worker`,
        `start(new ${written}("./h${index}.mjs", import.meta.url))`,
        `h${index}`,
      ],
    ],
  })),
  {
    file: "common.cjs",
    head: `const { URL, pathToFileURL } = require("node:url");`,
    rows: [["in a CommonJS file: a name that is known in part", inPart("URL", "c", "pathToFileURL(__filename)"), "c"]],
  },
  {
    file: "forms.mjs",
    head: `import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, URL } from "node:url";`,
    rows: [
      ["at the constructor", `ask(new Worker(new URL("./f1.mjs", import.meta.url)))`, "f1"],
      [
        "the path that fileURLToPath() answers with",
        `ask(new Worker(fileURLToPath(new URL("./f2.mjs", import.meta.url))))`,
        "f2",
      ],
      ["import() of the URL", `import(new URL("./f3.mjs", import.meta.url)).then(loaded => loaded.default)`, "f3"],
      ["createRequire() of the URL of the own file", `createRequire(new URL(import.meta.url))("./f4.cjs")`, "f4"],
      ["createRequire() of the URL of a folder", `createRequire(new URL("./lib/", import.meta.url))("./f5.cjs")`, "f5"],
      [
        "import() from the folder of the URL of the own file",
        `import(dirname(fileURLToPath(new URL(import.meta.url))) + "/f6.mjs").then(loaded => loaded.default)`,
        "f6",
      ],
      [
        // The text imports a package, so where it isn't compiled the executable finds nothing to run it with.
        "the text behind URL.createObjectURL()",
        `ask(new Worker(URL.createObjectURL(new Blob(['import { said } from "says"; postMessage(said);'], { type: "text/javascript" }))))`,
        "f7",
      ],
    ],
  },
  {
    // A made require of a folder is read twice: once to tell that it is one, and once for the path of the folder. Both have to read the class here.
    file: "awaited.mjs",
    head: `import { createRequire } from "node:module";\nconst { URL } = await import("node:url");`,
    rows: [
      ["behind an awaited import: a name that is known in part", inPart("URL", "a"), "a"],
      [
        "behind an awaited import: createRequire() of the URL of a folder",
        `createRequire(new URL("./lib/", import.meta.url))("./f8.cjs")`,
        "f8",
      ],
    ],
  },
  {
    file: "global.mjs",
    head: ``,
    rows: [["the member of the global object: a name that is known in part", inPart("globalThis.URL", "g"), "g"]],
  },
];
const rows = writers.flatMap(writer => writer.rows);
const seen = rows.map(([name, , answer]) => `SEEN ${name} | ${answer}`);

// What each row names: a Worker's file, but for the modules of import(), the CommonJS files of the made requires and the package of the text.
const named: Record<string, string> = {
  ...Object.fromEntries(taken.map((_, index) => [`src/p${index}-job.mjs`, `postMessage("p${index}");\n`])),
  ...Object.fromEntries(taken.map((_, index) => [`src/h${index}.mjs`, `postMessage("h${index}");\n`])),
  "src/c-job.mjs": `postMessage("c");\n`,
  "src/f1.mjs": `postMessage("f1");\n`,
  "src/f2.mjs": `postMessage("f2");\n`,
  "src/f3.mjs": `export default "f3";\n`,
  "src/f4.cjs": `module.exports = "f4";\n`,
  "src/lib/f5.cjs": `module.exports = "f5";\n`,
  "src/f6.mjs": `export default "f6";\n`,
  "src/a-job.mjs": `postMessage("a");\n`,
  "src/lib/f8.cjs": `module.exports = "f8";\n`,
  "src/g-job.mjs": `postMessage("g");\n`,
  "node_modules/says/package.json": `{ "name": "says", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  "node_modules/says/index.js": `export const said = "f7";\n`,
};
const written = (rows: Row[]) =>
  rows.map(([name, code]) => `  ${JSON.stringify(name)}: async () => ${code},\n`).join("");
const asked = `for (const rows of [${writers.map((_, index) => `rows${index}`).join(", ")}])
  for (const [name, answer] of Object.entries(rows))
    console.log("SEEN " + name + " | " + (await answer().catch(() => "no file")));
`;
const imports = writers.map(({ file }, index) => `import rows${index} from "./src/${file}";\n`).join("");
const files: Record<string, string> = {
  "package.json": `{ "name": "p" }`,
  "src/ask.cjs": `exports.ask = worker => new Promise(done => {
  worker.onmessage = event => { done(event.data); worker.terminate(); };
  worker.onerror = event => { event.preventDefault(); done("error"); };
});
`,
  "src/pool.mjs": `import { ask } from "./ask.cjs";\nexport const start = entry => ask(new Worker(entry));\n`,
  ...Object.fromEntries(
    writers.map(({ file, head, rows }) => [
      `src/${file}`,
      file.endsWith(".cjs")
        ? `${head}\nconst { ask } = require("./ask.cjs");\nmodule.exports = {\n${written(rows)}};\n`
        : `${head}\nimport { ask } from "./ask.cjs";\nexport default {\n${written(rows)}};\n`,
    ]),
  ),
  ...named,
  "main.mjs": `${imports}${asked}process.exit(0);\n`,
};
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN "));
const warnings = (text: string) => [...text.matchAll(/^warn: (TS\d+)/gm)].map(match => match[1]);
const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
// A debug build of Bun dies now and then of a race between the threads of the engine (oven-sh/bun#48169). One thread keeps a build out of it.
const threads = isDebug ? [withThreads(1)] : [];

test("each named file is in an executable whose sources are moved away", async () => {
  using dir = tempDir("aot-url-class-of-node-url", files);
  const cwd = String(dir);
  expect(seenIn((await run([bunExe(), "main.mjs"], cwd, bunEnv)).stdout)).toEqual(seen);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const built = await run([bunExe(), ...compileCommand, ...threads, "--outfile", executable, "main.mjs"], cwd, bunEnv);
  // Two starts stay without a name, as with the global class: the one in the file of the pool, whose files are compiled because the files of the
  // project write their URLs out, and the one that starts from a text.
  expect({
    warnings: warnings(built.stderr),
    stderr: built.exitCode ? built.stderr : "",
    exitCode: built.exitCode,
  }).toEqual({ warnings: ["TS100082", "TS100082"], stderr: "", exitCode: 0 });
  for (const folder of ["src", "node_modules"]) renameSync(join(cwd, folder), join(cwd, folder + "-moved-away"));
  expect(seenIn((await run([executable], cwd, compiledOnly)).stdout)).toEqual(seen);
});

// Bun.build() and a test run have no switch for one thread, so a debug build of Bun is left out of the two tests below.
test.skipIf(isDebug)("Bun.build() compiles the file that the class names", async () => {
  using dir = tempDir("aot-url-class-of-node-url", {
    "main.mjs": `import { URL } from "node:url";
const worker = new Worker(new URL("./src/w.mjs", import.meta.url));
worker.onmessage = event => { console.log("SEEN " + event.data); worker.terminate(); };
worker.onerror = event => { event.preventDefault(); console.log("SEEN error"); };
`,
    "src/w.mjs": `postMessage("w");\n`,
    "build.mjs": `await Bun.build({ entrypoints: ["./main.mjs"], compile: { outfile: "./main", aot: true } });\n`,
  });
  const cwd = String(dir);
  const built = await run([bunExe(), "build.mjs"], cwd, bunEnv);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  renameSync(join(cwd, "src"), join(cwd, "src-moved-away"));
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  expect(seenIn((await run([executable], cwd, compiledOnly)).stdout)).toEqual(["SEEN w"]);
});

test.skipIf(isDebug)(
  "a test run compiles each named file, and reads from disk what a test writes through such a URL",
  async () => {
    const testFiles = {
      ...files,
      "rows.test.mjs": `import { test } from "bun:test";\n${imports}test("the rows answer", async () => {\n${asked}});\n`,
      "src/late.mjs": `export const value = "as it was compiled";\n`,
      // bun test reads a file when something first loads it, so it runs what the test has left there by then. A test run that is compiled does the same
      // for a file that the build saw the test write.
      "written.test.mjs": `import { test } from "bun:test";
import { writeFileSync } from "node:fs";
import { URL } from "node:url";
test("a file that the test writes anew", async () => {
  writeFileSync(new URL("./src/late.mjs", import.meta.url), 'export const value = "written by the test";\\n');
  console.log("SEEN late | " + (await import("./src/late.mjs").then(loaded => loaded.value, () => "refused")));
});
`,
    };
    const see = async (flags: string[], file: string, env: Record<string, string | undefined>) => {
      using dir = tempDir("aot-url-class-of-node-url", testFiles);
      const ran = await run([bunExe(), "test", ...flags, file], String(dir), env);
      return {
        seen: seenIn(ran.stdout + "\n" + ran.stderr),
        stderr: ran.exitCode ? ran.stderr : "",
        exitCode: ran.exitCode,
      };
    };
    expect(await see(["--aot", "--isolate"], "./rows.test.mjs", compiledOnly)).toEqual({
      seen,
      stderr: "",
      exitCode: 0,
    });
    const plain = await see([], "./written.test.mjs", bunEnv);
    expect(plain).toEqual({ seen: ["SEEN late | written by the test"], stderr: "", exitCode: 0 });
    expect(await see(["--aot"], "./written.test.mjs", bunEnv)).toEqual(plain);
  },
);
