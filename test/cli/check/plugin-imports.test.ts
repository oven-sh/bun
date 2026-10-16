// `Bun.build({ check: true })` with a plugin. The type checker cannot read what only a plugin can read, like `App.svelte`:
// a declaration stands for it. So the type checker does not find what `App.svelte` imports, and the bundler names those
// files to it. It does that wherever `App.svelte` is in the graph, not only where it is an entry point.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

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

type Result = { passes: boolean; errors: string[]; isWritten: boolean };
const result = (errors: string[]): Result => ({
  passes: errors.length === 0,
  errors,
  isWritten: errors.length === 0,
});

// `setup` is the body of `setup(build)` of the plugin. `dir` is the project, and `imports(file)` is a statement that imports
// a file of the project: what a plugin makes of `App.svelte`.
const script = (setup: string) => `
  import { join, relative } from "node:path";
  const dir = process.cwd();
  const imports = file => "import * as all from " + JSON.stringify(join(dir, file)) + ";\\nexport default all;\\n";
  const plugin = { name: "plugin", setup(build) { ${setup} } };
  const built = await Bun.build({ entrypoints: process.argv.slice(2), outdir: "out", check: true, throw: false, plugins: [plugin] });
  const file = log => relative(dir, log.position?.file ?? "").replaceAll("\\\\", "/");
  console.log(JSON.stringify({
    passes: built.success,
    errors: built.logs.map(log => log.message.split(":")[0] + " " + file(log)),
    isWritten: built.outputs.length > 0,
  }));
`;
// What the plugin makes of each `.svelte` file: it imports `file`.
const svelte = (file: string) =>
  `build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents: imports("${file}"), loader: "ts" }));`;

async function build(dir: string, entry: string): Promise<Result> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.mjs", entry],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(stdout);
}

// A check in a debug build takes seconds, and as many threads as there are cores.
const it = test.concurrentIf(!isDebug);
const timeout = isDebug ? 60_000 : undefined;

const project = (value: string) => ({
  "tsconfig.json": config(),
  "shims.d.ts": shims + `declare module "virtual:app" { const app: unknown; export default app; }\n`,
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
  "build.mjs": script(`
    build.onLoad({ filter: /App[.]svelte$/ }, () => ({ contents: imports("lib.ts"), loader: "ts" }));
    build.onLoad({ filter: /Outer[.]svelte$/ }, () => ({ contents: imports("App.svelte"), loader: "ts" }));
    build.onResolve({ filter: /^virtual:app$/ }, () => ({ path: "app", namespace: "virtual" }));
    build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: imports("lib.ts"), loader: "ts" }));
  `),
});

it.each([
  ["the entry point", "App.svelte"],
  ["a static import", "main.ts"],
  ["import()", "dynamic.ts"],
  ["two imports away", "deep.ts"],
  ["behind another file that a plugin loads", "outer.ts"],
  ["in a namespace of the plugin", "virtual.ts"],
  ["behind the script of a page", "index.html"],
])(
  "what a plugin-loaded file imports is checked: the file is %s",
  async (_, entry) => {
    using dir = tempDir("bun-check-plugin", project(wrong));
    expect(await build(String(dir), entry)).toEqual(result(["TS2322 lib.ts"]));
  },
  timeout,
);

it(
  "what a plugin-loaded file imports is checked: nothing is wrong",
  async () => {
    using dir = tempDir("bun-check-plugin", project(right));
    expect(await build(String(dir), "main.ts")).toEqual(result([]));
  },
  timeout,
);

// Like an entry point, and like the script of a page: by the tsconfig.json that is nearest to the file.
it.each([
  ["a strict package and an app that is not", false, true, ["TS7006 packages/lib/src/index.ts"]],
  ["a strict app and a package that is not", true, false, []],
])(
  "what a plugin-loaded file imports is checked in its own project: %s",
  async (_, ofApp, ofPackage, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config({ strict: ofApp }, { include: ["*.ts"] }),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      "packages/lib/tsconfig.json": config({ strict: ofPackage }, { include: ["src"] }),
      "packages/lib/src/index.ts": `export function f(x) {\n  return x;\n}\n`,
      "build.mjs": script(svelte("packages/lib/src/index.ts")),
    });
    const results = await Promise.all([build(String(dir), "App.svelte"), build(String(dir), "main.ts")]);
    expect(results).toEqual([result(errors), result(errors)]);
  },
  timeout,
);

// Like a JavaScript entry point: it is loaded whatever `allowJs` says, and `// @ts-check` is what checks it.
it.each([
  ["an error", `"1"`, ["TS2322 util.js"]],
  ["nothing is wrong", `1`, []],
])(
  "a JavaScript file that a plugin-loaded file imports is checked like an entry point: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config(),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      "util.js": `// @ts-check\n/** @type {number} */\nexport const n = ${value};\n`,
      "build.mjs": script(svelte("util.js")),
    });
    const results = await Promise.all([build(String(dir), "App.svelte"), build(String(dir), "main.ts")]);
    expect(results).toEqual([result(errors), result(errors)]);
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

// What only a plugin provides is not code of the project, like what the plugin makes of `App.svelte`: TypeScript would not
// accept `f`, and nothing declares `./logo.png`. The Vue plugin makes `App.vue?type=script` of `App.vue`. Such a file
// stands for what it imports too.
it.each([
  ["an error", wrong, ["TS2322 lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "what only a plugin provides is not checked, and what it imports is: %s",
  async (_, value, errors) => {
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
        build.onResolve({ filter: /[?]type=script$/ }, args => ({ path: join(dir, args.path) }));
        build.onLoad({ filter: /[?]type=script$/ }, () => ({ contents: provided, loader: "ts" }));
        build.onLoad({ filter: /[.]vue$/ }, () => ({ contents: 'export { default } from "./App.vue?type=script";\\n', loader: "ts" }));
      `),
    });
    const results = await Promise.all([build(String(dir), "App.vue"), build(String(dir), "main.ts")]);
    expect(results).toEqual([result(errors), result(errors)]);
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
