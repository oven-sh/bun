import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const project = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
  }),
  "package.json": JSON.stringify({ name: "greeter", version: "1.0.0" }),
  "src/index.ts": `import { join } from "./join";
export interface Options {
  name: string;
  times: number;
}
export function greet(options: Options): string {
  return join("hello", options.name).repeat(options.times);
}
`,
  "src/join.ts": `export function join(first: string, second: string): string {
  return first + " " + second;
}
`,
};

describe.concurrent("bun build --dts", () => {
  test("writes the bundle, its declaration files and the bundle with its types kept", async () => {
    using dir = tempDir("build-dts", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "out")).sort()).toEqual([
      "index.aot.ts",
      "index.d.ts",
      "index.js",
      "join.d.ts",
    ]);
    const read = (name: string) => readFileSync(join(String(dir), "out", name), "utf8");
    expect(read("index.d.ts")).toContain("export declare function greet(options: Options): string;");
    expect(read("index.aot.ts")).toContain("function greet(options: Options): string {");
    expect(read("index.aot.ts")).toContain("function join(first: string, second: string): string {");
    expect(read("index.js")).toContain("function greet(options) {");
    expect(read("index.js")).not.toContain("debugId");
    expect(readFileSync(join(String(dir), "package.json"), "utf8")).toBe(project["package.json"]);
  });

  test.each([
    ["says nothing", undefined, true],
    ["says something else", { strict: true }, true],
    ["says the same", { strict: true, strictNullChecks: false, noUncheckedIndexedAccess: true }, false],
    ["says the same in other words", { strictNullChecks: false, noUncheckedIndexedAccess: true }, false],
  ])("sources that are not strict, and a package.json that %s", async (_, compilerOptions, warns) => {
    using dir = tempDir("build-dts-options", {
      ...project,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strictNullChecks: false, noUncheckedIndexedAccess: true, types: [] },
      }),
      "package.json": JSON.stringify({ name: "greeter", version: "1.0.0", compilerOptions }),
    });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect(built.exitCode).toBe(0);
    expect(built.stderr).toBe(
      warns
        ? `warn: package.json needs "compilerOptions": {"strict":true,"strictNullChecks":false,"noUncheckedIndexedAccess":true}: --aot type checks a package's .aot.ts files under them, and as strict without them\n`
        : "",
    );
    expect(readdirSync(join(String(dir), "out"))).toContain("index.aot.ts");
  });

  test("a type error fails the build", async () => {
    using dir = tempDir("build-dts-error", {
      ...project,
      "src/join.ts": project["src/join.ts"].replace("): string", "): number"),
    });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect(built.stderr).toContain("TS2322");
    expect(built.exitCode).toBe(1);
  });

  test("needs --outdir", async () => {
    using dir = tempDir("build-dts-outdir", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--dts");
    expect(built.stderr).toContain("--dts requires --outdir, and cannot be used with --compile");
    expect(built.exitCode).toBe(1);
  });

  test("--minify: the declaration files, and a warning about the rest", async () => {
    using dir = tempDir("build-dts-minify", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts", "--minify");
    expect(built.stderr).toBe(
      "warn: the .aot.ts files that --aot compiles a package from are left out: they do not support --minify-identifiers yet\n",
    );
    expect(built.exitCode).toBe(0);
    expect(readdirSync(join(String(dir), "out")).sort()).toEqual(["index.d.ts", "index.js", "join.d.ts"]);
  });

  test("--minify-syntax --minify-whitespace: every file", async () => {
    using dir = tempDir("build-dts-minify-syntax", project);
    const flags = ["--dts", "--minify-syntax", "--minify-whitespace"];
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).toContain(
      "function greet(options: Options): string{return join(",
    );
  });

  test("a statement that never runs is left out", async () => {
    using dir = tempDir("build-dts-dead", {
      ...project,
      "src/join.ts": `declare const __DEV__: boolean;
export function join(first: string, second: string): string {
  if (__DEV__ && first.length === 0) throw new Error("empty");
  return first + " " + second;
}
`,
    });
    const flags = ["--dts", "--define", "__DEV__=false"];
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", ...flags);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "out/index.js"), "utf8")).toContain(
      'function join(first, second) {\n  return first + " " + second;\n}',
    );
    expect(readFileSync(join(String(dir), "out/index.aot.ts"), "utf8")).not.toContain("__DEV__");
  });

  test("a build without it writes what it always did", async () => {
    using dir = tempDir("build-without-dts", project);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "out"))).toEqual(["index.js"]);
  });
});

// With the libraries of "es5" alone, a build spends its time on the sources.
const tsconfigWith = (options: Record<string, unknown> = {}) =>
  JSON.stringify({
    compilerOptions: { ...JSON.parse(project["tsconfig.json"]).compilerOptions, lib: ["es5"], ...options },
  });

const withJson = {
  "tsconfig.json": tsconfigWith(),
  "package.json": JSON.stringify({
    name: "greeter",
    version: "1.0.0",
    compilerOptions: { strict: true, lib: ["es5"] },
  }),
  "src/data.json": `{ "name": "x", "size": 3 }\n`,
  "src/index.ts": `import data from "./data.json";
export function get(): typeof data {
  return data;
}
`,
};
const DATA = `declare const _exports: {
    name: string;
    size: number;
};
export = _exports;
`;

const filesIn = (folder: string) =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry =>
      join(entry.parentPath, entry.name)
        .slice(folder.length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();

/** The text of each declaration file under `folder`, by path. */
const declarationsIn = (folder: string) =>
  Object.fromEntries(
    filesIn(folder)
      .filter(path => /\.d\.[cm]?ts$/.test(path))
      .map(path => [path, readFileSync(join(folder, path), "utf8")]),
  );

// A declaration file does not depend on the .aot.ts files. A build that leaves those out type checks once, not twice.
const withoutTypedFiles = (cwd: string) =>
  bun(cwd, "build", "./src/index.ts", "--outdir", "out", "--dts", "--sourcemap=inline");
const NO_TYPED_FILES =
  "warn: the .aot.ts files that --aot compiles a package from are left out: they do not support --sourcemap=inline yet\n";

// The bundle holds the value of a JSON file, so the output has no file that an import of it could name.
//
// Not concurrent: a build type checks on every core, and the builds above already run at the same time.
describe("bun build --dts: a JSON file that a declaration file names", () => {
  test("gets a declaration file, and the import names it", async () => {
    using dir = tempDir("build-dts-json", withJson);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const out = join(String(dir), "out");
    expect(filesIn(out)).toEqual(["data.json.d.cts", "index.aot.ts", "index.d.ts", "index.js"]);
    expect(declarationsIn(out)).toEqual({
      "data.json.d.cts": DATA,
      "index.d.ts": `import data from "./data.json.cjs";\nexport declare function get(): typeof data;\n`,
    });
  });

  test("every kind of import and export, and a value that is not an object", async () => {
    using dir = tempDir("build-dts-json-forms", {
      ...withJson,
      // `import = require()` is an error with "module": "esnext".
      "tsconfig.json": tsconfigWith({ module: "preserve" }),
      "src/list.json": `[{ "a": 1 }, { "b": "x" }]\n`,
      "src/text.json": `"hello"\n`,
      "src/imports.ts": `import { name } from "./data.json";
import * as all from "./data.json";
import required = require("./data.json");
import withAttribute from "./data.json" with { type: "json" };
import type typeOnly from "./data.json";
import list from "./list.json";
import text from "./text.json";
export function getName(): typeof name {
  return name;
}
export function getAll(): typeof all {
  return all;
}
export function getRequired(): typeof required {
  return required;
}
export function getWithAttribute(): typeof withAttribute {
  return withAttribute;
}
export declare function getTypeOnly(): typeof typeOnly;
export function getList(): typeof list {
  return list;
}
export function getText(): typeof text {
  return text;
}
`,
      "src/exports.ts": `import data from "./data.json";
export { default as fromData, size } from "./data.json";
export { data as whole };
export default data;
export type Data = typeof import("./data.json");
`,
      "src/folder/above.ts": `import data from "../data.json";
export function getAbove(): typeof data {
  return data;
}
`,
      "src/index.ts": `export * from "./imports";\nexport * from "./exports";\nexport * from "./folder/above";\n`,
    });
    const built = await withoutTypedFiles(String(dir));
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: NO_TYPED_FILES, exitCode: 0 });
    expect(declarationsIn(join(String(dir), "out"))).toEqual({
      "imports.d.ts": `import { name } from "./data.json.cjs";
import * as all from "./data.json.cjs";
import required = require("./data.json.cjs");
import withAttribute from "./data.json.cjs";
import type typeOnly from "./data.json.cjs";
import list from "./list.json.cjs";
import text from "./text.json.cjs";
export declare function getName(): typeof name;
export declare function getAll(): typeof all;
export declare function getRequired(): typeof required;
export declare function getWithAttribute(): typeof withAttribute;
export declare function getTypeOnly(): typeof typeOnly;
export declare function getList(): typeof list;
export declare function getText(): typeof text;
`,
      "exports.d.ts": `import data from "./data.json.cjs";
export { default as fromData, size } from "./data.json.cjs";
export { data as whole };
export default data;
export type Data = typeof import("./data.json.cjs");
`,
      "folder/above.d.ts": `import data from "../data.json.cjs";\nexport declare function getAbove(): typeof data;\n`,
      "index.d.ts": `export * from "./imports.js";\nexport * from "./exports.js";\nexport * from "./folder/above.js";\n`,
      "data.json.d.cts": DATA,
      "list.json.d.cts": `declare const _exports: ({
    a: number;
    b?: undefined;
} | {
    a?: undefined;
    b: string;
})[];
export = _exports;
`,
      "text.json.d.cts": `declare const _exports: string;\nexport = _exports;\n`,
    });
  });

  test("has the type that the file that names it was checked with, and the same text from every file", async () => {
    using dir = tempDir("build-dts-json-importer", {
      ...withJson,
      "tsconfig.json": tsconfigWith({ stripInternal: true }),
      // Not the options that index.ts is checked with.
      "src/loose/tsconfig.json": JSON.stringify({ compilerOptions: { strict: false } }),
      "src/loose/data.json": `{ "name": null, "list": [] }\n`,
      "src/hidden.ts": `/** @internal */
export interface Hidden {
  take(data: typeof import("./data.json")): void;
}
/** @internal */
export const hidden: Hidden = { take() {} };
`,
      // A checker that has the keys of first.json when it comes to second.json puts "b" before "a". The checker of
      // index.ts is one, and so is the checker of reads-both.ts, whose types the other checkers can find.
      "src/order/first.json": `[{ "b": 1 }, { "a": "x" }]\n`,
      "src/order/second.json": `[{ "a": 1 }, { "b": "x" }]\n`,
      "src/reads-both.ts": `import first from "./order/first.json";
import second from "./order/second.json";
export const bothKeys: number = first.length + second.length;
`,
      // The first row has no "meta": its type is undefined there, not the {} that the second row has.
      "src/rows.json": `[{ "id": 1 }, { "id": 2, "meta": {} }]\n`,
      // It does not import data.json, and its declaration file names it.
      "src/index.ts": `import loose from "./loose/data.json";
import first from "./order/first.json";
import second from "./order/second.json";
import rows from "./rows.json";
import { hidden } from "./hidden";
export function get(): typeof loose {
  return loose;
}
export const inferred = loose;
export const take = hidden.take;
export const keys = first.length;
export function getSecond(): typeof second {
  return second;
}
export function getRows(): typeof rows {
  return rows;
}
export * from "./reads-both";
`,
    });
    const built = await withoutTypedFiles(String(dir));
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: NO_TYPED_FILES, exitCode: 0 });
    expect(declarationsIn(join(String(dir), "out"))).toEqual({
      "data.json.d.cts": DATA,
      "hidden.d.ts": `export {};\n`,
      "index.d.ts": `import loose from "./loose/data.json.cjs";
import second from "./order/second.json.cjs";
import rows from "./rows.json.cjs";
export declare function get(): typeof loose;
export declare const inferred: {
    name: null;
    list: never[];
};
export declare const take: (data: typeof import("./data.json.cjs")) => void;
export declare const keys: number;
export declare function getSecond(): typeof second;
export declare function getRows(): typeof rows;
export * from "./reads-both.js";
`,
      "reads-both.d.ts": `export declare const bothKeys: number;\n`,
      "loose/data.json.d.cts": `declare const _exports: {
    name: null;
    list: never[];
};
export = _exports;
`,
      "order/second.json.d.cts": `declare const _exports: ({
    a: number;
    b?: undefined;
} | {
    a?: undefined;
    b: string;
})[];
export = _exports;
`,
      "rows.json.d.cts": `declare const _exports: ({
    id: number;
    meta?: undefined;
} | {
    id: number;
    meta: {};
})[];
export = _exports;
`,
    });
  });

  test("has the type that an import of the JSON file has", async () => {
    // An empty object or array beside other values, null, and keys that are not names.
    const values = [
      {},
      [],
      "text",
      3,
      true,
      null,
      [{ id: 1 }, { id: 2, meta: { tag: "new" } }, { id: 3, meta: {} }],
      [{ kind: "a", options: { retries: 3 } }, { kind: "b" }, { kind: "c", options: {} }],
      { plugins: [{ name: "a" }, { name: "b", options: {} }], rules: [{ id: 1 }, { id: 2, options: "strict" }] },
      { "config": { plugins: [] }, "x-y": [null, [], [[]]], "1": [1, "a", null], "default": { a: [] } },
      [[1, "a"], [], [{ b: null }]],
    ];
    const json = values.map((value, at) => [`src/d${at}.json`, JSON.stringify(value)]);
    const source = (at: number) =>
      `import d${at} from "./d${at}.json";\nexport const get${at} = (): typeof d${at} => d${at};\n`;
    const same = (at: number) =>
      `export const same${at}: Same<typeof import("../src/d${at}.json"), typeof import("../out/d${at}.json.cjs")> = true;\n`;
    using dir = tempDir("build-dts-json-same", {
      ...withJson,
      ...Object.fromEntries(json),
      "src/index.ts": values.map((_, at) => source(at)).join(""),
      "same/tsconfig.json": tsconfigWith({ noEmit: true }),
      // True only if the two types are identical.
      "same/same.ts":
        `type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;\n` +
        values.map((_, at) => same(at)).join(""),
    });
    const built = await withoutTypedFiles(String(dir));
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: NO_TYPED_FILES, exitCode: 0 });
    const checked = await bun(join(String(dir), "same"), "check");
    expect({ errors: (checked.stdout + checked.stderr).match(/TS\d+.*/g), exitCode: checked.exitCode }).toEqual({
      errors: null,
      exitCode: 0,
    });
  });

  // A program for each entry point. In each one, reads-both.ts has the keys of first.json when it comes to second.json.
  const twoProjects = (options: Record<string, unknown>, second: string) => {
    const project = (name: string, options: Record<string, unknown>) => ({
      [`${name}/tsconfig.json`]: tsconfigWith(options),
      [`${name}/reads-both.ts`]: `import first from "../shared/first.json";
import second from "../shared/second.json";
export const keys_${name}: number = first.length + second.length;
`,
      [`${name}/index.ts`]: `import second from "../shared/second.json";
export function get_${name}(): typeof second {
  return second;
}
export * from "./reads-both";
`,
    });
    return {
      "package.json": withJson["package.json"],
      "shared/first.json": `[{ "b": 1 }, { "a": "x" }]\n`,
      "shared/second.json": second,
      ...project("one", {}),
      ...project("two", options),
    };
  };
  const buildTwoProjects = (cwd: string) =>
    bun(cwd, "build", "./one/index.ts", "./two/index.ts", "--outdir", "out", "--dts", "--sourcemap=inline");

  test("two entry points with a tsconfig.json each: one declaration file for the type that both give it", async () => {
    using dir = tempDir("build-dts-json-programs", twoProjects({}, `[{ "a": 1 }, { "b": "x" }]\n`));
    const built = await buildTwoProjects(String(dir));
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: NO_TYPED_FILES, exitCode: 0 });
    const index = (name: string) =>
      `import second from "../shared/second.json.cjs";\nexport declare function get_${name}(): typeof second;\nexport * from "./reads-both.js";\n`;
    expect(declarationsIn(join(String(dir), "out"))).toEqual({
      "one/index.d.ts": index("one"),
      "one/reads-both.d.ts": `export declare const keys_one: number;\n`,
      "two/index.d.ts": index("two"),
      "two/reads-both.d.ts": `export declare const keys_two: number;\n`,
      "shared/second.json.d.cts": `declare const _exports: ({
    a: number;
    b?: undefined;
} | {
    a?: undefined;
    b: string;
})[];
export = _exports;
`,
    });
  });

  test("two entry points with a tsconfig.json each: an error if they give it two types", async () => {
    // null is any without strictNullChecks.
    using dir = tempDir("build-dts-json-two-types", twoProjects({ strict: false }, `[{ "name": null }]\n`));
    const built = await buildTwoProjects(String(dir));
    const inDir = (path: string) => join(String(dir), path);
    expect(built.stderr).toBe(
      `error: cannot write a declaration file for ${inDir("shared/second.json")} because it has one type under ${inDir("one/tsconfig.json")} and another under ${inDir("two/tsconfig.json")}. The declaration file of ${inDir("one/index.ts")} imports it. Give the exports of that file types that do not refer to the JSON file\n`,
    );
    expect(built.exitCode).toBe(1);
  });

  test("with isolatedDeclarations, which asks nothing of a JSON file", async () => {
    using dir = tempDir("build-dts-json-isolated", {
      ...withJson,
      "tsconfig.json": tsconfigWith({ declaration: true, isolatedDeclarations: true }),
      "src/data.json": `[1, 2, 3]\n`,
    });
    const built = await withoutTypedFiles(String(dir));
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: NO_TYPED_FILES, exitCode: 0 });
    expect(declarationsIn(join(String(dir), "out"))["data.json.d.cts"]).toBe(
      `declare const _exports: number[];\nexport = _exports;\n`,
    );
  });

  test("--no-bundle: the JavaScript imports the JSON file, and so does the declaration file", async () => {
    using dir = tempDir("build-dts-json-no-bundle", withJson);
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts", "--no-bundle");
    expect(built.stderr).toBe(
      "warn: the .aot.ts files that --aot compiles a package from are left out: they do not support --no-bundle yet\n",
    );
    expect(built.exitCode).toBe(0);
    const out = join(String(dir), "out");
    expect(filesIn(out)).toEqual(["index.d.ts", "index.js"]);
    expect(readFileSync(join(out, "index.js"), "utf8")).toContain(`import data from "./data.json";`);
    expect(readFileSync(join(out, "index.d.ts"), "utf8")).toBe(
      `import data from "./data.json";\nexport declare function get(): typeof data;\n`,
    );
  });

  test("a type that is too long to write fails the build", async () => {
    // Each object of an array gets every key of the others as an optional one: 20 x 20 keys of 4,000 characters.
    const key = Buffer.alloc(4000, "k").toString();
    const rows = Array.from({ length: 20 }, (_, row) => ({ [key + row]: row }));
    using dir = tempDir("build-dts-json-long", { ...withJson, "src/data.json": JSON.stringify(rows) });
    const built = await bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts");
    expect(built.stderr).toBe(
      `error: cannot write a declaration file for ${join(String(dir), "src/data.json")} because its type is too long to write (TS7056). The declaration file of ${join(String(dir), "src/index.ts")} imports it. Give the exports of that file types that do not refer to the JSON file\n`,
    );
    expect(built.exitCode).toBe(1);
  });

  // What the output cannot hold, or what is not the type of the JSON value, is left as the sources have it.
  test("an import is left alone where only code reads the file, it is not below the root directory, or the sources declare it or take its place", async () => {
    using dir = tempDir("build-dts-json-kept", {
      // The alias makes declared.json a file of the program. "./declared.json" is declared.d.json.ts all the same.
      "tsconfig.json": tsconfigWith({
        allowArbitraryExtensions: true,
        paths: { "@json/*": ["./src/*.json"] },
        stripInternal: true,
      }),
      "package.json": withJson["package.json"],
      "src/data.json": withJson["src/data.json"],
      "src/only-code-reads-it.ts": `import data from "./data.json";
/** Reads "./data.json". */
export const size: number = data.size;
export type Path = "./data.json";
`,
      "src/outside-the-root-directory.ts": `import manifest from "../package.json";
export function version(): typeof manifest.version {
  return manifest.version;
}
`,
      "src/node_modules/dep/data.json": withJson["src/data.json"],
      "src/in-node-modules.ts": `import data from "./node_modules/dep/data.json";
export function installed(): typeof data {
  return data;
}
`,
      "src/declared.json": withJson["src/data.json"],
      "src/declared.d.json.ts": `declare const data: { readonly name: string };\nexport default data;\n`,
      "src/declared-by-hand.ts": `import data from "./declared.json";
import raw from "@json/declared";
export function declared(): typeof data {
  return data;
}
export const inferred = data;
export const rawSize: number = raw.size;
`,
      // Its declaration file names declared.json itself, which gets a declaration file. declared-by-hand.d.ts keeps
      // its import all the same.
      "src/hidden.ts": `/** @internal */
export interface Hidden {
  take(data: typeof import("@json/declared")): void;
}
/** @internal */
export const hidden: Hidden = { take() {} };
`,
      "src/names-the-file-itself.ts": `import { hidden } from "./hidden";\nexport const take = hidden.take;\n`,
      // The declaration file of taken.json.cts is where the one of taken.json would be.
      "src/taken.json": withJson["src/data.json"],
      "src/taken.json.cts": `export const fromSource: number = 1;\n`,
      "src/name-is-taken.ts": `import data from "./taken.json";
export function taken(): typeof data {
  return data;
}
export { fromSource } from "./taken.json.cjs";
`,
      "src/index.ts": `export * from "./only-code-reads-it";
export * from "./outside-the-root-directory";
export * from "./in-node-modules";
export * from "./declared-by-hand";
export * from "./names-the-file-itself";
export * from "./name-is-taken";
`,
    });
    const built = await withoutTypedFiles(String(dir));
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: NO_TYPED_FILES, exitCode: 0 });
    expect(declarationsIn(join(String(dir), "out"))).toEqual({
      "only-code-reads-it.d.ts": `/** Reads "./data.json". */\nexport declare const size: number;\nexport type Path = "./data.json";\n`,
      "outside-the-root-directory.d.ts": `import manifest from "../package.json";\nexport declare function version(): typeof manifest.version;\n`,
      "in-node-modules.d.ts": `import data from "./node_modules/dep/data.json";\nexport declare function installed(): typeof data;\n`,
      "declared-by-hand.d.ts": `import data from "./declared.json";
export declare function declared(): typeof data;
export declare const inferred: {
    readonly name: string;
};
export declare const rawSize: number;
`,
      "hidden.d.ts": `export {};\n`,
      "names-the-file-itself.d.ts": `export declare const take: (data: typeof import("./declared.json.cjs")) => void;\n`,
      "declared.json.d.cts": DATA,
      "name-is-taken.d.ts": `import data from "./taken.json.cjs";
export declare function taken(): typeof data;
export { fromSource } from "./taken.json.cjs";
`,
      "taken.json.d.cts": `export declare const fromSource: number;\n`,
      "index.d.ts": `export * from "./only-code-reads-it.js";
export * from "./outside-the-root-directory.js";
export * from "./in-node-modules.js";
export * from "./declared-by-hand.js";
export * from "./names-the-file-itself.js";
export * from "./name-is-taken.js";
`,
    });
  });
});
