// What `bun build --check` and `Bun.build({ check: true })` check: the entry points, what the type checker finds from them,
// and every TypeScript file that the bundler reads and that is of the project of an entry point. The bundler follows what
// only a plugin can read, and it does not resolve as TypeScript does, so the type checker does not find every such file.
// A file of another project is left as it is: which tsconfig.json is to judge it is not decided.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  NO_COLOR: "1",
  // A debug build says how many programs a check has loaded.
  BUN_DEBUG_TypeCheck: "1",
};

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

type Result = { passes: boolean; errors: string[]; isWritten: boolean; programs?: number };
// `programs`: how many programs the check loads. Only a debug build tells.
const result = (errors: string[], programs: number): Result => ({
  passes: errors.length === 0,
  errors,
  isWritten: errors.length === 0,
  ...(isDebug && { programs }),
});

const programsOf = (stdout: string) =>
  isDebug && { programs: Number(/\[typecheck\] (\d+) programs/.exec(stdout)?.[1]) };

// `bun build --check`, from `from` in `dir`.
async function build(dir: string, args: string[], from = "."): Promise<Result> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--check", ...args, "--outdir", join(dir, "out")],
    cwd: join(dir, from),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const errors = [...stderr.replaceAll("\\", "/").matchAll(/^error: (TS\d+): .*\n +at (.+):\d+:\d+$/gm)];
  const root = dir.replaceAll("\\", "/") + "/";
  return {
    passes: exitCode === 0,
    errors: errors.map(([, code, file]) => `${code} ${file.replace(root, "")}`),
    isWritten: existsSync(join(dir, "out")),
    ...programsOf(stdout),
  };
}

// `Bun.build({ check: true })` with a plugin: `setup` is the body of its `setup(build)`, and `dir` is the project.
// `more`: an expression for more options.
const script = (setup: string, more = "{}") => `
  import { join, relative } from "node:path";
  const dir = process.cwd();
  const [entry] = process.argv.slice(2);
  const plugin = { name: "plugin", setup(build) { ${setup} } };
  const built = await Bun.build({ entrypoints: [entry], outdir: "out", check: true, throw: false, plugins: [plugin], ...${more} });
  const file = log => relative(dir, log.position?.file ?? "").replaceAll("\\\\", "/");
  console.log(JSON.stringify({
    passes: built.success,
    errors: built.logs.map(log => log.message.split(":")[0] + " " + file(log)),
    isWritten: built.outputs.length > 0,
  }));
`;
async function bunBuild(dir: string, entry: string): Promise<Result> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.mjs", entry],
    cwd: dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return { ...JSON.parse(stdout.trim().split("\n").at(-1)!), ...programsOf(stdout) };
}

// `path` leads to `target`, both in `dir`: a junction on Windows, which needs no privilege.
function link(dir: string, target: string, path: string) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  symlinkSync(join(dir, target), join(dir, path), "junction");
}

// A check in a debug build takes seconds, and as many threads as there are cores.
const it = test.concurrentIf(!isDebug);
const timeout = isDebug ? 60_000 : undefined;

// The type checker cannot read `App.svelte`: a declaration stands for it. So it finds nothing that `App.svelte` imports.
const withPlugin = (value: string, more: Record<string, string> = {}) => ({
  "tsconfig.json": config(),
  "shims.d.ts": `
    declare module "*.svelte" { const component: unknown; export default component; }
    declare module "virtual:app" { const app: unknown; export default app; }
    declare module "app:config" { export const value: string; }
  `,
  "App.svelte": `<script lang="ts"></script>\n`,
  "lib.ts": value,
  // In the project, and the bundler does not read it: it is not checked.
  "unused.ts": wrong,
  "main.ts": `import App from "./App.svelte";\nexport default App;\n`,
  "dynamic.ts": `export const load = () => import("./App.svelte");\n`,
  "deep.ts": `export { default } from "./main";\n`,
  "virtual.ts": `import app from "virtual:app";\nexport default app;\n`,
  "index.html": `<script type="module" src="./main.ts"></script>\n`,
  "alias.ts": `import { value } from "app:config";\nexport default value;\n`,
  "build.mjs": script(`
    const contents = 'import { value } from ' + JSON.stringify(join(dir, "lib.ts")) + ';\\nexport default value;\\n';
    build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents, loader: "ts" }));
    build.onResolve({ filter: /^virtual:app$/ }, () => ({ path: "app", namespace: "virtual" }));
    build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents, loader: "ts" }));
    build.onResolve({ filter: /^app:config$/ }, () => ({ path: join(dir, "lib.ts") }));
  `),
  ...more,
});

it.each([
  ["a static import", "main.ts"],
  ["import()", "dynamic.ts"],
  ["two imports away", "deep.ts"],
  ["in a namespace of the plugin", "virtual.ts"],
  ["from the script of a page", "index.html"],
  ["onResolve alone leads to the file", "alias.ts"],
])(
  "what a plugin leads to is checked: %s",
  async (_, entry) => {
    using dir = tempDir("bun-check-bundled", withPlugin(wrong));
    expect(await bunBuild(String(dir), entry)).toEqual(result(["TS2322 lib.ts"], 1));
  },
  timeout,
);

it(
  "what a plugin leads to is checked: nothing is wrong",
  async () => {
    using dir = tempDir("bun-check-bundled", withPlugin(right));
    expect(await bunBuild(String(dir), "main.ts")).toEqual(result([], 1));
  },
  timeout,
);

// `files` keeps `lib.ts` out of the program, so the check is done again with `lib.ts` named.
it.each([
  ["an error", wrong, ["TS2322 lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "what a plugin leads to is checked where the program does not have the file: %s",
  async (_, value, errors) => {
    const files = withPlugin(value, { "tsconfig.json": config({}, { files: ["main.ts", "shims.d.ts"] }) });
    using dir = tempDir("bun-check-bundled", files);
    expect(await bunBuild(String(dir), "main.ts")).toEqual(result(errors, 2));
  },
  timeout,
);

// Every root that the bundler names is dropped: `App.svelte` is not TypeScript, and its runtime is installed.
it(
  "what a plugin leads to is checked: no entry point stands for the file",
  async () => {
    using dir = tempDir("bun-check-bundled", {
      "tsconfig.json": config({}, { files: ["shims.d.ts"] }),
      "shims.d.ts": `declare module "app:config" { export const value: string; }\n`,
      "App.svelte": `<script lang="ts"></script>\n`,
      "conf.ts": wrong,
      "node_modules/runtime/package.json": JSON.stringify({ name: "runtime", version: "1.0.0", main: "index.js" }),
      "node_modules/runtime/index.js": `export { value } from "app:config";\n`,
      "build.mjs": script(`
        build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents: 'export { value } from "runtime";\\n', loader: "ts" }));
        build.onResolve({ filter: /^app:config$/ }, () => ({ path: join(dir, "conf.ts") }));
      `),
    });
    expect(await bunBuild(String(dir), "App.svelte")).toEqual(result(["TS2322 conf.ts"], 1));
  },
  timeout,
);

// What only a plugin provides is not written in the project. TypeScript would not accept `f` as it is.
it(
  "what only a plugin provides is not checked unless the project imports it",
  async () => {
    using dir = tempDir("bun-check-bundled", {
      "tsconfig.json": config(),
      "shims.d.ts": `declare module "*.svelte" { const component: unknown; export default component; }\n`,
      "App.svelte": `<script lang="ts"></script>\n`,
      "main.ts": `import App from "./App.svelte";\nexport default App;\n`,
      "build.mjs": script(`
        build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents: 'export { f as default } from "./generated";\\n', loader: "ts" }));
        build.onResolve({ filter: /[/]generated$/ }, () => ({ path: join(dir, "generated.ts") }));
        build.onLoad({ filter: /generated[.]ts$/ }, () => ({ contents: "export function f(x) { return x; }\\n", loader: "ts" }));
      `),
    });
    expect(await bunBuild(String(dir), "main.ts")).toEqual(result([], 1));
  },
  timeout,
);

// A file that a plugin has loaded is what its name says, whatever the plugin says it has made of it: the type checker
// reads the file. The Svelte plugin returns what it makes of `state.svelte.ts` as JavaScript.
it.each([
  ["a TypeScript file that a plugin returns as JavaScript", "state.svelte.ts", "js", ["TS2322 state.svelte.ts"]],
  ["a JavaScript file that a plugin returns as TypeScript", "state.svelte.js", "ts", []],
])(
  "what a plugin leads to is checked by its name: %s",
  async (_, name, loader, errors) => {
    using dir = tempDir("bun-check-bundled", {
      "tsconfig.json": config(),
      "shims.d.ts": `declare module "*.svelte" { const component: unknown; export default component; }\n`,
      "App.svelte": `<script lang="ts"></script>\n`,
      [name]: name.endsWith(".ts") ? wrong : `export const value = 1;\n`,
      "main.ts": `import App from "./App.svelte";\nexport default App;\n`,
      "build.mjs": script(`
        const contents = 'export { value as default } from ' + JSON.stringify(join(dir, ${JSON.stringify(name)})) + ';\\n';
        build.onLoad({ filter: /App[.]svelte$/ }, () => ({ contents, loader: "ts" }));
        build.onLoad({ filter: /state[.]svelte[.][jt]s$/ }, () => ({ contents: "export const value = 1;\\n", loader: ${JSON.stringify(loader)} }));
      `),
    });
    expect(await bunBuild(String(dir), "main.ts")).toEqual(result(errors, 1));
  },
  timeout,
);

// `files` of `Bun.build`: the file is only in memory, and no program has it.
it.each([
  ["an error", wrong, ["TS2322 lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "a file that is only in memory is checked: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-bundled", {
      "tsconfig.json": config({}, { files: ["main.ts"] }),
      "main.ts": `declare const require: (name: string) => unknown;\nexport const lib = require("./lib.ts");\n`,
      "build.mjs": script("", `{ files: { [join(dir, "lib.ts")]: ${JSON.stringify(value)} } }`),
    });
    expect(await bunBuild(String(dir), "main.ts")).toEqual(result(errors, 2));
  },
  timeout,
);

// One project. With `include`, the file is in the program, where it is checked. With `files`, no program has it, and the
// check is done again with the file named. Either way the result is that of `main.ts` importing the file by its name.
it.each([
  [
    // `include` leaves `both.tsx` out: `both.ts` stands for both.
    "`.tsx` before `.ts`",
    { "both.ts": right, "both.tsx": wrong, "main.ts": `export { value } from "./both";\n` },
    "both.tsx",
    2,
  ],
  [
    "the `browser` map",
    {
      "package.json": JSON.stringify({ name: "app", browser: { "./db.ts": "./db.browser.ts" } }),
      "db.ts": right,
      "db.browser.ts": wrong,
      "main.ts": `export { value } from "./db";\n`,
    },
    "db.browser.ts",
    1,
  ],
  [
    "a JavaScript file in between",
    { "setup.js": `export { value } from "./price";\n`, "price.ts": wrong, "main.ts": `import "./setup.js";\n` },
    "price.ts",
    1,
  ],
  [
    "require()",
    {
      "lib.ts": wrong,
      "main.ts": `declare const require: (name: string) => unknown;\nexport const lib = require("./lib");\n`,
    },
    "lib.ts",
    1,
  ],
] as [string, Record<string, string>, string, number][])(
  "a file that TypeScript does not find is checked: %s",
  async (_, files, file, withInclude) => {
    using included = tempDir("bun-check-bundled", { "tsconfig.json": config(), ...files });
    using listed = tempDir("bun-check-bundled", { "tsconfig.json": config({}, { files: ["main.ts"] }), ...files });
    const imported = { ...files, "main.ts": `import "./${file}";\n` };
    using control = tempDir("bun-check-bundled", {
      "tsconfig.json": config({ allowImportingTsExtensions: true, jsx: "preserve" }, { files: ["main.ts"] }),
      ...imported,
    });
    const results = await Promise.all([
      build(String(included), ["main.ts"]),
      build(String(listed), ["main.ts"]),
      build(String(control), ["main.ts"]),
    ]);
    const errors = [`TS2322 ${file}`];
    expect(results).toEqual([result(errors, withInclude), result(errors, 2), result(errors, 1)]);
  },
  timeout,
);

// The entry point is JavaScript, so its program reads JavaScript whatever `allowJs` says. So does the program that is
// made when the check is done again.
it(
  "a file that TypeScript does not find is checked: a JavaScript entry point",
  async () => {
    using dir = tempDir("bun-check-bundled", {
      "tsconfig.json": config({}, { files: ["types.d.ts"] }),
      "types.d.ts": `declare const loaded: boolean;\n`,
      "package.json": JSON.stringify({ name: "app", browser: { "./db.ts": "./db.browser.ts" } }),
      "db.ts": right,
      "db.browser.ts": wrong,
      "main.js": `export { value } from "./db";\nexport { used } from "./used";\n`,
      "used.ts": `export const used: boolean = loaded;\n`,
    });
    expect(await build(String(dir), ["main.js"])).toEqual(result(["TS2322 db.browser.ts"], 2));
  },
  timeout,
);

// Two programs, one for each entry point. `db.browser.ts` is in the first, which does not know whether the second
// reads it, so the check is done again with `db.browser.ts` named.
it(
  "a file that TypeScript does not find is checked: entry points of two projects",
  async () => {
    using dir = tempDir("bun-check-bundled", {
      "a/tsconfig.json": config(),
      "a/package.json": JSON.stringify({ name: "a", browser: { "./db.ts": "./db.browser.ts" } }),
      "a/db.ts": right,
      "a/db.browser.ts": wrong,
      "a/main.ts": `export { value } from "./db";\n`,
      "b/tsconfig.json": config(),
      "b/main.ts": `export const b: number = 1;\n`,
    });
    expect(await build(String(dir), ["a/main.ts", "b/main.ts"])).toEqual(result(["TS2322 a/db.browser.ts"], 4));
  },
  timeout,
);

// A workspace package: `packages/lib`, which `node_modules/lib` leads to, with a tsconfig.json of its own. TypeScript
// takes `types`, and the bundler takes the source. Which of the two tsconfig.json files is to judge the source is not
// decided, so it is left as it is: not checked.
it.each([
  ["an error", wrong],
  ["nothing is wrong", right],
])(
  "a file of another project is left as it is: %s",
  async (_, value) => {
    using dir = tempDir("bun-check-bundled", {
      "package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
      "tsconfig.json": config({}, { include: ["src"] }),
      "src/main.ts": `import { value } from "lib";\nexport const length: number = value.length;\n`,
      "packages/lib/package.json": JSON.stringify({
        name: "lib",
        version: "1.0.0",
        module: "./src/index.ts",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
      }),
      "packages/lib/tsconfig.json": config({}, { include: ["src"] }),
      "packages/lib/src/index.ts": value,
      "packages/lib/dist/index.d.ts": `export declare const value: string;\n`,
      "packages/lib/dist/index.js": `exports.value = "1";\n`,
    });
    link(String(dir), "packages/lib", "node_modules/lib");
    expect(await build(String(dir), ["src/main.ts", "--target=browser"])).toEqual(result([], 1));
  },
  timeout,
);

// The source of a package that is installed is not of the project.
it(
  "a file in node_modules is left as it is",
  async () => {
    using dir = tempDir("bun-check-bundled", {
      "tsconfig.json": config(),
      "main.ts": `import { value } from "dep";\nexport const length: number = value.length;\n`,
      "node_modules/dep/package.json": JSON.stringify({
        name: "dep",
        version: "1.0.0",
        module: "./src/index.ts",
        main: "./index.js",
        types: "./index.d.ts",
      }),
      "node_modules/dep/src/index.ts": wrong,
      "node_modules/dep/index.d.ts": `export declare const value: string;\n`,
      "node_modules/dep/index.js": `exports.value = "1";\n`,
    });
    expect(await build(String(dir), ["main.ts", "--target=browser"])).toEqual(result([], 1));
  },
  timeout,
);

// What the type checker finds from the entry point is in the program of the entry point, and keeps its options.
it.each([
  ["a strict app and a package that is not", true, false, ["TS7006 packages/lib/src/index.ts"]],
  ["a strict package and an app that is not", false, true, []],
])(
  "a file that the program of the entry point has is checked there: %s",
  async (_, ofApp, ofPackage, errors) => {
    using dir = tempDir("bun-check-bundled", {
      "tsconfig.json": config({ strict: ofApp }, { include: ["src"] }),
      "src/main.ts": `import { f } from "../packages/lib/src/index";\nexport const value = f(1);\n`,
      "packages/lib/tsconfig.json": config({ strict: ofPackage }, { include: ["src"] }),
      "packages/lib/src/index.ts": `export function f(x) {\n  return x;\n}\n`,
    });
    expect(await build(String(dir), ["src/main.ts"])).toEqual(result(errors, 1));
  },
  timeout,
);

// The app is not strict and the package is. The app imports `index.ts` of the package, and serves its page: the script
// of the page is checked in the project of the package, which has `index.ts` and does not reach it.
it.each([
  ["without the page", false, 1],
  ["with the page", true, 3],
] as [string, boolean, number][])(
  "a file that the program of the entry point has is checked there, also where a page of its project is served: %s",
  async (_, hasPage, programs) => {
    using dir = tempDir("bun-check-bundled", {
      "tsconfig.json": config({ strict: false }, { include: ["src"] }),
      "src/html.d.ts": `declare module "*.html" {\n  const page: unknown;\n  export default page;\n}\n`,
      "src/main.ts": hasPage
        ? `import page from "../packages/lib/index.html";\nimport { f } from "../packages/lib/src/index";\nexport const value = [page, f(1)];\n`
        : `import { f } from "../packages/lib/src/index";\nexport const value = f(1);\n`,
      "packages/lib/tsconfig.json": config({ strict: true }, { include: ["src"] }),
      "packages/lib/index.html": `<!doctype html><script type="module" src="./src/client.ts"></script>\n`,
      "packages/lib/src/client.ts": `export const n: number = 1;\n`,
      "packages/lib/src/index.ts": `export function f(x) {\n  return x;\n}\n`,
    });
    expect(await build(String(dir), ["src/main.ts", "--target=bun"])).toEqual(result([], programs));
  },
  timeout,
);

// The bundler has the real path of a file. The type checker has the path that the file is imported by.
it.each([
  ["an error", wrong, ["TS2322 src/shared/lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "a file behind a link is one file: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-bundled", {
      "tsconfig.json": config({}, { include: ["src"] }),
      "src/main.ts": `export { value } from "./shared/lib";\n`,
      "shared/lib.ts": value,
    });
    link(String(dir), "shared", "src/shared");
    expect(await build(String(dir), ["src/main.ts"])).toEqual(result(errors, 1));
  },
  timeout,
);

// With `preserveSymlinks`, the type checker has the file of a workspace package by the path in `node_modules`.
it.each([
  ["an error", wrong, ["TS2322 node_modules/lib/src/index.ts"]],
  ["nothing is wrong", right, []],
])(
  "a file behind a link is one file, with preserveSymlinks: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-bundled", {
      "package.json": JSON.stringify({ name: "app", workspaces: ["packages/*"] }),
      "tsconfig.json": config({ preserveSymlinks: true }),
      "main.ts": `import { value } from "lib";\nexport const length: number = value.length;\n`,
      "packages/lib/package.json": JSON.stringify({
        name: "lib",
        version: "1.0.0",
        exports: { ".": "./src/index.ts" },
      }),
      "packages/lib/src/index.ts": value,
    });
    link(String(dir), "packages/lib", "node_modules/lib");
    expect(await build(String(dir), ["main.ts"])).toEqual(result(errors, 1));
  },
  timeout,
);

it.each([
  [
    // TS6307 is about the program of the entry point, in which the file is not a root.
    "a file outside `include` of a composite project",
    {
      "tsconfig.json": config({ noEmit: false, composite: true, outDir: "dist" }, { include: ["src"] }),
      "src/main.ts": `export { value } from "../shared/lib";\n`,
      "shared/lib.ts": right,
    },
    ["TS6307 src/main.ts"],
  ],
  [
    "a declaration file that is imported",
    {
      "tsconfig.json": config({}, { files: ["main.ts"] }),
      "main.ts": `import "./env.d.ts";\nexport const value: Env = { a: 1 };\n`,
      "env.d.ts": `declare global {\n  interface Env {\n    a: number;\n  }\n}\nexport {};\n`,
    },
    [],
  ],
  [
    // `require()` leads the bundler to it, and not the type checker.
    "a declaration file that TypeScript does not find",
    {
      "tsconfig.json": config({ skipLibCheck: false }, { files: ["main.ts"] }),
      "main.ts": `declare const require: (name: string) => unknown;\nexport const env = require("./env.d.ts");\n`,
      "env.d.ts": `export declare const value: Missing;\n`,
    },
    [],
  ],
  [
    // Without `allowJs` the file has no types, and naming it would give it some.
    "a JavaScript file of the project",
    {
      "tsconfig.json": config(),
      "main.ts": `// @ts-expect-error util.js has no types\nimport { add } from "./util.js";\nexport const sum: number = add(1, 2);\n`,
      "util.js": `export function add(a, b) {\n  return a + b;\n}\n`,
    },
    [],
  ],
] as [string, Record<string, string>, string[]][])(
  "what the program of the entry point says stays as it is: %s",
  async (_, files, errors) => {
    using dir = tempDir("bun-check-bundled", files);
    const entry = "src/main.ts" in files ? "src/main.ts" : "main.ts";
    expect(await build(String(dir), [entry])).toEqual(result(errors, 1));
  },
  timeout,
);
