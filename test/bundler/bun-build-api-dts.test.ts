import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

const project = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
  }),
  "src/index.ts": `import { join } from "./join";
export interface Options {
  name: string;
  times: number;
}
export function greet(options: Options): string {
  return join("hello", options.name).repeat(options.times);
}
export { join };
`,
  "src/join.ts": `export function join(first: string, second: string): string {
  return first + " " + second;
}
`,
};

// Two entry points, each with a module `util.ts` beside it. The one in `sub` also takes the `util.ts` above it.
const nested = {
  "index.ts": `export { util } from "./util";\n`,
  "util.ts": `export interface Options {
  n: number;
}
export function util(options: Options): string {
  return String(options.n);
}
`,
  "sub/index.ts": `export { util } from "../util";
export { util as subUtil } from "./util";
`,
  "sub/util.ts": `export interface Flagged {
  n: string;
}
export function util(options: Flagged): string {
  return options.n;
}
`,
};
// `sub/index.aot.ts`. The comment above each module is its path from the working directory.
const NESTED_TYPED = `// util.ts
interface Options {
  n: number;
}
function util(options: Options): string {
  return String(options.n);
}
// sub/util.ts
interface Flagged {
  n: string;
}
function util2(options: Flagged): string {
  return options.n;
}
export {
  util2 as subUtil,
  util
};
`;
const withoutModulePaths = (typed: string) => typed.replace(/^\/\/ .*\n/gm, "");
const LEFT_OUT_FOR_ITS_TEXT =
  /^the \.aot\.ts files that --aot compiles a package from are left out: index\.js: the text of .*index\.ts in the source map is not the text that was type checked$/;

// The module `virtual:<path>` is <path> in `namespace`. `contents` is its text.
const virtual = (namespace: string, contents: string): Bun.BunPlugin => ({
  name: "virtual",
  setup(build) {
    build.onResolve({ filter: /^virtual:/ }, ({ path }) => ({ path: path.slice("virtual:".length), namespace }));
    build.onLoad({ filter: /.*/, namespace }, () => ({ contents, loader: "ts" }));
  },
});
// A project whose `index.ts` calls `twice` of the plugin's `virtual:thing.ts` and `twice` of the file `fileOfThatName`.
const withVirtualModule = (fileOfThatName: string) => ({
  "tsconfig.json": JSON.stringify({ ...JSON.parse(project["tsconfig.json"]), include: ["index.ts", "virtual.d.ts"] }),
  "virtual.d.ts": `declare module "virtual:thing.ts" {
  export function twice(n: number): number;
}
`,
  [fileOfThatName + ".ts"]: `export function twice(text: string): string {
  return text + text;
}
`,
  "index.ts": `import { twice as twiceText } from "./${fileOfThatName}";
import { twice } from "virtual:thing.ts";
export function run(n: number): string {
  return twiceText(String(twice(n)));
}
`,
});
const TWICE = `export interface Doubled {
  n: number;
}
export function twice(n: number): number {
  const doubled: Doubled = { n: n * 2 };
  return doubled.n;
}
`;
// `index.aot.ts` of that project, without the comment that names each module.
const WITH_VIRTUAL_MODULE_TYPED = `function twice(text: string): string {
  return text + text;
}

interface Doubled {
  n: number;
}
function twice2(n: number): number {
  const doubled: Doubled = { n: n * 2 };
  return doubled.n;
}

function run(n: number): string {
  return twice(String(twice2(n)));
}
export {
  run
};
`;

const WRITTEN = ["index.aot.ts", "index.d.ts", "index.js", "join.d.ts"];
const filesIn = (folder: string) => readdirSync(folder, { recursive: true }).map(String).sort();
const described = (root: string, outputs: Bun.BuildArtifact[]) =>
  outputs
    .map(({ path, kind, loader }) => [path.replace(root, "").replaceAll("\\", "/").replace(/^\.\//, ""), kind, loader])
    .sort();

describe("Bun.build({ dts: true })", () => {
  test("writes the bundle, its declaration files and the bundle with its types kept to outdir", async () => {
    using dir = tempDir("build-api-dts", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(filesIn(join(root, "out"))).toEqual(WRITTEN);
    expect(described(root, built.outputs)).toEqual([
      ["/out/index.aot.ts", "asset", "ts"],
      ["/out/index.d.ts", "asset", "ts"],
      ["/out/index.js", "entry-point", "ts"],
      ["/out/join.d.ts", "asset", "ts"],
    ]);
    for (const output of built.outputs) expect(await output.text()).toBe(readFileSync(output.path, "utf8"));
    const read = (name: string) => readFileSync(join(root, "out", name), "utf8");
    expect(read("index.d.ts")).toBe(`import { join } from "./join.js";
export interface Options {
    name: string;
    times: number;
}
export declare function greet(options: Options): string;
export { join };
`);
    expect(read("index.aot.ts")).toContain("function greet(options: Options): string {");
    expect(read("index.aot.ts")).toContain("function join(first: string, second: string): string {");
    expect(read("index.js")).toContain("function greet(options) {");
    expect(read("index.js")).not.toContain("debugId");
    const plain = await Bun.build({ entrypoints: [join(root, "src/index.ts")], tsconfig: join(root, "tsconfig.json") });
    expect(read("index.js")).toBe(await plain.outputs[0].text());
  });

  test("without outdir, the files are in outputs and nothing is written", async () => {
    using dir = tempDir("build-api-dts-memory", project);
    const root = String(dir);
    const before = filesIn(root);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(described(root, built.outputs)).toEqual([
      ["index.aot.ts", "asset", "ts"],
      ["index.d.ts", "asset", "ts"],
      ["index.js", "entry-point", "ts"],
      ["join.d.ts", "asset", "ts"],
    ]);
    const typed = built.outputs.find(output => output.path.endsWith("index.aot.ts"))!;
    expect(await typed.text()).toContain("function greet(options: Options): string {");
    expect(filesIn(root)).toEqual(before);
  });

  test("a source map that was asked for is kept", async () => {
    using dir = tempDir("build-api-dts-sourcemap", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      sourcemap: "external",
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(filesIn(join(root, "out"))).toEqual([...WRITTEN, "index.js.map"].sort());
  });

  test("a type error fails the build", async () => {
    using dir = tempDir("build-api-dts-error", {
      ...project,
      "src/join.ts": project["src/join.ts"].replace("): string", "): number"),
    });
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
      throw: false,
    });
    expect(built.success).toBe(false);
    expect(built.logs.map(log => log.message).join("\n")).toContain("TS2322");
    expect(filesIn(root)).not.toContain("out");
  });

  test("minify: the declaration files, and a warning about the rest", async () => {
    using dir = tempDir("build-api-dts-minify", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      minify: true,
      dts: true,
    });
    expect(built.logs.map(log => [log.level, log.message])).toEqual([
      [
        "warn",
        "the .aot.ts files that --aot compiles a package from are left out: they do not support minify.identifiers yet",
      ],
    ]);
    expect(filesIn(join(root, "out"))).toEqual(["index.d.ts", "index.js", "join.d.ts"]);
  });

  test("minify.syntax and minify.whitespace: every file", async () => {
    using dir = tempDir("build-api-dts-minify-syntax", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      minify: { syntax: true, whitespace: true },
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(filesIn(join(root, "out"))).toContain("index.aot.ts");
  });

  test("two builds at once keep their files apart", async () => {
    using dir = tempDir("build-api-dts-twice", {
      ...Object.fromEntries(Object.entries(project).map(([path, text]) => ["a/" + path, text])),
      "b/tsconfig.json": project["tsconfig.json"],
      "b/src/index.ts": `export const other: number = 1;\n`,
    });
    const root = String(dir);
    const build = (name: string) =>
      Bun.build({
        entrypoints: [join(root, name, "src/index.ts")],
        outdir: join(root, name, "out"),
        tsconfig: join(root, name, "tsconfig.json"),
        dts: true,
      });
    const [a, b] = await Promise.all([build("a"), build("b")]);
    expect([a.logs, b.logs]).toEqual([[], []]);
    expect(filesIn(join(root, "a/out"))).toEqual(WRITTEN);
    expect(filesIn(join(root, "b/out"))).toEqual(WRITTEN.filter(path => path !== "join.d.ts"));
    expect(readFileSync(join(root, "b/out/index.d.ts"), "utf8")).toBe("export declare const other: number;\n");
  });

  test("cannot be used with compile", () => {
    expect(() => Bun.build({ entrypoints: ["./index.ts"], compile: true, dts: true })).toThrow(
      "dts cannot be used with compile",
    );
  });

  test("with an outdir that holds the sources, a chunk in a directory has the types of its own modules", async () => {
    using dir = tempDir("build-api-dts-nested-outdir", {
      "tsconfig.json": project["tsconfig.json"],
      ...Object.fromEntries(Object.entries(nested).map(([path, text]) => ["src/" + path, text])),
    });
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts"), join(root, "src/sub/index.ts")],
      outdir: join(root, "src"),
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(withoutModulePaths(readFileSync(join(root, "src/sub/index.aot.ts"), "utf8"))).toBe(
      withoutModulePaths(NESTED_TYPED),
    );
  });

  // `defaults` has no written type: its type is from the declaration file of `util.ts`, which a second pass reads.
  // On Windows that pass does not see the declaration files that the build holds in memory.
  test.skipIf(isWindows)("a value of a module above the chunk has the type that was inferred for it", async () => {
    using dir = tempDir("build-api-dts-nested-inferred", {
      "tsconfig.json": project["tsconfig.json"],
      "src/index.ts": nested["index.ts"],
      "src/util.ts": nested["util.ts"] + `export const defaults = { n: 1 };\n`,
      "src/sub/util.ts": nested["sub/util.ts"],
      "src/sub/index.ts": `import type { defaults } from "../util";
import { util } from "../util";
import { util as subUtil } from "./util";
export function both(options: typeof defaults): string {
  return util(options) + subUtil({ n: "" });
}
`,
    });
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts"), join(root, "src/sub/index.ts")],
      outdir: join(root, "src"),
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(withoutModulePaths(readFileSync(join(root, "src/sub/index.aot.ts"), "utf8"))).toBe(`interface Options {
  n: number;
}
declare const defaults: {
    n: number;
};
function util(options: Options): string {
  return String(options.n);
}

interface Flagged {
  n: string;
}
function util2(options: Flagged): string {
  return options.n;
}

function both(options: typeof defaults): string {
  return util(options) + util2({ n: "" });
}
export {
  both
};
`);
  });

  // In `sources` the plugin's module is named `<namespace>:<path>`. Here that is the path of the file `v:thing.ts`.
  // Windows has no file of that name: `:` is not allowed in one.
  test.skipIf(isWindows)(
    "a module that a plugin makes is not the file that has its name in the source map",
    async () => {
      using dir = tempDir("build-api-dts-plugin-namespace", withVirtualModule("v:thing"));
      const root = String(dir);
      const built = await Bun.build({
        entrypoints: [join(root, "index.ts")],
        tsconfig: join(root, "tsconfig.json"),
        dts: true,
        plugins: [virtual(join(root, "v"), TWICE)],
      });
      expect(built.logs).toEqual([]);
      const typed = built.outputs.find(output => output.path.endsWith("index.aot.ts"))!;
      expect(withoutModulePaths(await typed.text())).toBe(WITH_VIRTUAL_MODULE_TYPED);
    },
  );

  // The type checker reads a value of `files` without its byte order mark. What it notes of a module are offsets in that text.
  test("a module whose text in the bundle is not the text that was type checked leaves the typed files out", async () => {
    using dir = tempDir("build-api-dts-byte-order-mark", { "tsconfig.json": project["tsconfig.json"] });
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "index.ts")],
      files: { [join(root, "index.ts")]: "\uFEFF" + nested["util.ts"] },
      root,
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(built.logs.map(log => log.message)).toEqual([expect.stringMatching(LEFT_OUT_FOR_ITS_TEXT)]);
    expect(described(root, built.outputs)).toEqual([
      ["index.d.ts", "asset", "ts"],
      ["index.js", "entry-point", "ts"],
    ]);
  });
});

// Each build runs in a process of its own. Without outdir, the paths of a build are relative to the working directory
// of the process. A build that stops its process fails one test.
describe("Bun.build({ dts: true }) in a process of its own", () => {
  // Prints the logs of the build and the typed file at `typedPath`.
  async function build(cwd: string, options: string, typedPath = "index.aot.ts") {
    const script = `
      const built = await Bun.build({ dts: true, ${options} });
      const typed = built.outputs.find(output => output.path.endsWith(${JSON.stringify(typedPath)}));
      console.log(JSON.stringify({ logs: built.logs.map(log => log.message), typed: typed ? await typed.text() : null }));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const entryPoints = `entrypoints: ["./index.ts", "./sub/index.ts"]`;
  const tsconfig = project["tsconfig.json"];

  test("without outdir, a chunk in a directory has the types of its own modules", async () => {
    using dir = tempDir("build-api-dts-nested", { "tsconfig.json": tsconfig, ...nested });
    const { stdout, stderr, exitCode } = await build(String(dir), entryPoints, "sub/index.aot.ts");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ logs: [], typed: NESTED_TYPED });
    expect(exitCode).toBe(0);
  });

  // The `sources` of the chunk's source map are paths from `/`, where no source is.
  test("without outdir, from the root of the file system", async () => {
    using dir = tempDir("build-api-dts-nested-root", { "tsconfig.json": tsconfig, ...nested });
    const path = (name: string) => JSON.stringify(join(String(dir), name));
    const options = `entrypoints: [${path("index.ts")}, ${path("sub/index.ts")}], tsconfig: ${path("tsconfig.json")}`;
    const { stdout, stderr, exitCode } = await build("/", options, "sub/index.aot.ts");
    expect(stderr).toBe("");
    const { logs, typed } = JSON.parse(stdout);
    expect({ logs, typed: withoutModulePaths(typed) }).toEqual({ logs: [], typed: withoutModulePaths(NESTED_TYPED) });
    expect(exitCode).toBe(0);
  });

  // `sub/index.ts` names `ReadonlyArray` at an offset past the end of the `index.ts` above it.
  test("without outdir, an entry point in a directory imports the entry point above it", async () => {
    using dir = tempDir("build-api-dts-nested-entry", {
      "tsconfig.json": tsconfig,
      "index.ts": `export const VERSION = "1.0.0";\n`,
      "sub/index.ts": `import { VERSION } from "../index";
export interface Report {
  version: string;
  lines: ReadonlyArray<string>;
}
export function report(lines: ReadonlyArray<string>): Report {
  const version: string = VERSION;
  return { version, lines };
}
`,
    });
    const { stdout, stderr, exitCode } = await build(String(dir), entryPoints, "sub/index.aot.ts");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      logs: [],
      typed: `// index.ts
export type { Report };
const VERSION = "1.0.0";

// sub/index.ts
interface Report {
  version: string;
  lines: ReadonlyArray<string>;
}
function report(lines: ReadonlyArray<string>): Report {
  const version: string = VERSION;
  return { version, lines };
}
export {
  report
};
`,
    });
    expect(exitCode).toBe(0);
  });

  // The plugin's module is `thing.ts` in the namespace `virtual`. From the working directory, `thing.ts` is a file.
  test("a module that a plugin makes in a namespace of its own is not the file of its name", async () => {
    using dir = tempDir("build-api-dts-plugin", withVirtualModule("thing"));
    const plugin = `(${virtual})("virtual", ${JSON.stringify(TWICE)})`;
    const { stdout, stderr, exitCode } = await build(String(dir), `entrypoints: ["./index.ts"], plugins: [${plugin}]`);
    expect(stderr).toBe("");
    const { logs, typed } = JSON.parse(stdout);
    expect({ logs, typed: withoutModulePaths(typed) }).toEqual({ logs: [], typed: WITH_VIRTUAL_MODULE_TYPED });
    expect(exitCode).toBe(0);
  });

  // The type checker is given `./index.ts` as a path from the working directory, and so is the entry point.
  test("an entry point that is a relative key of files keeps the types that it exports", async () => {
    using dir = tempDir("build-api-dts-files-key", { "tsconfig.json": tsconfig });
    const options = `entrypoints: ["./index.ts"], files: { "./index.ts": ${JSON.stringify(nested["util.ts"])} }`;
    const { stdout, stderr, exitCode } = await build(String(dir), options);
    expect(stderr).toBe("");
    const { logs, typed } = JSON.parse(stdout);
    // On Windows the comment above a module of `files` is its path from the drive, behind `../` for each directory.
    const withoutModulePathsOnWindows = isWindows ? withoutModulePaths : (text: string) => text;
    expect({ logs, typed: withoutModulePathsOnWindows(typed) }).toEqual({
      logs: [],
      typed: withoutModulePathsOnWindows(`// index.ts
interface Options {
  n: number;
}
export type { Options };
function util(options: Options): string {
  return String(options.n);
}
export {
  util
};
`),
    });
    expect(exitCode).toBe(0);
  });

  // The type checker reads `index.ts` as it is written, with the header that the plugin removes.
  test("a file that an onLoad plugin changes leaves the typed files out", async () => {
    using dir = tempDir("build-api-dts-plugin-text", {
      "tsconfig.json": tsconfig,
      "index.ts": `/**
 * The license of this file.
 */
export interface Report {
  version: string;
  lines: ReadonlyArray<string>;
}
export function report(lines: ReadonlyArray<string>): Report {
  const version: string = String("1.0.0");
  return { version, lines };
}
`,
    });
    const plugin = `{
      name: "without-header",
      setup(build) {
        build.onLoad({ filter: /\\.ts$/ }, async ({ path }) => ({
          contents: (await Bun.file(path).text()).replace(/^\\/\\*\\*[^]*?\\*\\/\\n/, ""),
          loader: "ts",
        }));
      },
    }`;
    const { stdout, stderr, exitCode } = await build(String(dir), `entrypoints: ["./index.ts"], plugins: [${plugin}]`);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ logs: [expect.stringMatching(LEFT_OUT_FOR_ITS_TEXT)], typed: null });
    expect(exitCode).toBe(0);
  });

  // The source map is JSON, which cannot hold the byte 0xE9 that is not part of a UTF-8 sequence.
  test("a file that is not UTF-8 leaves the typed files out", async () => {
    using dir = tempDir("build-api-dts-latin-1", {
      "tsconfig.json": tsconfig,
      "index.ts": Buffer.concat([
        Buffer.from("// caf"),
        Buffer.from([0xe9]),
        Buffer.from(" in Latin-1\n" + nested["util.ts"]),
      ]),
    });
    const { stdout, stderr, exitCode } = await build(String(dir), `entrypoints: ["./index.ts"]`);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      logs: [
        expect.stringMatching(
          /^the \.aot\.ts files that --aot compiles a package from are left out: index\.js: .*index\.ts is not UTF-8, so the source map does not hold its text$/,
        ),
      ],
      typed: null,
    });
    expect(exitCode).toBe(0);
  });
});
