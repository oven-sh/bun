import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { describe, eachRow } from "./supported";

const handlers = `catch (error) { console.log("caught", error.code); } finally { console.log("finally"); }\nconsole.log("end");\n`;
const joined = (name: string) => `const key = ${JSON.stringify([name.slice(0, 2), name.slice(2)])}.join("");\n`;
const key = joined("Glob");
const makeGlob = (Class: string) => `console.log("made", new ${Class}("*.js").match("a.js"));`;

if (!canTrim)
  console.error("SKIPPED: trim-removed-class-error-is-caught.test.ts: this build of Bun doesn't support --trim");

async function buildAndRun(files: Record<string, string>, build: (executable: string) => string[]) {
  using dir = tempDir("aot-trim-removed-class", files);
  const folder = String(dir);
  const executable = join(folder, isWindows ? "trimmed.exe" : "trimmed");
  const built = await run(build(executable), folder);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return await run([executable], folder);
}

// Each program joins the name of an API from two strings and uses the API under that key inside a `try` block.
// --trim may keep the API or remove it. If it removes the API, the use throws ERR_FEATURE_REMOVED, and the `catch` and `finally` blocks run.
describe.skipIf(!canTrim)("a try block catches the error of an API that --trim removed", () => {
  eachRow([
    ["new in the try block", `${key}try { ${makeGlob("Bun[key]")} } ${handlers}`],
    [
      "new in the try block of a function",
      `${key}function make() { try { ${makeGlob("Bun[key]")} } ${handlers} }\nmake();\n`,
    ],
    [
      "the class is read before the try block",
      `${key}const Class = Bun[key];\ntry { ${makeGlob("Class")} } ${handlers}`,
    ],
    [
      "Reflect.construct",
      `${key}try { console.log("made", Reflect.construct(Bun[key], ["*.js"]).match("a.js")); } ${handlers}`,
    ],
    [
      "new in a function that the try block calls",
      `${key}function make(Class) { return new Class("*.js"); }\ntry { console.log("made", make(Bun[key]).match("a.js")); } ${handlers}`,
    ],
    [
      "a computed key in a destructuring pattern",
      `${key}const { [key]: Class } = Bun;\ntry { ${makeGlob("Class")} } ${handlers}`,
    ],
    ["Reflect.get", `${key}const Class = Reflect.get(Bun, key);\ntry { ${makeGlob("Class")} } ${handlers}`],
    ["Bun is in a variable", `${key}const holder = Bun;\ntry { ${makeGlob("holder[key]")} } ${handlers}`],
    [
      "the key is in a property",
      `${key}const names = { glob: key };\ntry { ${makeGlob("Bun[names.glob]")} } ${handlers}`,
    ],
    [
      "the namespace of the module bun",
      `import * as bun from "bun";\n${key}try { ${makeGlob("bun[key]")} } ${handlers}`,
    ],
    [
      "another module reads the class",
      `import { find } from "./find.mjs";\ntry { ${makeGlob("(find())")} } ${handlers}`,
    ],
    ["a class without arguments", `${joined("SHA256")}try { console.log("made", typeof new Bun[key]()); } ${handlers}`],
    ["a function", `${joined("escapeHTML")}try { console.log("made", Bun[key]("<a>")); } ${handlers}`],
    [
      "a function of a namespace",
      `${joined("semver")}try { console.log("made", Bun[key].satisfies("1.2.3", "^1")); } ${handlers}`,
    ],
    ["a method of a string", `${joined("localeCompare")}try { console.log("made", "a"[key]("b")); } ${handlers}`],
    ["a method of a number", `${joined("toLocaleString")}try { console.log("made", (5)[key]()); } ${handlers}`],
    ["a method of a bigint", `${joined("toLocaleString")}try { console.log("made", 5n[key]()); } ${handlers}`],
    [
      "a method of a date",
      `${joined("toLocaleDateString")}try { console.log("made", typeof new Date(0)[key]()); } ${handlers}`,
    ],
  ] as const)(
    "%s",
    async (_, program) => {
      const files = { "program.mjs": program, "find.mjs": `${key}export const find = () => Bun[key];\n` };
      const flags = ["build", "--compile", "--aot", "--trim", "program.mjs", "--outfile"];
      const result = await buildAndRun(files, executable => [bunExe(), ...flags, executable]);
      expect(result).toEqual({
        stdout: expect.stringMatching(/^(made .+|caught ERR_FEATURE_REMOVED)\nfinally\nend\n$/),
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );
});

const buildScript = `const [outfile, feature] = process.argv.slice(2);
const result = await Bun.build({ entrypoints: ["./program.mjs"], compile: { outfile, aot: true, trim: { remove: [feature] } } });
if (!result.success) throw new AggregateError(result.logs);
`;

// Each program names an API of a feature that `compile.trim.remove` takes out.
describe.skipIf(!canTrim)("a try block catches the error of an API that compile.trim.remove removed", () => {
  eachRow([
    ["new Bun.Glob()", "glob", `try { ${makeGlob("Bun.Glob")} } ${handlers}`],
    [
      "new in the try block of a function",
      "glob",
      `function make() { try { ${makeGlob("Bun.Glob")} } ${handlers} }\nmake();\n`,
    ],
    ["a destructuring pattern", "glob", `const { Glob } = Bun;\ntry { ${makeGlob("Glob")} } ${handlers}`],
    ["an import from bun", "glob", `import { Glob } from "bun";\ntry { ${makeGlob("Glob")} } ${handlers}`],
    [
      "an export of another module",
      "glob",
      `import { Glob } from "./exports.mjs";\ntry { ${makeGlob("Glob")} } ${handlers}`,
    ],
    [
      "Reflect.construct",
      "glob",
      `try { console.log("made", Reflect.construct(Bun.Glob, ["*.js"]).match("a.js")); } ${handlers}`,
    ],
    ["a subclass", "glob", `class Mine extends Bun.Glob {}\ntry { ${makeGlob("Mine")} } ${handlers}`],
    ["new HTMLRewriter()", "html-rewriter", `try { console.log("made", typeof new HTMLRewriter()); } ${handlers}`],
    ["a function", "color", `try { console.log("made", Bun.color("red", "hex")); } ${handlers}`],
    [
      "a function of a namespace",
      "semver",
      `try { console.log("made", Bun.semver.satisfies("1.2.3", "^1")); } ${handlers}`,
    ],
    [
      "an async function rejects",
      "glob",
      `async function make() { ${makeGlob("Bun.Glob")} }\ntry { await make(); } ${handlers}`,
    ],
  ] as const)(
    "%s",
    async (_, feature, program) => {
      const files = {
        "program.mjs": program,
        "exports.mjs": `export { Glob } from "bun";\n`,
        "build.mjs": buildScript,
      };
      const result = await buildAndRun(files, executable => [bunExe(), "build.mjs", executable, feature]);
      expect(result).toEqual({ stdout: "caught ERR_FEATURE_REMOVED\nfinally\nend\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );
});
