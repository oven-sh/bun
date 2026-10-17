// `Bun.build({ check: true })` with a plugin. The type checker cannot read what only a plugin can read, like `App.svelte`:
// a declaration stands for it. So the type checker does not find what `App.svelte` imports. The bundler tells it, and a
// file that imports `App.svelte` refers to what `App.svelte` imports: `lib.ts` is checked like an import of `main.ts`.
import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const options = {
  strict: true,
  noEmit: true,
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  lib: ["esnext"],
  types: [],
  skipLibCheck: true,
};
const config = (more: object = {}, others: object = {}) =>
  JSON.stringify({ compilerOptions: { ...options, ...more }, ...others });

const wrong = `export const value: string = 1;\n`;
const right = `export const value: string = "1";\n`;
const shims = `declare module "*.svelte" { const component: unknown; export default component; }\n`;
const component = `<script lang="ts"></script>\n`;
const main = `import App from "./App.svelte";\nexport default App;\n`;
// TypeScript does not accept it where `strict` is on.
const loose = `export function f(x) {\n  return x;\n}\n`;

type Result = { passes: boolean; errors: string[]; isWritten: boolean };
const result = (errors: string[]): Result => ({
  passes: errors.length === 0,
  errors,
  isWritten: errors.length === 0,
});

// The end of a script that builds: what `build` returns.
const print = `
  const file = log => relative(dir, log.position?.file ?? "").replaceAll("\\\\", "/");
  console.log(JSON.stringify({
    passes: built.success,
    errors: built.logs.map(log => log.message.split(":")[0] + " " + file(log)),
    isWritten: built.outputs.length > 0,
  }));
`;

// `setup` is the body of `setup(build)` of the plugin. `dir` is the project, and `imports(file)` is what a plugin makes of
// a file that imports `file` of the project. `more` is an expression for more options of the build.
const script = (setup: string, more = "{}") => `
  import { readFileSync } from "node:fs";
  import { join, relative } from "node:path";
  const dir = process.cwd();
  const imports = file => "import * as all from " + JSON.stringify(join(dir, file)) + ";\\nexport default all;\\n";
  const plugin = { name: "plugin", setup(build) { ${setup} } };
  const built = await Bun.build({ entrypoints: process.argv.slice(2), outdir: "out", check: true, throw: false, plugins: [plugin], ...${more} });
  ${print}
`;
// The plugin makes of each `.svelte` file a module that imports `file`.
const svelte = (file: string) =>
  `build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents: imports("${file}"), loader: "ts" }));`;

async function build(dir: string, ...entries: string[]): Promise<Result> {
  await using proc = spawn({
    cmd: [bunExe(), "build.mjs", ...entries],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(stdout);
}

// `path` leads to `target`, both in `dir`: a junction on Windows, which needs no privilege.
function link(dir: string, target: string, path: string) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  symlinkSync(join(dir, target), join(dir, path), "junction");
}

// A check in a debug build takes seconds, and as many threads as there are cores.
const it = test.concurrentIf(!isDebug);
const timeout = isDebug ? 60_000 : undefined;

const project = (value: string) => ({
  "tsconfig.json": config(),
  "shims.d.ts":
    shims +
    `declare module "virtual:app" { const app: unknown; export default app; }\n` +
    `declare module "*.html" { const page: unknown; export default page; }\n`,
  "App.svelte": component,
  "Outer.svelte": component,
  "lib.ts": value,
  // The bundler does not read it.
  "unused.ts": wrong,
  "main.ts": main,
  "dynamic.ts": `export const load = () => import("./App.svelte");\n`,
  "deep.ts": `export { default } from "./main";\n`,
  "outer.ts": `import Outer from "./Outer.svelte";\nexport default Outer;\n`,
  "virtual.ts": `import app from "virtual:app";\nexport default app;\n`,
  "index.html": `<script type="module" src="./main.ts"></script>\n`,
  "server.ts": `import page from "./index.html";\nexport default page;\n`,
  "build.mjs": script(
    `
    build.onLoad({ filter: /App[.]svelte$/ }, () => ({ contents: imports("lib.ts"), loader: "ts" }));
    build.onLoad({ filter: /Outer[.]svelte$/ }, () => ({ contents: imports("App.svelte"), loader: "ts" }));
    build.onResolve({ filter: /^virtual:app$/ }, () => ({ path: "app", namespace: "virtual" }));
    build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: imports("lib.ts"), loader: "ts" }));
  `,
    // Only a server imports a page.
    `{ target: process.argv.includes("server.ts") ? "bun" : "browser" }`,
  ),
});

it.each([
  ["the entry point", "App.svelte"],
  ["a static import", "main.ts"],
  ["import()", "dynamic.ts"],
  ["two imports away", "deep.ts"],
  ["behind another file that a plugin loads", "outer.ts"],
  ["in a namespace of the plugin", "virtual.ts"],
  ["behind the script of a page", "index.html"],
  ["behind a page that a server imports", "server.ts"],
])(
  "what a plugin-loaded file imports is checked: the file is %s",
  async (_, entry) => {
    using withError = tempDir("bun-check-plugin", project(wrong));
    using without = tempDir("bun-check-plugin", project(right));
    const results = await Promise.all([build(String(withError), entry), build(String(without), entry)]);
    expect(results).toEqual([result(["TS2322 lib.ts"]), result([])]);
  },
  timeout,
);

it(
  "what a plugin-loaded file imports is not checked without `check`",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      ...project(wrong),
      "build.mjs": script(svelte("lib.ts"), "{ check: false }"),
    });
    expect(await build(String(dir), "main.ts")).toEqual({ passes: true, errors: [], isWritten: true });
  },
  timeout,
);

// Like an import of `main.ts`: with the options of the project of `main.ts`. That is so if the program has the file,
// and if it does not: `include` does not find it, and no import of TypeScript leads to it.
it.each([
  ["a strict app and a package that is not", true, false, ["TS7006 packages/lib/src/index.ts"]],
  ["a strict package and an app that is not", false, true, []],
])(
  "what a plugin-loaded file imports is checked in the project of the file that imports it: %s",
  async (_, ofApp, ofPackage, errors) => {
    const files = (include: object) => ({
      "tsconfig.json": config({ strict: ofApp }, include),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      "packages/lib/tsconfig.json": config({ strict: ofPackage }, { include: ["src"] }),
      "packages/lib/src/index.ts": loose,
      "build.mjs": script(svelte("packages/lib/src/index.ts")),
    });
    using has = tempDir("bun-check-plugin", files({}));
    using lacks = tempDir("bun-check-plugin", files({ include: ["*.ts"] }));
    const results = await Promise.all([build(String(has), "main.ts"), build(String(lacks), "main.ts")]);
    expect(results).toEqual([result(errors), result(errors)]);
  },
  timeout,
);

it.each([
  ["an error", wrong, ["TS2322 lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "a file outside `files` that a plugin-loaded file imports is checked once: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config({}, { files: ["main.ts", "shims.d.ts"] }),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      "lib.ts": value,
      "build.mjs": script(svelte("lib.ts")),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// Without `allowJs` the program of `main.ts` has no JavaScript. `util.js` is checked like a JavaScript entry point, by
// itself: `// @ts-check` is what checks it. `consumer.ts` stays in the program of `main.ts`, where `util.js` has no types.
it.each([
  ["an error", `"1"`, ["TS2322 util.js"]],
  ["nothing is wrong", `1`, []],
])(
  "a JavaScript file that a plugin-loaded file imports does not turn on `allowJs` for the program: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      "consumer.ts": `// @ts-expect-error util.js has no types\nimport { n } from "./util.js";\nexport const m: number = n;\n`,
      "util.js": `// @ts-check\n/** @type {number} */\nexport const n = ${value};\n`,
      "build.mjs": script(`
        const contents = 'import { m } from "./consumer";\\nimport { n } from "./util.js";\\nexport default [m, n];\\n';
        build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents, loader: "ts" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// The file is what its name says, whatever the plugin says it has made of it: the type checker reads what is written.
// The Svelte plugin returns what it makes of `state.svelte.ts` as JavaScript.
it.each([
  ["a TypeScript file that a plugin returns as JavaScript", "state.svelte.ts", "js", ["TS2322 state.svelte.ts"]],
  ["a JavaScript file that a plugin returns as TypeScript", "state.svelte.js", "ts", []],
])(
  "what a plugin-loaded file imports is checked as it is written: %s",
  async (_, name, loader, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      [name]: name.endsWith(".ts") ? wrong : `export const value = 1;\n`,
      "build.mjs": script(`
        build.onLoad({ filter: /App[.]svelte$/ }, () => ({ contents: imports("${name}"), loader: "ts" }));
        build.onLoad({ filter: /state[.]svelte[.][jt]s$/ }, () => ({ contents: "export const value = 1;\\n", loader: "${loader}" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// What only a plugin provides is not code of the project, like what the plugin makes of `App.vue`: TypeScript would not
// accept `f`, and nothing declares `./logo.png`. The Vue plugins make `App.vue?type=script` or
// `App.vue?vue&type=script&lang.ts` of `App.vue`. Such a module stands for what it imports too.
it.each([
  ["an error", "?type=script", wrong, ["TS2322 lib.ts"]],
  ["nothing is wrong", "?type=script", right, []],
  ["a name that ends like TypeScript, an error", "?vue&type=script&lang.ts", wrong, ["TS2322 lib.ts"]],
  ["a name that ends like TypeScript, nothing is wrong", "?vue&type=script&lang.ts", right, []],
])(
  "what only a plugin provides is not checked, and what it imports is: %s",
  async (_, query, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": `declare module "*.vue" { const component: unknown; export default component; }\n`,
      "App.vue": `<script setup lang="ts"></script>\n`,
      "lib.ts": value,
      "main.ts": `import App from "./App.vue";\nexport default App;\n`,
      "build.mjs": script(`
        const provided = 'import logo from "./logo.png";\\nexport function f(x) { return [x, logo]; }\\n' + imports("lib.ts");
        build.onResolve({ filter: /[.]png$/ }, () => ({ path: "logo", namespace: "asset" }));
        build.onLoad({ filter: /.*/, namespace: "asset" }, () => ({ contents: "export default 1;\\n", loader: "js" }));
        build.onResolve({ filter: /[?].*type=script/ }, args => ({ path: join(dir, args.path) }));
        build.onLoad({ filter: /[?].*type=script/ }, () => ({ contents: provided, loader: "ts" }));
        build.onLoad({ filter: /[.]vue$/ }, () => ({ contents: 'export { default } from "./App.vue${query}";\\n', loader: "ts" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// The plugin adds an import to a file that the type checker reads: the import is not in what is written.
it.each([
  ["an error", wrong, ["TS2322 lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "an import that a plugin adds to a TypeScript file is checked: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "lib.ts": value,
      "page.ts": `export const page = 1;\n`,
      "main.ts": `export { page } from "./page";\n`,
      "build.mjs": script(`
        const added = 'import ' + JSON.stringify(join(dir, "lib.ts")) + ';\\n';
        build.onLoad({ filter: /page[.]ts$/ }, args => ({ contents: added + readFileSync(args.path, "utf8"), loader: "ts" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// A plugin that loads the JavaScript of the project, and `*.svelte.ts`, and returns it as it is. No file is named for
// it: `util.js` stays without types, where `allowJs` is off.
it(
  "a plugin that loads what the type checker can read changes nothing",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "main.ts": `// @ts-expect-error util.js has no types\nimport { n } from "./util.js";\nexport { value } from "./state.svelte";\nexport const m: number = n;\n`,
      "state.svelte.ts": right,
      "util.js": `export const n = 1;\n`,
      "build.mjs": script(`
        build.onLoad({ filter: /[.]js$|[.]svelte[.]ts$/ }, args => ({ contents: readFileSync(args.path, "utf8"), loader: args.path.endsWith(".ts") ? "ts" : "js" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result([]));
  },
  timeout,
);

// The page has `dom` and the server does not. `shared/title.ts` is nearest to the tsconfig.json of the server. It is
// checked with the options of `web/main.ts`, which imports it through `App.svelte`, whether the tsconfig.json of the page
// includes it or not.
it.each([
  ["nothing is wrong", `export const title: string = document.title;\n`, []],
  ["an error", `export const title: number = document.title;\n`, ["TS2322 shared/title.ts"]],
])(
  "a server and a page with a plugin-loaded file, each with its tsconfig.json: %s",
  async (_, title, errors) => {
    const files = (include: string[]) => ({
      "tsconfig.json": config({}, { include: ["server.ts"] }),
      "server.ts": `export const port: number = 3000;\n`,
      "shared/title.ts": title,
      "web/tsconfig.json": config({ lib: ["esnext", "dom"] }, { include }),
      "web/shims.d.ts": shims,
      "web/App.svelte": component,
      "web/main.ts": main,
      "build.mjs": script(svelte("shared/title.ts")),
    });
    using includes = tempDir("bun-check-plugin", files([".", "../shared"]));
    using lacks = tempDir("bun-check-plugin", files(["."]));
    const results = await Promise.all([
      build(String(includes), "server.ts", "web/main.ts"),
      build(String(lacks), "server.ts", "web/main.ts"),
    ]);
    expect(results).toEqual([result(errors), result(errors)]);
  },
  timeout,
);

// `lib.ts` is named, and `main.ts` refers to it through `App.svelte`: one error.
it(
  "what a plugin-loaded file imports is checked once where it is an entry point too",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      "lib.ts": wrong,
      "build.mjs": script(svelte("lib.ts")),
    });
    const results = await Promise.all([
      build(String(dir), "main.ts", "lib.ts"),
      build(String(dir), "main.ts", "App.svelte"),
    ]);
    expect(results).toEqual([result(["TS2322 lib.ts"]), result(["TS2322 lib.ts"])]);
  },
  timeout,
);

// The kinds of project of `entry-points.test.ts`. `app`: where the files are, and where the build is started.
// `tsconfig`: the option of that name.
type Kind = { name: string; app: string; tsconfig?: string; files: Record<string, string> };
const composite = { noEmit: false, composite: true, outDir: "dist" };
const kinds: Kind[] = [
  { name: "a tsconfig.json", app: ".", files: { "tsconfig.json": config() } },
  {
    // The program of the app is made with the outputs of what it references.
    name: "references",
    app: "app",
    files: {
      "shared/tsconfig.json": config(composite, { include: ["*.ts"] }),
      "shared/shared.ts": `export const shared: number = 1;\n`,
      "app/tsconfig.json": config({}, { references: [{ path: "../shared" }] }),
    },
  },
  {
    name: "under a solution",
    app: "app",
    files: {
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./app" }] }),
      "app/tsconfig.json": config(composite),
    },
  },
  {
    // As `bun create vite` lays it out.
    name: "beside a solution",
    app: ".",
    files: {
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
      "tsconfig.app.json": config(),
    },
  },
  // The program is `main.ts` and what it refers to. `lib.ts` is checked in that program.
  { name: "no tsconfig.json", app: ".", files: {} },
  {
    name: "the `tsconfig` option",
    app: ".",
    tsconfig: "other.json",
    files: { "other.json": config(), "tsconfig.json": `{ "compilerOptions": { "strict": "no" } }` },
  },
];

it.each(kinds)(
  "what a plugin-loaded file imports is checked in every kind of project: $name",
  async ({ app, tsconfig, files }) => {
    const project = (value: string) => ({
      ...files,
      [join(app, "shims.d.ts")]: shims,
      [join(app, "App.svelte")]: component,
      [join(app, "main.ts")]: `/// <reference path="./shims.d.ts" />\n` + main,
      [join(app, "lib.ts")]: value,
      [join(app, "build.mjs")]: script(svelte("lib.ts"), tsconfig ? `{ tsconfig: "${tsconfig}" }` : "{}"),
    });
    using withError = tempDir("bun-check-plugin", project(wrong));
    using without = tempDir("bun-check-plugin", project(right));
    const results = await Promise.all([
      build(join(String(withError), app), "main.ts"),
      build(join(String(without), app), "main.ts"),
    ]);
    expect(results).toEqual([result(["TS2322 lib.ts"]), result([])]);
  },
  timeout,
);

// `lib.ts` is checked in the program of `main.ts`, which refers to the declaration of `*.svelte`.
it(
  "what a plugin-loaded file imports is checked with the files of the program where there is no tsconfig.json",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      "shims.d.ts": shims,
      "App.svelte": component,
      "Other.svelte": component,
      "main.ts": `/// <reference path="./shims.d.ts" />\n` + main,
      "lib.ts": `import Other from "./Other.svelte";\nexport const value: unknown = Other;\n`,
      "build.mjs": script(`
        build.onLoad({ filter: /App[.]svelte$/ }, () => ({ contents: imports("lib.ts"), loader: "ts" }));
        build.onLoad({ filter: /Other[.]svelte$/ }, () => ({ contents: "export default 1;\\n", loader: "ts" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result([]));
  },
  timeout,
);

// What a project that the project of `main.ts` references has is left to that project: where `main.ts` imports the file
// itself, and where it imports it through `App.svelte`.
it(
  "a file of a referenced project that a plugin-loaded file imports is left to that project",
  async () => {
    const files = (text: string) => ({
      "tsconfig.json": config({}, { include: ["*.ts"], references: [{ path: "./packages/lib" }] }),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": text,
      "packages/lib/tsconfig.json": config({ ...composite, declaration: true }, { include: ["src"] }),
      "packages/lib/src/index.ts": wrong,
      "build.mjs": script(svelte("packages/lib/src/index.ts")),
    });
    using behind = tempDir("bun-check-plugin", files(main));
    using direct = tempDir("bun-check-plugin", files(`export { value } from "./packages/lib/src/index";\n`));
    const results = await Promise.all([build(String(behind), "main.ts"), build(String(direct), "main.ts")]);
    expect(results).toEqual([result([]), result([])]);
  },
  timeout,
);

// A workspace package: `node_modules/ui` leads to `packages/ui`. The component is not installed: it is of the project.
it.each([
  ["an error", wrong, ["TS2322 packages/ui/util.ts"]],
  ["nothing is wrong", right, []],
])(
  "what a plugin-loaded file of a workspace package imports is checked: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "main.ts": `import Button from "ui/Button.svelte";\nexport default Button;\n`,
      "packages/ui/package.json": JSON.stringify({ name: "ui", version: "1.0.0" }),
      "packages/ui/Button.svelte": component,
      "packages/ui/util.ts": value,
      "build.mjs": script(svelte("packages/ui/util.ts")),
    });
    link(String(dir), "packages/ui", "node_modules/ui");
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// `files` of `Bun.build`: `main.ts` is only in memory.
it.each([
  ["an error", wrong, ["TS2322 lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "what a plugin-loaded file imports is checked where the file that imports it is only in memory: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": component,
      "lib.ts": value,
      "build.mjs": script(svelte("lib.ts"), `{ files: { [join(dir, "main.ts")]: ${JSON.stringify(main)} } }`),
    });
    expect(await build(String(dir), join(String(dir), "main.ts"))).toEqual(result(errors));
  },
  timeout,
);

// What is installed is not of the project, also where a plugin loads it.
it(
  "what a plugin loads from node_modules does not stand for what it imports",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "lib.ts": wrong,
      "main.ts": `import { n } from "dep";\nexport const m: number = n;\n`,
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "index.js" }),
      "node_modules/dep/index.d.ts": `export declare const n: number;\n`,
      "node_modules/dep/index.js": `// @ts-check\n/** @type {number} */\nexport const n = "1";\n`,
      "build.mjs": script(`
        build.onLoad({ filter: /dep[/\\\\]index[.]js$/ }, () => ({ contents: "export const n = 1;\\n" + imports("lib.ts"), loader: "js" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result([]));
  },
  timeout,
);

// What a plugin makes of the runtime of a component is installed. `lib.ts` is of the project.
it(
  "what a plugin-loaded file imports from node_modules is not checked",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": component,
      "lib.ts": wrong,
      "main.ts": main,
      "node_modules/runtime/package.json": JSON.stringify({ name: "runtime", version: "1.0.0", main: "index.js" }),
      "node_modules/runtime/index.js": `// @ts-check\n/** @type {number} */\nexport const runtime = "1";\n`,
      "build.mjs": script(`
        const contents = 'import { runtime } from "runtime";\\nimport * as lib from "./lib";\\nexport default [runtime, lib];\\n';
        build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents, loader: "ts" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(["TS2322 lib.ts"]));
  },
  timeout,
);

// `snippet.ts` is TypeScript by its name, and the component has it as text. `lib.ts` is code.
it(
  "a TypeScript file that a plugin-loaded file imports as text is not checked",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": component,
      "snippet.ts": wrong,
      "lib.ts": wrong,
      "main.ts": main,
      "build.mjs": script(`
        const contents = 'import text from "./snippet.ts" with { type: "text" };\\nimport * as lib from "./lib";\\nexport default [text, lib];\\n';
        build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents, loader: "ts" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(["TS2322 lib.ts"]));
  },
  timeout,
);

// A `data:` URL has the loader of JavaScript and is no file.
it(
  "a `data:` URL that a plugin-loaded file imports is not checked",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      "build.mjs": script(`
        const contents = 'import x from "data:text/javascript,export default 1;//x.js";\\nexport default x;\\n';
        build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents, loader: "ts" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result([]));
  },
  timeout,
);

// A component that imports itself is how Svelte has recursion. Each file is followed once.
it.each([
  ["itself", `import Self from "./Tree.svelte";\\nimport * as lib from "./lib";\\nexport default [Self, lib];\\n`, ``],
  [
    "a plugin-loaded file that imports it",
    `import Leaf from "./Leaf.svelte";\\nexport default Leaf;\\n`,
    `import Tree from "./Tree.svelte";\\nimport * as lib from "./lib";\\nexport default [Tree, lib];\\n`,
  ],
])(
  "plugin-loaded files that import each other are followed once: a component imports %s",
  async (_, tree, leaf) => {
    const files = (value: string) => ({
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "Tree.svelte": component,
      "Leaf.svelte": component,
      "lib.ts": value,
      "main.ts": `import Tree from "./Tree.svelte";\nexport default Tree;\n`,
      "build.mjs": script(`
        build.onLoad({ filter: /Tree[.]svelte$/ }, () => ({ contents: '${tree}', loader: "ts" }));
        build.onLoad({ filter: /Leaf[.]svelte$/ }, () => ({ contents: '${leaf}', loader: "ts" }));
      `),
    });
    using withError = tempDir("bun-check-plugin", files(wrong));
    using without = tempDir("bun-check-plugin", files(right));
    const results = await Promise.all([build(String(withError), "main.ts"), build(String(without), "main.ts")]);
    expect(results).toEqual([result(["TS2322 lib.ts"]), result([])]);
  },
  timeout,
);

// The component is in the graph of the server and in that of the page, and `#lib` is another file in each: one file, and
// what it imports for each.
it.each([
  ["of the page", wrong, right, ["TS2322 lib.browser.ts"]],
  ["of the server", right, wrong, ["TS2322 lib.server.ts"]],
  ["of both", wrong, wrong, ["TS2322 lib.browser.ts", "TS2322 lib.server.ts"]],
  ["of neither", right, right, []],
])(
  "a plugin-loaded file of a server and of its page stands for what it imports in both: an error in the file %s",
  async (_, browser, server, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "package.json": JSON.stringify({
        name: "app",
        imports: { "#lib": { browser: "./lib.browser.ts", default: "./lib.server.ts" } },
      }),
      "tsconfig.json": config(),
      "shims.d.ts": shims + `declare module "*.html" { const page: unknown; export default page; }\n`,
      "App.svelte": component,
      "lib.browser.ts": browser,
      "lib.server.ts": server,
      "client.ts": main,
      "index.html": `<script type="module" src="./client.ts"></script>\n`,
      "server.ts": `import page from "./index.html";\nimport App from "./App.svelte";\nexport default [page, App];\n`,
      "build.mjs": script(
        `build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents: 'import * as all from "#lib";\\nexport default all;\\n', loader: "ts" }));`,
        `{ target: "bun" }`,
      ),
    });
    expect(await build(String(dir), "server.ts")).toEqual(result(errors));
  },
  timeout,
);

// Where the component is an entry point, what it imports is named: checked by the tsconfig.json that is nearest to it,
// which is not strict here. Where only `main.ts` leads to the component, it is checked with the options of `main.ts`.
it(
  "a plugin-loaded file that is an entry point names what it imports, also where an entry point imports it",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config({ strict: true }),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      "packages/lib/tsconfig.json": config({ strict: false }, { include: ["src"] }),
      "packages/lib/src/index.ts": `export { f } from "./helper";\n`,
      "packages/lib/src/helper.ts": loose,
      "build.mjs": script(svelte("packages/lib/src/index.ts")),
    });
    const results = await Promise.all([
      build(String(dir), "main.ts"),
      build(String(dir), "App.svelte"),
      build(String(dir), "main.ts", "App.svelte"),
    ]);
    expect(results).toEqual([result(["TS7006 packages/lib/src/helper.ts"]), result([]), result([])]);
  },
  timeout,
);

// `*.svelte.ts` is TypeScript that the Svelte plugin loads. Whether a plugin has loaded the file or not, it is checked
// like any file that the component imports: here the program of `main.ts` does not have it.
it.each([
  [
    "a plugin has loaded it",
    `build.onLoad({ filter: /[.]svelte[.]ts$/ }, args => ({ contents: readFileSync(args.path, "utf8"), loader: "ts" }));`,
  ],
  ["no plugin has loaded it", ``],
])(
  "a TypeScript file that a plugin-loaded file imports is checked whether a plugin has loaded it or not: %s",
  async (_, more) => {
    const files = (text: string) => ({
      "tsconfig.json": config({}, { include: ["src"] }),
      "src/shims.d.ts": shims,
      "src/App.svelte": component,
      "src/main.ts": main,
      "packages/lib/tsconfig.json": config(),
      "packages/lib/src/state.svelte.ts": text,
      "build.mjs": script(svelte("packages/lib/src/state.svelte.ts") + more),
    });
    using withError = tempDir("bun-check-plugin", files(loose));
    using without = tempDir("bun-check-plugin", files(right));
    const results = await Promise.all([build(String(withError), "src/main.ts"), build(String(without), "src/main.ts")]);
    expect(results).toEqual([result(["TS7006 packages/lib/src/state.svelte.ts"]), result([])]);
  },
  timeout,
);

// Two levels: `a.js` and `b.js` are JavaScript that the program of `main.ts` does not have, each behind a component.
it.each([
  ["an error", `"1"`, ["TS2322 b.js"]],
  ["nothing is wrong", `1`, []],
])(
  "what is behind two plugin-loaded files and a JavaScript file between them is checked: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "A.svelte": component,
      "B.svelte": component,
      "a.js": `import B from "./B.svelte";\nexport default B;\n`,
      "b.js": `// @ts-check\n/** @type {number} */\nexport const n = ${value};\n`,
      "main.ts": `import A from "./A.svelte";\nexport default A;\n`,
      "build.mjs": script(`
        build.onLoad({ filter: /A[.]svelte$/ }, () => ({ contents: imports("a.js"), loader: "ts" }));
        build.onLoad({ filter: /B[.]svelte$/ }, () => ({ contents: imports("b.js"), loader: "ts" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// The bundler has the real path of a file. The program has the path that the file is imported by, or that `include`
// finds it by.
it.each([
  ["an error", wrong, ["TS2322 linked/lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "what a plugin-loaded file imports is one file where the program has it through a link: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "project/tsconfig.json": config(),
      "project/shims.d.ts": shims,
      "project/App.svelte": component,
      "project/main.ts": main,
      "shared/lib.ts": value,
      "project/build.mjs": script(svelte("../shared/lib.ts")),
    });
    link(String(dir), "shared", "project/linked");
    expect(await build(join(String(dir), "project"), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

it.each([
  ["an error", wrong, ["TS2322 ../shared/lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "a plugin-loaded file that is imported through a link stands for what it imports: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "project/tsconfig.json": config({}, { files: ["main.ts", "shims.d.ts"] }),
      "project/shims.d.ts": shims,
      "project/main.ts": `import page from "./linked/page";\nexport default page;\n`,
      "shared/page.ts": main,
      "shared/App.svelte": component,
      "shared/lib.ts": value,
      "project/build.mjs": script(svelte("../shared/lib.ts")),
    });
    link(String(dir), "shared", "project/linked");
    expect(await build(join(String(dir), "project"), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// Not covered. `widget.js` is JavaScript, `allowJs` is off, and `widget.d.ts` stands for it: the type checker does not
// read `widget.js`, and no plugin has loaded it, so nothing tells that it imports `App.svelte`.
it(
  "a plugin-loaded file behind a JavaScript file that the type checker does not read is not followed",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": component,
      "lib.ts": wrong,
      "widget.js": `import App from "./App.svelte";\nexport default App;\n`,
      "widget.d.ts": `declare const widget: unknown;\nexport default widget;\n`,
      "main.ts": `import widget from "./widget.js";\nexport default widget;\n`,
      "build.mjs": script(svelte("lib.ts")),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result([]));
  },
  timeout,
);

// What is followed is what the bundler has bundled. It drops an import that is only for types, and an import in a branch
// that `define` removes.
it(
  "what a plugin-loaded file imports only for its types is not followed",
  async () => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config({}, { files: ["main.ts", "shims.d.ts"] }),
      "shims.d.ts": shims,
      "App.svelte": component,
      "types.ts": `export type Props = { a: number };\nexport const value: string = 1;\n`,
      "main.ts": main,
      "build.mjs": script(`
        const contents = 'import type { Props } from "./types";\\nconst props: Props = { a: 1 };\\nexport default props;\\n';
        build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents, loader: "ts" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result([]));
  },
  timeout,
);

it.each([
  ["the branch stays", "development", ["TS2322 dev.ts"]],
  ["the branch is removed", "production", []],
])(
  "what a plugin-loaded file imports in a branch that `define` decides is followed if the bundler keeps it: %s",
  async (_, mode, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config({}, { files: ["main.ts", "shims.d.ts"] }),
      "shims.d.ts": shims,
      "App.svelte": component,
      "dev.ts": wrong,
      "main.ts": main,
      "build.mjs": script(
        `
        const contents = 'if (process.env.NODE_ENV !== "production") { import("./dev.ts"); }\\nexport default 1;\\n';
        build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents, loader: "ts" }));
      `,
        `{ define: { "process.env.NODE_ENV": '"${mode}"' } }`,
      ),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// TypeScript has the declaration of `*.svelte` for the component, which has no `count`. A declaration beside the
// component says what it exports.
it.each([
  ["without a declaration of the export", {}, ["TS2614 store.ts"]],
  [
    "with a declaration beside the component",
    {
      "App.svelte.d.ts": `export const count: number;\ndeclare const component: unknown;\nexport default component;\n`,
    },
    [],
  ],
] as [string, Record<string, string>, string[]][])(
  "a file behind a plugin-loaded file that imports a named export of it: %s",
  async (_, declaration, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": component,
      "store.ts": `import { count } from "./App.svelte";\nexport const n: number = count;\n`,
      "main.ts": main,
      ...declaration,
      "build.mjs": script(`
        const contents = 'import * as all from "./store";\\nexport const count = 1;\\nexport default all;\\n';
        build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents, loader: "ts" }));
      `),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// The Svelte plugin of this repository. What it makes of `App.svelte` imports `lib.ts` and the runtime of Svelte.
it.each([
  ["an error", wrong, ["TS2322 lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "what a component imports is checked with bun-plugin-svelte: %s",
  async (_, value, errors) => {
    const plugin = Bun.resolveSync("bun-plugin-svelte", import.meta.dir);
    const runtime = dirname(Bun.resolveSync("svelte/package.json", plugin));
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": `<script lang="ts">\n  import { value } from "./lib";\n</script>\n\n<p>{value}</p>\n`,
      "lib.ts": value,
      "main.ts": main,
      "build.mjs": `
        import { relative } from "node:path";
        import { SveltePlugin } from ${JSON.stringify(plugin)};
        const dir = process.cwd();
        const built = await Bun.build({ entrypoints: process.argv.slice(2), outdir: "out", check: true, throw: false, plugins: [SveltePlugin()] });
        ${print}
      `,
    });
    mkdirSync(join(String(dir), "node_modules"));
    symlinkSync(runtime, join(String(dir), "node_modules", "svelte"), "junction");
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);
