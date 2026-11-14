// Every ```ts code block of docs/ is type checked as one file of a `bun init` project, against the bun-types of this
// commit. A code block may use names that it does not declare, because the page does not show the rest of its
// program. Anything else that tsc reports fails, unless docs-samples.inventory.json lists the code block: it failed
// when this check landed. `{/* fragment */}` above a code block says that it is not meant to parse alone, and
// `{/* type-error TS2322 */}` that the page shows an error on purpose.
//
// The pages of docs/lint/rules show code for `bun lint` to report. This test does not read them.
import { fileURLToPath } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isDebug, makeTree, tempDir } from "harness";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { cp } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import ts from "typescript";
import { checkSamples, judge, keyOf, samplesOf, type Sample, type SampleError } from "./docs-samples";

const REPO = fileURLToPath(import.meta.resolve("../../../"));
const BUN_TYPES = join(REPO, "packages", "bun-types");
const TSCONFIG = join(REPO, "src", "runtime", "cli", "init", "tsconfig.default.json");
const INVENTORY = fileURLToPath(import.meta.resolve("./docs-samples.inventory.json"));
const REMEDY =
  "A TypeScript code block of the docs is type checked as one file of a `bun init` project. It may use names that it " +
  "does not declare. Fix what tsc reports here, or the declaration in packages/bun-types if Bun runs the code as " +
  "written. If the code block is not meant to parse alone, put {/* fragment */} on a line above it. See 'Code " +
  "samples' in docs/project/contributing.mdx.";

const STALE =
  "docs-samples.inventory.json lists code blocks that do not fail any more. Remove their entries: " +
  "UPDATE_DOCS_SAMPLES_INVENTORY=1 bun test test/integration/bun-types/docs-samples.test.ts";

const fence = "```";
const at = (error: SampleError) => `${error.line}: TS${error.code}`;

// Each of the first five code blocks declares something that a file of the same program would see.
const isolated = samplesOf(
  "docs/isolated.mdx",
  `
${fence}ts
declare global {
  var declaredByAGlobal: string;
}
${fence}

${fence}ts
declare module "bun" {
  const declaredByAnAugmentation: string;
}
${fence}

${fence}ts
import "bun-types/test-globals";
test("the import declares this global", () => {});
${fence}

${fence}ts
/// <reference lib="dom" />
document.title;
${fence}

${fence}ts env.d.ts
declare var declaredByAFile: NotDeclared;
${fence}

${fence}ts
import { declaredByAnAugmentation } from "bun";
declaredByAGlobal;
test;
document;
declaredByAFile;
const declared = 1;
declard;
${fence}
`,
);

const judged = samplesOf(
  "docs/judged.mdx",
  `
${fence}ts index.ts icon="/icons/typescript.svg"
import { serve } from "bun";
import { Hono } from "hono";
const server = serve(new Hono());
const port: number = "3000";
${fence}

${fence}ts
import { Database } from "bun:sqlit";
const server = createServer(new Database());
const server = createServerAnotherWay();
server.on("request", (request, response, ...rest) => response.end(Bun.version.toFixed(2)));
function handle({ request }) {}
class Listed {
  constructor(name: string);
  name: string;
  stop(force = true): void;
}
return Listed;
${fence}

${fence}ts
routes: { "/": () => new Response("ok") },
${fence}

{/* fragment */}

${fence}ts
routes: { "/": () => new Response("ok") },
${fence}

{/* fragment */}

${fence}ts
const routes = { "/": () => new Response("ok") };
${fence}

{/* type-error TS2322 */}

${fence}ts
const shown: number = "on purpose";
notOnThePage(shown);
${fence}

{/* type-error TS2322 */}

${fence}ts
const notShown: number = 3000;
${fence}

{/* type-error TS2322 */}

${fence}ts
const shown: number = "on purpose";
Bun.sleep("not", "on purpose");
${fence}

{/* type-error TS2552 */}

${fence}ts
const declaredHere = 1;
declaredHear;
${fence}

${fence}ts
/// <reference types="bun-types/not-a-file" />
/// <reference types="not-on-the-page" />
/// <reference path="./not-on-the-page.d.ts" />
import "bun-types/not-a-file";
import "not-on-the-page/file";
${fence}
`,
);

// `unknown` comes from undici-types, which bun-types depends on. With lib.dom, or without bun-types, `body` is `any`.
const probe: Sample = {
  page: "probe",
  line: 0,
  extension: ".ts",
  code: 'const body = await (await fetch("https://bun.com")).json();\nbody.version;\nBun.version satisfies string;\n',
  indentation: 0,
  fragment: false,
};

/** Where `bun install` in the repository root put a package that bun-types depends on. */
function installed(dependency: string) {
  for (const from of [BUN_TYPES, REPO]) {
    const found = join(from, "node_modules", dependency);
    if (existsSync(join(found, "package.json"))) return realpathSync(found);
  }
  throw new Error(`${dependency} is not installed. Run \`bun install\` in the repository root.`);
}

// A project with bun-types and what it depends on, in the versions that bun.lock pins. The test installs nothing, so
// a release of @types/node on npm does not change what it reports.
let project: ReturnType<typeof tempDir> | undefined;
let docs: { samples: Sample[]; problems: string[] }[];
let errors: Map<Sample, SampleError[]>;

// Type checks about 1,700 code blocks in this process. That takes 10 to 30 s on a release build, which is more than
// the default timeout of a hook, so the hook has its own. A debug build needs minutes, so it skips these tests.
beforeAll(async () => {
  if (isDebug) return;
  project = tempDir("docs-samples", { "package.json": "{}" });
  const modules = join(project, "node_modules");
  await cp(BUN_TYPES, join(modules, "bun-types"), {
    recursive: true,
    filter: source => basename(source) !== "node_modules",
  });
  for (const dependency of ["@types/node", "undici-types"]) {
    await cp(installed(dependency), join(modules, dependency), { recursive: true });
  }
  await makeTree(project, {
    "node_modules/@types/bun/index.d.ts": '/// <reference types="bun-types" />',
    "node_modules/@types/bun/package.json": JSON.stringify({ name: "@types/bun", version: Bun.version }),
  });

  const root = join(REPO, "docs");
  docs = [...new Bun.Glob("**/*.{md,mdx}").scanSync({ cwd: root })]
    .map(page => page.replaceAll("\\", "/"))
    .filter(page => !page.startsWith("lint/rules/"))
    .sort()
    .map(page => samplesOf(`docs/${page}`, readFileSync(join(root, page), "utf8")));
  const { options } = ts.parseJsonConfigFileContent(
    ts.readConfigFile(TSCONFIG, ts.sys.readFile).config,
    ts.sys,
    dirname(TSCONFIG),
  );
  // The code blocks of this file come first: tsc suggests a name for only the first ten that it cannot find.
  const samples = [...isolated.samples, ...judged.samples, probe, ...docs.flatMap(page => page.samples)];
  errors = checkSamples(samples, project, options);
}, 120_000);

afterAll(() => project?.[Symbol.dispose]());

describe.skipIf(isDebug)("the TypeScript code blocks of the docs", () => {
  test("are checked against bun-types and what it depends on", () => {
    // Most of the docs: a reader that stops finding pages or code blocks fails here.
    expect(docs.flatMap(page => page.samples).length).toBeGreaterThan(1500);
    expect(errors.get(probe)!.map(at)).toEqual(["2: TS18046"]);
  });

  test("have each marker above a TypeScript code block", () => {
    expect(docs.flatMap(page => page.problems)).toEqual([]);
  });

  test("type check, or are in the inventory with what they report", async () => {
    const samples = docs.flatMap(page => page.samples);
    const { failures, unused, pruned } = judge(samples, errors, await Bun.file(INVENTORY).json());
    // Never adds an entry or a code: a code block that starts to fail needs a fix, not an entry.
    const update = !!process.env.UPDATE_DOCS_SAMPLES_INVENTORY;
    if (update) await Bun.write(INVENTORY, JSON.stringify(pruned, null, 2) + "\n");
    expect(failures.join("\n"), REMEDY).toBe("");
    if (!update) expect(unused, STALE).toEqual([]);
  });
});

describe("the check of a page", () => {
  test("reads every TypeScript code block and the marker above it", () => {
    const page = `
${fence}ts
1;
${fence}

${fence}typescript index.ts icon="/icons/typescript.svg"
2;
${fence}

${fence}tsx
3;
${fence}

${fence}ts title="App.tsx"
4;
${fence}

${fence}ts#env.d.ts
5;
${fence}

<Tabs>
  <Tab title="in a tag">
\t${fence}ts
\t6;
\t  still(6);
\t${fence}

    {/* fragment */}

    {/* prettier-ignore */}
    ${fence}${fence}ts
    const fenceInIt = "${fence}";
    ${fence}${fence}

  </Tab>
</Tabs>

{/* type-error TS2322, TS2345 */}

${fence}ts
8;
${fence}

${fence}js
notTypeScript;
${fence}
`;
    const sample = { page: "docs/example.mdx", indentation: 0, fragment: false };
    expect(samplesOf("docs/example.mdx", page)).toEqual({
      problems: [],
      samples: [
        { ...sample, line: 2, extension: ".ts", code: "1;\n" },
        { ...sample, line: 6, extension: ".ts", code: "2;\n" },
        { ...sample, line: 10, extension: ".tsx", code: "3;\n" },
        { ...sample, line: 14, extension: ".tsx", code: "4;\n" },
        { ...sample, line: 18, extension: ".d.ts", code: "5;\n" },
        { ...sample, line: 24, extension: ".ts", code: "6;\n  still(6);\n", indentation: 1 },
        {
          ...sample,
          line: 32,
          extension: ".ts",
          code: `const fenceInIt = "${fence}";\n`,
          indentation: 4,
          fragment: true,
        },
        { ...sample, line: 41, extension: ".ts", code: "8;\n", typeErrors: [2322, 2345] },
      ],
    });

    const misplaced = ["{/* fragment */}", "{/* type-error */}", "", "Text.", "", "{/* fragment */}", "", `${fence}sh`];
    expect(samplesOf("docs/example.mdx", [...misplaced, fence, "{/* fragment */}"].join("\n")).problems).toEqual([
      "docs/example.mdx:2: two markers for one code block",
      "docs/example.mdx:2: expected {/* fragment */} or {/* type-error TS2322 */}",
      "docs/example.mdx:2: the marker is not above a code block",
      "docs/example.mdx:6: the marker is above a code block that is not TypeScript",
      "docs/example.mdx:10: the marker is not above a code block",
    ]);
  });

  test.skipIf(isDebug)("gives no code block what another one declares", () => {
    expect(isolated.problems).toEqual([]);
    expect(isolated.samples.map(sample => errors.get(sample)!.map(at))).toEqual([
      [],
      [],
      [],
      [],
      // A project does not check its declaration files. This one is the sample.
      ["25: TS2304"],
      // The last one is "Did you mean 'declared'?", which has the code TS2552.
      ["29: TS2305", "30: TS2304", "31: TS2593", "32: TS2584", "33: TS2304", "35: TS2304"],
    ]);
  });

  test.skipIf(isDebug)("holds a code block to its marker, to the inventory, or to the rest of its program", () => {
    expect(judged.problems).toEqual([]);
    const [wrong, partOfAProgram, doesNotParse] = judged.samples;
    const judgedWith = (entries: Record<string, string>) =>
      judge(judged.samples, errors, { "docs/judged.mdx": entries });

    const wrongFails = `docs/judged.mdx:6:7 TS2322: Type 'string' is not assignable to type 'number'.\n    const port: number = "3000";`;
    // A code block may use what it does not declare, take parameters without types, declare a name twice, list
    // declarations and return. It may not import a module of Bun that does not exist, or call a method that does not.
    const partFails = [
      `docs/judged.mdx:10:26 TS2307: Cannot find module 'bun:sqlit' or its corresponding type declarations.\n    import { Database } from "bun:sqlit";`,
      `docs/judged.mdx:13:79 TS2551: Property 'toFixed' does not exist on type 'string'. Did you mean 'fixed'?\n    server.on("request", (request, response, ...rest) => response.end(Bun.version.toFixed(2)));`,
    ];
    const parseFails = `docs/judged.mdx:24:14 TS1005: ';' expected.\n    routes: { "/": () => new Response("ok") },`;
    // A code block with a marker may leave out the rest of its program too: the one at line 41 passes. So does the
    // one at line 61, whose marker names the code that tsc prints with a suggestion.
    const markersFail = [
      "docs/judged.mdx:35: the code block parses alone, so it needs no {/* fragment */}",
      "docs/judged.mdx:48: the marker says TS2322, tsc reports nothing",
      "docs/judged.mdx:54: the marker says TS2322, tsc reports TS2322 TS2554",
      `docs/judged.mdx:55:7 TS2322: Type 'string' is not assignable to type 'number'.\n    const shown: number = "on purpose";`,
      `docs/judged.mdx:56:18 TS2554: Expected 1 arguments, but got 2.\n    Bun.sleep("not", "on purpose");`,
    ];
    // A page may reference or import what it does not show, but not a file of bun-types that does not exist.
    const referencesFail = [
      `docs/judged.mdx:67:23 TS2688: Cannot find type definition file for 'bun-types/not-a-file'.\n    /// <reference types="bun-types/not-a-file" />`,
      `docs/judged.mdx:70:8 TS2882: Cannot find module or type declarations for side-effect import of 'bun-types/not-a-file'.\n    import "bun-types/not-a-file";`,
    ];
    const othersFail = [...markersFail, ...referencesFail];
    expect(judgedWith({})).toEqual({
      failures: [wrongFails, ...partFails, parseFails, ...othersFail],
      unused: [],
      pruned: {},
    });

    // The inventory lists a code block with what it reports, and says the line of the first error.
    const listed = {
      [keyOf(wrong)]: 'TS2322 | const port: number = "3000";',
      [keyOf(partOfAProgram)]: 'TS2307 TS2551 | import { Database } from "bun:sqlit";',
      [keyOf(doesNotParse)]: 'TS1005 | routes: { "/": () => new Response("ok") },',
    };
    expect(judgedWith(listed)).toEqual({ failures: othersFail, unused: [], pruned: { "docs/judged.mdx": listed } });
    // A listed code block may not report another code.
    expect(judgedWith({ ...listed, [keyOf(partOfAProgram)]: "TS2307 | import" }).failures).toEqual([
      "docs/judged.mdx:9: the inventory lists this code block with TS2307",
      partFails[1],
      ...othersFail,
    ]);
    // An entry, or a code of one, that no code block reports has to go.
    expect(judgedWith({ ...listed, [keyOf(wrong)]: "TS2322 TS2345 | const", edited: "TS2304 | gone" })).toEqual({
      failures: othersFail,
      unused: [
        `docs/judged.mdx: ${keyOf(wrong)} (TS2322 TS2345 | const): it reports TS2322 | const port: number = "3000";`,
        "docs/judged.mdx: edited (TS2304 | gone): no code block with this key fails",
      ],
      pruned: { "docs/judged.mdx": listed },
    });
    expect(judge(judged.samples, errors, { "docs/removed.mdx": { removed: "TS2304 | gone" } }).unused).toEqual([
      "docs/removed.mdx: removed (TS2304 | gone): no code block with this key fails",
    ]);

    // An entry follows its code block to the page that has it now.
    const { [keyOf(wrong)]: entryOfWrong, ...others } = listed;
    const beforeTheMove = { "docs/before-the-move.mdx": { [keyOf(wrong)]: entryOfWrong }, "docs/judged.mdx": others };
    expect(judge(judged.samples, errors, beforeTheMove)).toEqual({
      failures: othersFail,
      unused: [],
      pruned: { "docs/judged.mdx": listed },
    });
    // A copy of a listed code block on another page is a new code block that fails.
    const copy = { ...wrong, page: "docs/copy.mdx" };
    const withTheCopy = new Map(errors).set(copy, errors.get(wrong)!);
    expect(judge([...judged.samples, copy], withTheCopy, { "docs/judged.mdx": listed }).failures).toEqual([
      ...othersFail,
      wrongFails.replace("docs/judged.mdx", "docs/copy.mdx"),
    ]);
  });
});
