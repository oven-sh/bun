// `Bun.build({ check: true })` with a plugin. The type checker cannot read what only a plugin can read, like `App.svelte`:
// a declaration stands for it. So the type checker does not find what `App.svelte` imports. The bundler tells it, and a
// file that imports `App.svelte` refers to what `App.svelte` imports: `lib.ts` is checked like an import of `main.ts`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

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

// `setup` is the body of `setup(build)` of the plugin. `dir` is the project, and `imports(file)` is what a plugin makes of
// a file that imports `file` of the project. `more` is an expression for more options of the build.
const script = (setup: string, more = "{}") => `
  import { readFileSync } from "node:fs";
  import { join, relative } from "node:path";
  const dir = process.cwd();
  const imports = file => "import * as all from " + JSON.stringify(join(dir, file)) + ";\\nexport default all;\\n";
  const plugin = { name: "plugin", setup(build) { ${setup} } };
  const built = await Bun.build({ entrypoints: process.argv.slice(2), outdir: "out", check: true, throw: false, plugins: [plugin], ...${more} });
  const file = log => relative(dir, log.position?.file ?? "").replaceAll("\\\\", "/");
  console.log(JSON.stringify({
    passes: built.success,
    errors: built.logs.map(log => log.message.split(":")[0] + " " + file(log)),
    isWritten: built.outputs.length > 0,
  }));
`;
// The plugin makes of each `.svelte` file a module that imports `file`.
const svelte = (file: string) =>
  `build.onLoad({ filter: /[.]svelte$/ }, () => ({ contents: imports("${file}"), loader: "ts" }));`;

async function build(dir: string, ...entries: string[]): Promise<Result> {
  await using proc = Bun.spawn({
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

// Like an import of `main.ts`: in the program of `main.ts`, with the options of that program.
it.each([
  ["a strict app and a package that is not", true, false, ["TS7006 packages/lib/src/index.ts"]],
  ["a strict package and an app that is not", false, true, []],
])(
  "what a plugin-loaded file imports is checked in the program of the file that imports it: %s",
  async (_, ofApp, ofPackage, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config({ strict: ofApp }),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      "packages/lib/tsconfig.json": config({ strict: ofPackage }, { include: ["src"] }),
      "packages/lib/src/index.ts": loose,
      "build.mjs": script(svelte("packages/lib/src/index.ts")),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
  },
  timeout,
);

// The program of `main.ts` does not have the file: it is not in `include`, and no import of TypeScript leads to it. It
// is checked like the script of a page that the program does not have: in its own project, once.
it.each([
  ["a strict package and an app that is not", false, true, ["TS7006 packages/lib/src/index.ts"]],
  ["a strict app and a package that is not", true, false, []],
])(
  "what a plugin-loaded file imports is checked in its own project if the program does not have it: %s",
  async (_, ofApp, ofPackage, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config({ strict: ofApp }, { include: ["*.ts"] }),
      "shims.d.ts": shims,
      "App.svelte": component,
      "main.ts": main,
      "packages/lib/tsconfig.json": config({ strict: ofPackage }, { include: ["src"] }),
      "packages/lib/src/index.ts": loose,
      "build.mjs": script(svelte("packages/lib/src/index.ts")),
    });
    expect(await build(String(dir), "main.ts")).toEqual(result(errors));
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

// The page has `dom` and the server does not. `shared/title.ts` is nearest to the tsconfig.json of the server, and the
// tsconfig.json of the page includes it: it is checked in the program of `web/main.ts`, which imports it through `App.svelte`.
it.each([
  ["nothing is wrong", `export const title: string = document.title;\n`, []],
  ["an error", `export const title: number = document.title;\n`, ["TS2322 shared/title.ts"]],
])(
  "a server and a page with a plugin-loaded file, each with its tsconfig.json: %s",
  async (_, title, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": config({}, { include: ["server.ts"] }),
      "server.ts": `export const port: number = 3000;\n`,
      "shared/title.ts": title,
      "web/tsconfig.json": config({ lib: ["esnext", "dom"] }, { include: [".", "../shared"] }),
      "web/shims.d.ts": shims,
      "web/App.svelte": component,
      "web/main.ts": main,
      "build.mjs": script(svelte("shared/title.ts")),
    });
    expect(await build(String(dir), "server.ts", "web/main.ts")).toEqual(result(errors));
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

// As `bun create vite` makes it: tsconfig.json has no files of its own, and it references the project of the app.
it.each([
  ["an error", wrong, ["TS2322 src/lib.ts"]],
  ["nothing is wrong", right, []],
])(
  "what a plugin-loaded file imports is checked in a project that a tsconfig.json references: %s",
  async (_, value, errors) => {
    using dir = tempDir("bun-check-plugin", {
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }],
      }),
      "tsconfig.app.json": config({}, { include: ["src"] }),
      "tsconfig.node.json": config({}, { include: ["vite.config.ts"] }),
      "vite.config.ts": `export default {};\n`,
      "src/shims.d.ts": shims,
      "src/App.svelte": component,
      "src/main.ts": main,
      "src/lib.ts": value,
      "build.mjs": script(svelte("src/lib.ts")),
    });
    expect(await build(String(dir), "src/main.ts")).toEqual(result(errors));
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
