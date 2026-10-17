import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const sources = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      types: [],
      lib: ["esnext"],
    },
  }),
  "src/index.ts": `import { greet } from "./greet";
import type { Options } from "./options";
export interface Server {
  port: number;
  options: Options;
}
export function serve(server: Server) {
  return greet(server.options) + server.port;
}
export const defaults = { port: 80, options: { name: "world" } };
`,
  "src/greet.ts": `import type { Options } from "./options";
export function greet(options: Options) {
  return "hello " + options.name;
}
function unexported() {}
`,
  "src/options.ts": `export type Options = { name: string; loud?: boolean };
`,
};

const declarations = {
  "index.d.ts": `import type { Options } from "./options";
export interface Server {
    port: number;
    options: Options;
}
export declare function serve(server: Server): string;
export declare const defaults: {
    port: number;
    options: {
        name: string;
    };
};
`,
  "greet.d.ts": `import type { Options } from "./options";
export declare function greet(options: Options): string;
`,
  "options.d.ts": `export type Options = {
    name: string;
    loud?: boolean;
};
`,
};

const rolledUp = `type Options = {
    name: string;
    loud?: boolean;
};
export type { Server };
interface Server {
    port: number;
    options: Options;
}
declare function serve(server: Server): string;
declare const defaults: {
    port: number;
    options: {
        name: string;
    };
};
export { defaults, serve };
`;

async function build(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "build", ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const withoutMark = (declarations: string) => declarations.replace(/^\/\/ @sound \S+ [0-9a-f]{64}\n/, "");
const leftOut = (why: string) =>
  `warn: --dts: the typed JavaScript that --aot compiles a package from is left out: ${why}\n`;

function written(folder: string) {
  const files = (readdirSync(folder, { recursive: true }) as string[]).filter(name => name.endsWith(".d.ts")).sort();
  return Promise.all(
    files.map(async name => [name.replaceAll("\\", "/"), withoutMark(await Bun.file(join(folder, name)).text())]),
  ).then(Object.fromEntries);
}

describe("bun build --dts", () => {
  test("writes one declaration file for the entry point of a bundle", async () => {
    using dir = tempDir("build-dts", sources);
    const { stdout, stderr, exitCode } = await build(String(dir), "src/index.ts", "--outdir", "dist", "--dts");
    expect(stderr).toBe("");
    expect(await written(join(String(dir), "dist"))).toEqual({ "index.d.ts": rolledUp });
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(["index.d.ts", "index.js", "index.sound.ts"]);
    const sha256 = createHash("sha256")
      .update(await Bun.file(join(String(dir), "dist", "index.js")).bytes())
      .digest("hex");
    expect(await Bun.file(join(String(dir), "dist", "index.d.ts")).text()).toBe(
      `// @sound index.sound.ts ${sha256}\n` + rolledUp,
    );
    expect(stdout).toContain("index.d.ts");
    expect(stdout).toContain("(declaration)");
    expect(await Bun.file(join(String(dir), "dist", "index.js")).exists()).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("names no declaration map, which it does not write", async () => {
    using dir = tempDir("build-dts-no-map", {
      ...sources,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          target: "esnext",
          types: [],
          lib: ["esnext"],
          declaration: true,
          declarationMap: true,
        },
      }),
    });
    expect(await build(String(dir), "src/index.ts", "--outdir", "dist", "--root", "src", "--dts")).toMatchObject({
      stderr: "",
      exitCode: 0,
    });
    expect(await written(join(String(dir), "dist"))).toEqual(declarations);
  });

  test("the JavaScript is the same with and without it", async () => {
    using dir = tempDir("build-dts-same", sources);
    expect((await build(String(dir), "src/index.ts", "--outdir", "with", "--dts")).exitCode).toBe(0);
    expect((await build(String(dir), "src/index.ts", "--outdir", "without")).exitCode).toBe(0);
    expect(await Bun.file(join(String(dir), "with", "index.js")).text()).toBe(
      await Bun.file(join(String(dir), "without", "index.js")).text(),
    );
  });

  test("a type error fails the build and nothing is written", async () => {
    using dir = tempDir("build-dts-error", {
      ...sources,
      "src/greet.ts": `export function greet(options: { name: string }): number {\n  return options.name;\n}\n`,
    });
    const { stderr, exitCode } = await build(String(dir), "src/index.ts", "--outdir", "dist", "--dts");
    expect(stderr).toContain("TS2322");
    expect(await Bun.file(join(String(dir), "dist", "index.js")).exists()).toBe(false);
    expect(await Bun.file(join(String(dir), "dist", "index.d.ts")).exists()).toBe(false);
    expect(exitCode).toBe(1);
  });

  test("one for each entry point", async () => {
    using dir = tempDir("build-dts-entry-points", sources);
    const { stderr, exitCode } = await build(String(dir), "src/index.ts", "src/greet.ts", "--outdir", "dist", "--dts");
    expect(stderr).toBe("");
    expect(await written(join(String(dir), "dist"))).toEqual({
      "index.d.ts": rolledUp,
      "greet.d.ts": `type Options = {\n    name: string;\n    loud?: boolean;\n};\ndeclare function greet(options: Options): string;\nexport { greet };\n`,
    });
    expect(exitCode).toBe(0);
  });

  test("documentation comments are kept", async () => {
    using dir = tempDir("build-dts-documentation", {
      ...sources,
      "src/index.ts": `export * from "./greet";\n`,
      "src/greet.ts": `/** What a greeting needs. */
export interface Options {
  /** Who is greeted. */
  name: string;
}
/**
 * Greets somebody.
 * @param options who, and how
 * @returns the greeting
 * @example greet({ name: "you" })
 */
export function greet(options: Options): string {
  return "hello " + options.name;
}
/** Keeps a count. */
export class Counter {
  /** How many so far. */
  count = 0;
  /**
   * Adds one.
   * @deprecated use \`add\`
   */
  increment(): number {
    return ++this.count;
  }
}
/** The default name. */
export const fallback = "world";
`,
    });
    const { stderr, exitCode } = await build(String(dir), "src/index.ts", "--outdir", "dist", "--dts");
    expect(stderr).toBe("");
    expect(await written(join(String(dir), "dist"))).toEqual({
      "index.d.ts": `/** What a greeting needs. */
interface Options {
    /** Who is greeted. */
    name: string;
}
export type { Options };
/**
 * Greets somebody.
 * @param options who, and how
 * @returns the greeting
 * @example greet({ name: "you" })
 */
declare function greet(options: Options): string;
/** Keeps a count. */
declare class Counter {
    /** How many so far. */
    count: number;
    /**
     * Adds one.
     * @deprecated use \`add\`
     */
    increment(): number;
}
/** The default name. */
declare const fallback = "world";
export { Counter, fallback, greet };
`,
    });
    expect(await Bun.file(join(String(dir), "dist", "index.sound.ts")).text()).not.toContain("Greets somebody.");
    expect(exitCode).toBe(0);
  });

  test("a namespace that holds code keeps its declarations", async () => {
    using dir = tempDir("build-dts-namespace", {
      ...sources,
      "src/index.ts": `export interface Point { x: number; y: number }
export namespace Geo {
  export const origin: Point = { x: 0, y: 0 };
  export function dist(a: Point, b: Point = origin): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  export namespace Deep {
    export const k = 3;
  }
}
`,
    });
    const { stderr, exitCode } = await build(String(dir), "src/index.ts", "--outdir", "dist", "--dts");
    expect(stderr).toBe("");
    expect(await written(join(String(dir), "dist"))).toEqual({
      "index.d.ts": `export interface Point {
    x: number;
    y: number;
}
export declare namespace Geo {
    const origin: Point;
    function dist(a: Point, b?: Point): number;
    namespace Deep {
        const k = 3;
    }
}
`,
    });
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(["index.d.ts", "index.js", "index.sound.ts"]);
    expect(exitCode).toBe(0);
  });

  test("minified output gets a declaration file for every source file", async () => {
    using dir = tempDir("build-dts-minify", sources);
    const { stderr, exitCode } = await build(String(dir), "src/index.ts", "--outdir", "dist", "--minify", "--dts");
    expect(stderr).toBe(leftOut("it does not support --minify yet"));
    expect(await written(join(String(dir), "dist"))).toEqual(declarations);
    expect(await Bun.file(join(String(dir), "dist", "index.d.ts")).text()).toBe(declarations["index.d.ts"]);
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual([
      "greet.d.ts",
      "index.d.ts",
      "index.js",
      "options.d.ts",
    ]);
    expect(exitCode).toBe(0);
  });

  test("--sourcemap is written when it is asked for", async () => {
    using dir = tempDir("build-dts-sourcemap", sources);
    expect(
      (await build(String(dir), "src/index.ts", "--outdir", "dist", "--sourcemap=external", "--dts")).exitCode,
    ).toBe(0);
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual([
      "index.d.ts",
      "index.js",
      "index.js.map",
      "index.sound.ts",
    ]);
  });

  test("--root: a declaration file for every source file, where it is under the root", async () => {
    using dir = tempDir("build-dts-root", sources);
    expect((await build(String(dir), "src/index.ts", "--outdir", "flat", "--root", "src", "--dts")).exitCode).toBe(0);
    expect(await written(join(String(dir), "flat"))).toEqual(declarations);
    expect(await Bun.file(join(String(dir), "flat", "index.d.ts")).text()).toStartWith("// @sound index.sound.ts ");
    expect(await Bun.file(join(String(dir), "flat", "greet.d.ts")).text()).toBe(declarations["greet.d.ts"]);
    const { stderr, exitCode } = await build(String(dir), "src/index.ts", "--outdir", "dist", "--root", ".", "--dts");
    expect(stderr).toBe("");
    expect(Object.keys(await written(join(String(dir), "dist")))).toEqual([
      "src/greet.d.ts",
      "src/index.d.ts",
      "src/options.d.ts",
    ]);
    expect(exitCode).toBe(0);
  });

  test("a source file outside the root is an error", async () => {
    using dir = tempDir("build-dts-outside", {
      ...sources,
      "shared.ts": `export const shared = 1;\n`,
      "src/greet.ts": `export { shared as greet } from "../shared";\n`,
      "src/index.ts": `export { greet } from "./greet";\n`,
    });
    const { stderr, exitCode } = await build(String(dir), "src/index.ts", "--outdir", "dist", "--root", "src", "--dts");
    expect(stderr).toContain("outside the root directory");
    expect(exitCode).toBe(1);
  });

  test("--no-bundle writes one for each entry point", async () => {
    using dir = tempDir("build-dts-no-bundle", sources);
    const { stderr, exitCode } = await build(
      String(dir),
      "src/index.ts",
      "src/greet.ts",
      "src/options.ts",
      "--no-bundle",
      "--outdir",
      "dist",
      "--dts",
    );
    expect(stderr).toBe("");
    expect(await written(join(String(dir), "dist"))).toEqual(declarations);
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(
      ["greet", "index", "options"].flatMap(name => [`${name}.d.ts`, `${name}.js`, `${name}.sound.ts`]),
    );
    expect(exitCode).toBe(0);
  });

  test("--no-bundle without a file that the entry points import types from", async () => {
    using dir = tempDir("build-dts-no-bundle-partly", sources);
    const { stderr, exitCode } = await build(
      String(dir),
      "src/index.ts",
      "src/greet.ts",
      "--no-bundle",
      "--outdir",
      "dist",
      "--dts",
    );
    expect(stderr).toStartWith(
      leftOut("").trimEnd() + " with its types put back it has type errors, the first at greet.sound.ts:1:30: TS2307: ",
    );
    expect(stderr.trim().split("\n").length).toBe(1);
    expect(await written(join(String(dir), "dist"))).toEqual({
      "index.d.ts": declarations["index.d.ts"],
      "greet.d.ts": declarations["greet.d.ts"],
    });
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(["greet.d.ts", "greet.js", "index.d.ts", "index.js"]);
    expect(exitCode).toBe(0);
  });

  test("requires --outdir", async () => {
    using dir = tempDir("build-dts-stdout", sources);
    const { stderr, exitCode } = await build(String(dir), "src/index.ts", "--dts");
    expect(stderr).toContain("--dts requires --outdir");
    expect(exitCode).toBe(1);
  });

  test("Bun.build({ dts: true })", async () => {
    using dir = tempDir("build-dts-api", sources);
    const { outputs, success } = await Bun.build({
      entrypoints: [join(String(dir), "src/index.ts")],
      dts: true,
      tsconfig: join(String(dir), "tsconfig.json"),
    });
    expect(success).toBe(true);
    const files = outputs.filter(output => output.kind === "declaration");
    expect(
      Object.fromEntries(
        await Promise.all(files.map(async file => [file.path.replace(/^\.\//, ""), withoutMark(await file.text())])),
      ),
    ).toEqual({ "index.d.ts": rolledUp });
    expect(outputs.filter(output => output.kind === "sound").map(file => file.path.replace(/^\.\//, ""))).toEqual([
      "index.sound.ts",
    ]);
  });

  test("Bun.build({ dts: true, outdir })", async () => {
    using dir = tempDir("build-dts-api-outdir", sources);
    const { outputs, success } = await Bun.build({
      entrypoints: [join(String(dir), "src/index.ts")],
      dts: true,
      outdir: join(String(dir), "dist"),
      tsconfig: join(String(dir), "tsconfig.json"),
    });
    expect(success).toBe(true);
    expect(outputs.map(output => output.kind).sort()).toEqual(["declaration", "entry-point", "sound"]);
    expect(await written(join(String(dir), "dist"))).toEqual({ "index.d.ts": rolledUp });
    expect(await Bun.file(join(String(dir), "dist", "index.js")).exists()).toBe(true);
  });

  test("Bun.build({ dts: true, root })", async () => {
    using dir = tempDir("build-dts-api-root", sources);
    const { outputs, success } = await Bun.build({
      entrypoints: [join(String(dir), "src/index.ts")],
      dts: true,
      root: join(String(dir), "src"),
      outdir: join(String(dir), "dist"),
      tsconfig: join(String(dir), "tsconfig.json"),
    });
    expect(success).toBe(true);
    expect(outputs.filter(output => output.kind === "declaration").length).toBe(3);
    expect(await written(join(String(dir), "dist"))).toEqual(declarations);
  });

  test("Bun.build({ dts: true, minify: true }) warns and leaves the typed JavaScript out", async () => {
    using dir = tempDir("build-dts-api-minify", sources);
    const { outputs, logs, success } = await Bun.build({
      entrypoints: [join(String(dir), "src/index.ts")],
      dts: true,
      minify: true,
      outdir: join(String(dir), "dist"),
      tsconfig: join(String(dir), "tsconfig.json"),
    });
    expect(success).toBe(true);
    expect(logs.map(log => `${log.level}: ${log.message}\n`)).toEqual([leftOut("it does not support minify yet")]);
    expect(outputs.map(output => output.kind).sort()).toEqual([
      "declaration",
      "declaration",
      "declaration",
      "entry-point",
    ]);
  });
});
