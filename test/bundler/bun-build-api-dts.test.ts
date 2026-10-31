import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
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

  // Without outdir, the chunk of `sub/index.ts` and the `sources` of its source map are relative to the working
  // directory, so the build runs in a process that has the project as its working directory.
  test("without outdir, a chunk in a directory has the types of its own modules", async () => {
    using dir = tempDir("build-api-dts-nested-memory", { "tsconfig.json": project["tsconfig.json"], ...nested });
    const build = `
      const built = await Bun.build({ entrypoints: ["./index.ts", "./sub/index.ts"], dts: true });
      const typed = built.outputs.find(output => output.path === "sub/index.aot.ts");
      console.log(JSON.stringify({ logs: built.logs.map(String), typed: await typed.text() }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", build],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ logs: [], typed: NESTED_TYPED });
    expect(exitCode).toBe(0);
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

  // A plugin's module is not a file. It is not the module of the file that has its name.
  test("a module that a plugin makes in a namespace of its own keeps the types that it is written with", async () => {
    using dir = tempDir("build-api-dts-plugin", {
      "tsconfig.json": JSON.stringify({
        ...JSON.parse(project["tsconfig.json"]),
        include: ["index.ts", "virtual.d.ts"],
      }),
      "virtual.d.ts": `declare module "virtual:thing.ts" {
  export function twice(n: number): number;
}
`,
      "thing.ts": `export function twice(text: string): string {
  return text + text;
}
`,
      "index.ts": `import { twice } from "virtual:thing.ts";
import { twice as twiceText } from "./thing";
export function run(n: number): string {
  return twiceText(String(twice(n)));
}
`,
    });
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "index.ts")],
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
      plugins: [
        {
          name: "virtual",
          setup(build) {
            build.onResolve({ filter: /^virtual:/ }, ({ path }) => ({
              path: path.slice("virtual:".length),
              namespace: "virtual",
            }));
            build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
              contents: `export interface Doubled {
  n: number;
}
export function twice(n: number): number {
  const doubled: Doubled = { n: n * 2 };
  return doubled.n;
}
`,
              loader: "ts",
            }));
          },
        },
      ],
    });
    expect(built.logs).toEqual([]);
    const typed = built.outputs.find(output => output.path.endsWith("index.aot.ts"))!;
    expect(withoutModulePaths(await typed.text())).toBe(`interface Doubled {
  n: number;
}
function twice(n: number): number {
  const doubled: Doubled = { n: n * 2 };
  return doubled.n;
}

function twice2(text: string): string {
  return text + text;
}

function run(n: number): string {
  return twice2(String(twice(n)));
}
export {
  run
};
`);
  });
});
