import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { A, B, C, cases, tree, type Case, type Entry } from "./import-meta-glob-cases";

async function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, ...env },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** Evaluates every case in one module at `main` and returns what each one is. */
async function evaluate(root: string, main: string, cases: Case[], args: string[] = []) {
  const harness = main
    .split("/")
    .slice(1)
    .map(() => "..")
    .join("/");
  writeFileSync(
    join(root, main),
    `import { describeGlob } from "${harness}/src/harness.js";
     export default [\n${cases.map(([code]) => `await describeGlob(${code}),`).join("\n")}\n];`,
  );
  writeFileSync(
    join(root, "print.test.ts"),
    `import results from "./${main}";
     const print = () => console.log("RESULTS" + JSON.stringify(results));
     if (typeof test === "function") test("print", print);
     else print();`,
  );
  const { stdout, stderr, exitCode } = await run(root, [...args, "./print.test.ts"]);
  const line = stdout.split("\n").find(line => line.startsWith("RESULTS"));
  expect({ stderr: line ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(line!.slice("RESULTS".length)) as Entry[][];
}

function table(name: string, cases: Case[], results: () => Promise<Entry[][]>) {
  describe(name, () => {
    let actual: Entry[][];
    beforeAll(async () => {
      actual = await results();
    });
    test.each(cases.map(([code], i) => [code, i] as const))("%s", (_, i) => {
      expect(actual[i]).toEqual(cases[i][1]);
    });
  });
}

describe.each([
  ["bun run", []],
  ["bun test", ["test"]],
  ["bun test --isolate", ["test", "--isolate"]],
])("%s", (_, args) => {
  table("import.meta.glob", cases, async () => {
    using dir = tempDir("import-meta-glob", tree);
    return await evaluate(join(String(dir), "proj"), "src/main.ts", cases, args);
  });
});

// prettier-ignore
const inSpecialDirectory: Case[] = [
  ['import.meta.glob("./*.ts")', [["./p.ts", "lazy", {"default":"p"}], ["./q.ts", "lazy", {"default":"q"}]]],
  ['import.meta.glob("./*.ts", { eager: true, import: "default" })', [["./p.ts", "eager", "p"], ["./q.ts", "eager", "q"]]],
  ['import.meta.glob("../*/[pq].ts")', [["./p.ts", "lazy", {"default":"p"}], ["./q.ts", "lazy", {"default":"q"}]]],
  ['import.meta.glob("../../../dir/[ab].ts")', [["../../../dir/a.ts", "lazy", A], ["../../../dir/b.ts", "lazy", B]]],
  ['import.meta.glob("/src/*/*/*/p.ts")', [["/src/[id]/(group)/{x}/p.ts", "lazy", {"default":"p"}]]],
  ['import.meta.glob(["./*.ts", "!./p.ts"])', [["./q.ts", "lazy", {"default":"q"}]]],
  ['import.meta.glob("./p.ts", { base: "../" })', []],
];
table("in a directory whose name has glob syntax", inSpecialDirectory, async () => {
  using dir = tempDir("import-meta-glob", tree);
  return await evaluate(join(String(dir), "proj"), "src/[id]/(group)/{x}/main.ts", inSpecialDirectory);
});

// prettier-ignore
const symlinks: Case[] = [
  ['import.meta.glob("./links/*.ts")', [["./links/file.ts", "lazy", A]]],
  ['import.meta.glob("./links/**/*.ts")', [["./links/file.ts", "lazy", A], ["./links/folder/o.ts", "lazy", {"default":"other"}]]],
  ['import.meta.glob("./links/**/*.ts", { eager: true, import: "default" })', [["./links/file.ts", "eager", "a"], ["./links/folder/o.ts", "eager", "other"]]],
  ['import.meta.glob("./links/folder/*.ts")', [["./links/folder/o.ts", "lazy", {"default":"other"}]]],
];
describe.skipIf(isWindows)("symlinks", () => {
  table("are followed", symlinks, async () => {
    using dir = tempDir("import-meta-glob", tree);
    const links = join(String(dir), "proj/src/links");
    mkdirSync(links);
    symlinkSync("../dir/a.ts", join(links, "file.ts"));
    symlinkSync("../other", join(links, "folder"));
    symlinkSync("./nowhere.ts", join(links, "broken.ts"));
    return await evaluate(join(String(dir), "proj"), "src/main.ts", symlinks);
  });
});

// prettier-ignore
const tsconfigPaths: Case[] = [
  ['import.meta.glob("@/dir/[ab].ts")', [["/src/dir/a.ts", "lazy", A], ["/src/dir/b.ts", "lazy", B]]],
  ['import.meta.glob(["@/dir/[ab].ts", "!@/dir/a.ts"])', [["/src/dir/b.ts", "lazy", B]]],
  ['import.meta.glob("exact")', [["/src/dir/a.ts", "lazy", A]]],
  ['import.meta.glob("multi/*.ts")', []],
  ['import.meta.glob("src/dir/a.ts")', [["/src/dir/a.ts", "lazy", A]]],
  ['import.meta.glob("~dir/[ab].ts")', []],
  ['import.meta.glob("@/dir/a.ts", { base: "./dir" })', [["./a.ts", "lazy", A]]],
  ['import.meta.glob("@/dir/[ab].ts", { eager: true, import: "name" })', [["/src/dir/a.ts", "eager", "a"], ["/src/dir/b.ts", "eager", "b"]]],
  ['import.meta.glob(["./dir/a.ts", "@/dir/b.ts"])', [["/src/dir/a.ts", "lazy", A], ["/src/dir/b.ts", "lazy", B]]],
  ['import.meta.glob("@/**/d.ts")', [["/src/dir/sub/d.ts", "lazy", {"default":"sub/d"}]]],
];
table('tsconfig.json "paths" and "baseUrl"', tsconfigPaths, async () => {
  using dir = tempDir("import-meta-glob", {
    ...tree,
    "proj/tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["./src/*"], "exact": ["./src/dir/a.ts"], "multi/*": ["./nope/*", "./src/other/*"] },
      },
    }),
  });
  return await evaluate(join(String(dir), "proj"), "src/main.ts", tsconfigPaths);
});

// prettier-ignore
const tsconfigPathsOnly: Case[] = [
  ['import.meta.glob("@/dir/[ab].ts")', [["/src/dir/a.ts", "lazy", A], ["/src/dir/b.ts", "lazy", B]]],
];
table('tsconfig.json "paths" without "baseUrl"', tsconfigPathsOnly, async () => {
  using dir = tempDir("import-meta-glob", {
    ...tree,
    "proj/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
  });
  return await evaluate(join(String(dir), "proj"), "src/main.ts", tsconfigPathsOnly);
});

// prettier-ignore
const packageImports: Case[] = [
  ['import.meta.glob("#dir/*.ts")', [["/src/dir/Upper.ts", "lazy", {"default":"upper"}], ["/src/dir/a.ts", "lazy", A], ["/src/dir/b.ts", "lazy", B], ["/src/dir/c.ts", "lazy", C], ["/src/dir/skip.ts", "lazy", {"default":"skip"}]]],
  ['import.meta.glob("#one")', [["/src/dir/a.ts", "lazy", A]]],
  ['import.meta.glob("#dir/**/d.ts")', [["/src/dir/sub/d.ts", "lazy", {"default":"sub/d"}]]],
];
table('package.json "imports"', packageImports, async () => {
  using dir = tempDir("import-meta-glob", tree);
  return await evaluate(join(String(dir), "proj"), "src/main.ts", packageImports);
});

/** Runs `code` as `proj/src/entry.ts`, the entry point. It prints JSON. */
async function runEntry(code: string, files: Record<string, string> = {}, args: string[] = ["src/entry.ts"]) {
  using dir = tempDir("import-meta-glob", { ...tree, ...files, "proj/src/entry.ts": code });
  const { stdout, stderr, exitCode } = await run(join(String(dir), "proj"), args);
  return { stdout: stdout.trim(), stderr: stderr.replaceAll(String(dir), "<dir>").replaceAll("\\", "/"), exitCode };
}

describe.concurrent("import.meta.glob", () => {
  // The queries are what Vite appends.
  test.each([
    [`{ query: "?x=1" }`, `() => import("./dir/a.ts?x=1")`],
    [`{ query: "x=1" }`, `() => import("./dir/a.ts?x=1")`],
    [`{ query: { x: 1, y: "z", b: true, f: 1.5 } }`, `() => import("./dir/a.ts?x=1&y=z&b=true&f=1.5")`],
    [`{ query: { "a b": "c&d/é~!*'()" } }`, `() => import("./dir/a.ts?a+b=c%26d%2F%C3%A9~!*'()")`],
    [`{ query: { big: 1e21, neg: -0, small: 1e-7 } }`, `() => import("./dir/a.ts?big=1e%2B21&neg=0&small=1e-7")`],
    [
      '{ query: { "k=": "v=;,?:@$-_.|`^#+%", empty: "", zero: 0, no: false } }',
      '() => import("./dir/a.ts?k%3D=v=;,?:@$-_.|`^%23%2B%25&empty&zero=0&no=false")',
    ],
    [`{ query: "?x", import: "setup" }`, `() => import("./dir/a.ts?x").then((m) => m.setup)`],
    [`{ import: "not an identifier" }`, `() => import("./dir/a.ts").then((m) => m["not an identifier"])`],
    [`{ as: "other" }`, `() => import("./dir/a.ts?other")`],
  ])("a lazy entry with %s", async (options, expected) => {
    expect(await runEntry(`console.log(String(import.meta.glob("./dir/a.ts", ${options})["./dir/a.ts"]));`)).toEqual({
      stdout: expected,
      stderr: "",
      exitCode: 0,
    });
  });

  test("only a direct call is replaced", async () => {
    const { stdout, stderr, exitCode } = await runEntry(`
      console.log(JSON.stringify([
        Object.keys(import.meta.glob("./dir/a.ts")),
        typeof import.meta.glob,
        import.meta.glob?.("./dir/a.ts") ?? null,
        import.meta?.glob ?? null,
        import.meta["glob"] ?? null,
      ]));`);
    expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: [["./dir/a.ts"], "undefined", null, null, null],
      stderr: "",
      exitCode: 0,
    });
  });

  test("Bun.Transpiler and --no-bundle leave it alone", async () => {
    const source = `export const x = import.meta.glob("./dir/a.ts");\n`;
    const { stdout, stderr, exitCode } = await runEntry(`
      console.log(JSON.stringify([
        Object.keys(import.meta.glob("./dir/a.ts")),
        new Bun.Transpiler({ loader: "ts" }).transformSync(${JSON.stringify(source)}),
        new Bun.Transpiler({ loader: "ts" }).scan(${JSON.stringify(source)}).imports,
      ]));`);
    expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: [["./dir/a.ts"], source, []],
      stderr: "",
      exitCode: 0,
    });
    expect(await runEntry(source, {}, ["build", "--no-bundle", "src/entry.ts"])).toEqual({
      stdout: source.trim(),
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    [`"./${"a/".repeat(60_000)}*.ts"`, "The glob pattern is too long for a path"],
    [`"./*.ts", { base: "./${"a/".repeat(60_000)}" }`, 'The "import.meta.glob" option "base" is too long for a path'],
  ])("text that is too long for a path", async (args, message) => {
    const { stdout, stderr, exitCode } = await runEntry(`console.log(import.meta.glob(${args}));`);
    expect({ stdout, stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
      stdout: "",
      stderr: ["error: " + message],
      exitCode: 1,
    });
  });

  // Vite looks in the whole file system.
  test("a pattern that starts with ** is looked for in the project", async () => {
    expect(await runEntry(`console.log(JSON.stringify(Object.keys(import.meta.glob("**/[dq].ts"))));`)).toEqual({
      stdout: `["/src/[id]/(group)/{x}/q.ts","/src/dir/sub/d.ts"]`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("bun -e", async () => {
    expect(
      await runEntry("", {}, ["-e", `console.log(JSON.stringify(Object.keys(import.meta.glob("./src/dir/[ab].ts"))))`]),
    ).toEqual({ stdout: `["./src/dir/a.ts","./src/dir/b.ts"]`, stderr: "", exitCode: 0 });
  });

  const sideEffects = {
    "proj/src/effects/one.ts": `console.log("one was evaluated");`,
    "proj/src/effects/two.ts": `console.log("two was evaluated");`,
  };

  test("eager entries are evaluated before the importing module, in order", async () => {
    expect(
      await runEntry(
        `console.log("entry");
         function unused() { return import.meta.glob("./effects/*.ts", { eager: true }); }`,
        sideEffects,
      ),
    ).toEqual({ stdout: "one was evaluated\ntwo was evaluated\nentry", stderr: "", exitCode: 0 });
  });

  test("Object.keys(import.meta.glob()) imports nothing", async () => {
    expect(
      await runEntry(
        `console.log(JSON.stringify(Object.keys(import.meta.glob("./effects/*.ts", { eager: true }))));`,
        sideEffects,
      ),
    ).toEqual({ stdout: `["./effects/one.ts","./effects/two.ts"]`, stderr: "", exitCode: 0 });
  });

  test("a call in dead code imports nothing", async () => {
    expect(
      await runEntry(
        `if (false) import.meta.glob("./effects/*.ts", { eager: true });
         console.log(JSON.stringify(Object.keys(import.meta.glob("./effects/o*.ts"))));`,
        sideEffects,
      ),
    ).toEqual({ stdout: `["./effects/one.ts"]`, stderr: "", exitCode: 0 });
  });

  const assets = {
    "proj/src/assets/icon.svg": "<svg/>",
    "proj/src/assets/module.ts": "export default 1;",
    "proj/src/assets/query.sql": "select 1",
  };

  test.each([
    [`{ query: "?raw", import: "default" }`, `{ query: "?raw", import: "default", eager: true }`],
    [`{ as: "raw" }`, `{ as: "raw", eager: true }`],
  ])("%s is the text of each file", async (lazy, eager) => {
    const { stdout, stderr, exitCode } = await runEntry(
      `const lazy = import.meta.glob("./assets/*", ${lazy});
       for (const key in lazy) lazy[key] = await lazy[key]();
       console.log(JSON.stringify([lazy, import.meta.glob("./assets/*", ${eager})]));`,
      assets,
    );
    const text = {
      "./assets/icon.svg": "<svg/>",
      "./assets/module.ts": "export default 1;",
      "./assets/query.sql": "select 1",
    };
    expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({ stdout: [text, text], stderr: "", exitCode: 0 });
  });

  test(`{ query: "?url" } is the path of each file`, async () => {
    const { stdout, stderr, exitCode } = await runEntry(
      `const lazy = import.meta.glob("./assets/*", { query: "?url", import: "default" });
       for (const key in lazy) lazy[key] = await lazy[key]();
       const eager = import.meta.glob("./assets/*", { query: "?url", import: "default", eager: true });
       const relative = paths => Object.values(paths).map(path => require("path").relative(import.meta.dir, path).replaceAll("\\\\", "/"));
       console.log(JSON.stringify([relative(lazy), relative(eager)]));`,
      assets,
    );
    const paths = ["assets/icon.svg", "assets/module.ts", "assets/query.sql"];
    expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: [paths, paths],
      stderr: "",
      exitCode: 0,
    });
  });

  test("in a CommonJS module", async () => {
    const files = {
      "proj/src/lazy.cjs": `module.exports = import.meta.glob("./dir/[ab].ts", { import: "name" });`,
      "proj/src/eager.cjs": `module.exports = import.meta.glob("./dir/[ab].ts", { eager: true });`,
    };
    expect(
      await runEntry(`const lazy = require("./lazy.cjs"); console.log(await lazy["./dir/b.ts"]());`, files),
    ).toEqual({ stdout: "b", stderr: "", exitCode: 0 });
    const { stdout, stderr, exitCode } = await runEntry(`require("./eager.cjs");`, files);
    expect({ stdout, stderr: stderr.split("\n").filter(line => /^error|^ +at /.test(line)), exitCode }).toEqual({
      stdout: "",
      stderr: [
        "error: Cannot use import statement with CommonJS-only features",
        "    at <dir>/proj/src/eager.cjs:1:35",
      ],
      exitCode: 1,
    });
  });

  test("in a module that a plugin made up", async () => {
    const { stdout, stderr, exitCode } = await runEntry(
      `Bun.plugin({
         name: "virtual",
         setup(build) {
           build.onResolve({ filter: /^virtual:/ }, ({ path }) => ({ path, namespace: "virtual" }));
           build.onLoad({ filter: /./, namespace: "virtual" }, ({ path }) => ({
             loader: "ts",
             contents: path === "virtual:root"
               ? 'export default import.meta.glob(["/src/dir/[ab].ts", "!./src/dir/a.ts"], { import: "name" });'
               : path === "virtual:base"
                 ? 'export default import.meta.glob("./[ab].ts", { base: "/src/dir", eager: true, import: "name" });'
                 : 'export default import.meta.glob("./src/dir/[ab].ts");',
           }));
         },
       });
       const { default: root } = await import("virtual:root");
       const { default: base } = await import("virtual:base");
       console.log(JSON.stringify([Object.keys(root), await root["/src/dir/b.ts"](), base]));
       console.log(await import("virtual:relative").catch(error => error.message));`,
    );
    expect({ stdout: stdout.split("\n"), stderr, exitCode }).toEqual({
      stdout: [
        `[["/src/dir/b.ts"],"b",{"./a.ts":"a","./b.ts":"b"}]`,
        `Expected a glob pattern in a module that is not a file to start with "/", but got "./src/dir/[ab].ts"`,
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([[[]], [["--isolate"]]])("eager entries are imported after hoisted mocks: bun test %j", async flags => {
    using dir = tempDir("import-meta-glob", {
      "dependency.ts": `export const dependency = "real";`,
      "modules/a.ts": `import { dependency } from "../dependency.ts"; export const a = "a " + dependency; export default a;`,
      "modules/b.ts": `import { dependency } from "../dependency.ts"; export const a = "b " + dependency; export default a;`,
      "glob.test.ts": `
        import { expect, test, vi } from "bun:test";
        const namespaces = import.meta.glob("./modules/*.ts", { eager: true });
        const named = import.meta.glob("./modules/*.ts", { eager: true, import: "a" });
        const lazy = import.meta.glob("./modules/*.ts", { import: "default" });
        vi.mock("./dependency.ts", () => ({ dependency: "mocked" }));
        test("glob", async () => {
          expect(namespaces["./modules/a.ts"].a).toBe("a mocked");
          expect(named).toEqual({ "./modules/a.ts": "a mocked", "./modules/b.ts": "b mocked" });
          expect(await lazy["./modules/b.ts"]()).toBe("b mocked");
        });`,
    });
    const { stderr, exitCode } = await run(String(dir), ["test", ...flags, "./glob.test.ts"]);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("3 expect() calls");
    expect(exitCode).toBe(0);
  });

  test("a module that calls it is not restored from the transpiler cache", async () => {
    const padding = Buffer.alloc(80 * 1024, "/").toString();
    using dir = tempDir("import-meta-glob", {
      "modules/a.ts": "",
      "glob.ts": `export default Object.keys(import.meta.glob("./modules/*.ts"));\n//${padding}`,
      "cached.ts": `export default "cached";\n//${padding}`,
      "entry.ts": `import keys from "./glob.ts"; import cached from "./cached.ts"; console.log(JSON.stringify(keys), cached);`,
    });
    const cache = join(String(dir), "cache");
    const env = { BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache, BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1" };
    expect(await run(String(dir), ["entry.ts"], env)).toEqual({
      stdout: `["./modules/a.ts"] cached\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(readdirSync(cache)).toHaveLength(1);
    writeFileSync(join(String(dir), "modules/b.ts"), "");
    expect(await run(String(dir), ["entry.ts"], env)).toEqual({
      stdout: `["./modules/a.ts","./modules/b.ts"] cached\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(readdirSync(cache)).toHaveLength(1);
  });
});

describe("errors", () => {
  // prettier-ignore
  const errors: [code: string, message: string, column: number][] = [
    ['import.meta.glob()', '"import.meta.glob" expects 1 or 2 arguments, but got 0', 16],
    ['import.meta.glob("./dir/*.ts", {}, 1)', '"import.meta.glob" expects 1 or 2 arguments, but got 3', 16],
    ['import.meta.glob(1)', 'Expected a glob pattern to be a string literal, but got number', 33],
    ['import.meta.glob(variable)', 'Expected a glob pattern to be a string literal, but got identifier', 33],
    ['import.meta.glob("./dir/" + variable)', 'Expected a glob pattern to be a string literal, but got binary', 33],
    ['import.meta.glob(`./dir/${variable}.ts`)', 'Expected a glob pattern to be a string literal, but got template', 33],
    ['import.meta.glob(["./dir/*.ts", 2])', 'Expected a glob pattern to be a string literal, but got number', 48],
    ['import.meta.glob(["./dir/*.ts", ...variable])', 'Expected a glob pattern to be a string literal, but got ...', 48],
    ['import.meta.glob("./dir/*.ts", 1)', 'Expected the options of "import.meta.glob" to be an object literal, but got number', 47],
    ['import.meta.glob("./dir/*.ts", null)', 'Expected the options of "import.meta.glob" to be an object literal, but got null', 47],
    ['import.meta.glob("./dir/*.ts", undefined)', 'Expected the options of "import.meta.glob" to be an object literal, but got undefined', 47],
    ['import.meta.glob("./dir/*.ts", variable)', 'Expected the options of "import.meta.glob" to be an object literal, but got identifier', 47],
    ['import.meta.glob("./dir/*.ts", { eager: variable })', 'Expected the "import.meta.glob" option "eager" to be a boolean literal, but got identifier', 56],
    ['import.meta.glob("./dir/*.ts", { eager: "yes" })', 'Expected the "import.meta.glob" option "eager" to be a boolean literal, but got string', 56],
    ['import.meta.glob("./dir/*.ts", { eager: undefined })', 'Expected the "import.meta.glob" option "eager" to be a boolean literal, but got undefined', 56],
    ['import.meta.glob("./dir/*.ts", { exhaustive: 1 })', 'Expected the "import.meta.glob" option "exhaustive" to be a boolean literal, but got number', 61],
    ['import.meta.glob("./dir/*.ts", { import: 1 })', 'Expected the "import.meta.glob" option "import" to be a string literal, but got number', 57],
    ['import.meta.glob("./dir/*.ts", { base: 1 })', 'Expected the "import.meta.glob" option "base" to be a string literal, but got number', 55],
    ['import.meta.glob("./dir/*.ts", { base: "dir" })', 'Expected the "import.meta.glob" option "base" to start with "/", "./" or "../", but got "dir"', 55],
    ['import.meta.glob("./dir/*.ts", { base: "!./dir" })', 'Expected the "import.meta.glob" option "base" to start with "/", "./" or "../", but got "!./dir"', 55],
    ['import.meta.glob("./dir/*.ts", { query: 1 })', 'Expected the "import.meta.glob" option "query" to be a string or an object literal, but got number', 56],
    ['import.meta.glob("./dir/*.ts", { query: { a: {} } })', 'Expected a value of the "import.meta.glob" option "query" to be a string, number or boolean literal, but got object', 61],
    ['import.meta.glob("./dir/*.ts", { query: { a: null } })', 'Expected a value of the "import.meta.glob" option "query" to be a string, number or boolean literal, but got null', 61],
    ['import.meta.glob("./dir/*.ts", { nope: 1 })', 'Unknown "import.meta.glob" option "nope"', 49],
    ['import.meta.glob("./dir/*.ts", { ...variable })', 'Expected the options of "import.meta.glob" to be plain properties', 52],
    ['import.meta.glob("./dir/*.ts", { [variable]: true })', 'Expected the name of an "import.meta.glob" option to be a literal, but got identifier', 50],
    ['import.meta.glob("./dir/*.ts", { get eager() { return true } })', 'Expected the options of "import.meta.glob" to be plain properties', 53],
    ['import.meta.glob("./dir/*.ts", { eager() {} })', 'Expected the "import.meta.glob" option "eager" to be a boolean literal, but got function', 54],
    ['import.meta.glob("./dir/*.ts", { as: "raw", query: "?x" })', 'The "import.meta.glob" options "as" and "query" cannot be used together', 47],
    ['import.meta.glob("./dir/*.ts", { as: "url", import: "setup" })', 'Expected the "import.meta.glob" option "import" to be "default" or "*" when "as" is "url", but got "setup"', 47],
    ['import.meta.glob("./dir/*.ts", { caseSensitive: false })', 'The "import.meta.glob" option "caseSensitive: false" is not supported', 64],
    ['import.meta.glob("dir/*.ts")', 'Expected a glob pattern to start with "/", "./", "../", "**" or a path alias, but got "dir/*.ts"', 33],
    ['import.meta.glob("")', 'Expected a glob pattern to start with "/", "./", "../", "**" or a path alias, but got ""', 33],
    ['import.meta.glob(".")', 'Expected a glob pattern to start with "/", "./", "../", "**" or a path alias, but got "."', 33],
    ['import.meta.glob(["./dir/*.ts", "!dir/a.ts"])', 'Expected a glob pattern to start with "/", "./", "../", "**" or a path alias, but got "dir/a.ts"', 48],
    ['import.meta.glob("./dir/*.ts", { query: { ...variable } })', 'Expected the options of "import.meta.glob" to be plain properties', 61],
    ['import.meta.glob("./dir/*.ts", { query: { a: variable } })', 'Expected a value of the "import.meta.glob" option "query" to be a string, number or boolean literal, but got identifier', 61],
    ['import.meta.glob("#nope/*.ts")', 'Expected a glob pattern to start with "/", "./", "../", "**" or a path alias, but got "#nope/*.ts"', 33],
    ['import.meta.glob("@/dir/*.ts")', 'Expected a glob pattern to start with "/", "./", "../", "**" or a path alias, but got "@/dir/*.ts"', 33],
  ];
  let actual: [message: string, line: number, column: number][];
  beforeAll(async () => {
    using dir = tempDir("import-meta-glob", {
      ...tree,
      ...Object.fromEntries(
        errors.map(([code], i) => [
          `proj/src/errors/${i}.ts`,
          `declare const variable: any;\nexport default ${code};\n`,
        ]),
      ),
      "proj/src/entry.ts": `
        const out = [];
        for (let i = 0; i < ${errors.length}; i++)
          out.push(await import("./errors/" + i + ".ts").then(
            () => ["no error"],
            error => [error.message, error.position?.line, error.position?.column]));
        console.log(JSON.stringify(out));`,
    });
    const { stdout, stderr, exitCode } = await run(join(String(dir), "proj"), ["src/entry.ts"]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    actual = JSON.parse(stdout);
  });
  test.each(errors.map(([code], i) => [code, i] as const))("%s", (_, i) => {
    expect(actual[i]).toEqual([errors[i][1], 2, errors[i][2]]);
  });
});
