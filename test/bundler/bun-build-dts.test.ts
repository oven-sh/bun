import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithBunTypes } from "harness";
import { dirname, join } from "path";

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

// A program that loads an .aot.ts file always has the types of Bun: the @types/bun of its project, or else the copy that Bun
// carries. It reads every file as a module. The .aot.ts files are type checked without those types first. Where that check
// finds an error, a check in a program that has them decides.
describe.concurrent("bun build --dts: an error in the .aot.ts files is checked again with the types of Bun", () => {
  // What `bun init` writes.
  const bunInit = (lib: string[] = ["ESNext"]) =>
    JSON.stringify({
      compilerOptions: {
        lib,
        target: "ESNext",
        module: "Preserve",
        moduleDetection: "force",
        jsx: "react-jsx",
        allowJs: true,
        types: ["bun"],
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        noFallthroughCasesInSwitch: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
      },
    });
  // What the package.json has to state of such sources, for the build to ask for nothing.
  const manifest = (compilerOptions: object) =>
    JSON.stringify({ name: "where", version: "1.0.0", type: "module", compilerOptions });
  const statedForBunInit = (lib: string[] = ["esnext"]) => ({
    strict: true,
    noUncheckedIndexedAccess: true,
    lib,
    jsx: "react-jsx",
  });
  // An @types/bun with the few declarations that these libraries read. The real package takes far longer to load.
  const smallTypesOfBun = {
    "node_modules/@types/bun/package.json": JSON.stringify({
      name: "@types/bun",
      version: "1.0.0",
      types: "index.d.ts",
    }),
    "node_modules/@types/bun/index.d.ts": `interface ImportMeta {
  readonly url: string;
  readonly dir: string;
}
declare function require(name: string): any;
declare module "node:os" {
  export function platform(): string;
}
declare module "node:module" {
  export function createRequire(from: string): (name: string) => any;
}
`,
  };
  const withoutTypes = (lib: string[], more: object = {}) =>
    JSON.stringify({
      compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", types: [], lib, ...more },
    });
  const written = (dir: unknown) => readdirSync(join(String(dir), "out")).sort();
  const typedFile = (dir: unknown) => readFileSync(join(String(dir), "out/index.aot.ts"), "utf8");
  const build = (dir: unknown, ...flags: string[]) =>
    bun(String(dir), "build", "./src/index.ts", "--outdir", "out", "--dts", ...flags);
  const readsImportMeta = `export const here: string = import.meta.url;
export function folder(): string {
  return import.meta.dir;
}
`;
  // Two copies of a class with a private member do not fit each other: an error with the types of Bun and without them.
  const twoCopiesOfAClass = {
    "src/token.ts": `export class Token {
  private secret: number;
  constructor(secret: number) {
    this.secret = secret;
  }
  reveal(): number {
    return this.secret;
  }
}
`,
    "src/make.ts": `import { Token } from "./token";
export function make(secret: number): Token {
  return new Token(secret);
}
`,
    "src/index.ts": `import { make } from "./make";
import type { Token } from "./token";
export const here: string = import.meta.url;
export function read(token: Token): number {
  return token.reveal();
}
export function one(): number {
  return read(make(1));
}
`,
  };
  const leftOutForTheTwoCopies =
    /^warn: the \.aot\.ts files that --aot compiles a package from are left out: they have type errors, the first at index\.aot\.ts:\d+:\d+: TS2345: Argument of type 'Token' is not assignable to parameter of type 'Token'\.\n$/;

  test.each(["browser", "bun", "node"])(
    "a library that reads import.meta, under the tsconfig.json that bun init writes, for --target=%s",
    async target => {
      using dir = tempDir("build-dts-import-meta", {
        ...smallTypesOfBun,
        "tsconfig.json": bunInit(),
        "package.json": manifest(statedForBunInit()),
        "src/index.ts": readsImportMeta,
      });
      const built = await build(dir, `--target=${target}`);
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(written(dir)).toEqual(["index.aot.ts", "index.d.ts", "index.js"]);
      expect(typedFile(dir)).toContain("const here: string = import.meta.url;");
    },
  );

  test("a project as bun init writes it: the file is written, and the build asks for compilerOptions in package.json", async () => {
    using dir = tempDir("build-dts-bun-init", {
      ...smallTypesOfBun,
      "tsconfig.json": bunInit(),
      "package.json": JSON.stringify({ name: "where", module: "src/index.ts", type: "module", private: true }),
      "src/index.ts": readsImportMeta,
    });
    const built = await build(dir);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: `warn: package.json needs "compilerOptions": ${JSON.stringify(statedForBunInit())}: --aot type checks a package's .aot.ts files under them, and as strict without them\n`,
      exitCode: 0,
    });
    expect(written(dir)).toEqual(["index.aot.ts", "index.d.ts", "index.js"]);
  });

  // --library builds for Node.js, where a call of require brings Bun's own line `createRequire(import.meta.url)`.
  test("bun compile --library: the package.json names the .aot.ts file under the aot condition", async () => {
    using dir = tempDir("library-import-meta", {
      ...smallTypesOfBun,
      "tsconfig.json": bunInit(),
      "package.json": JSON.stringify({ name: "where", version: "1.0.0" }),
      "src/index.ts": `${readsImportMeta}export function platform(): string {
  const os = require("node:os") as typeof import("node:os");
  return os.platform();
}
`,
    });
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual([
      "index.aot.ts",
      "index.d.ts",
      "index.js",
      "package.json",
    ]);
    const packageJson = JSON.parse(readFileSync(join(String(dir), "dist/package.json"), "utf8"));
    expect(packageJson.exports["."]).toEqual({ aot: "./index.aot.ts", types: "./index.d.ts", default: "./index.js" });
  });

  test("members that only the types of Bun declare", async () => {
    using dir = tempDirWithBunTypes("build-dts-members-of-bun", {
      "tsconfig.json": bunInit(["ESNext", "DOM"]),
      "package.json": manifest(statedForBunInit(["esnext", "dom"])),
      "src/index.ts": `export function through(proxy: string) {
  return Bun.serve({
    port: 0,
    fetch(request) {
      return fetch(request.url, { proxy });
    },
  });
}
export function mark(error: Error): void {
  Error.captureStackTrace(error, mark);
}
`,
    });
    const built = await build(dir);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(written(dir)).toEqual(["index.aot.ts", "index.d.ts", "index.js"]);
    expect(typedFile(dir)).toContain("return fetch(request.url, { proxy });");
  });

  test("--splitting: the line of Bun's own that reads import.meta.url, in a project with no types installed", async () => {
    using dir = tempDir("build-dts-chunks-import-meta", {
      "tsconfig.json": withoutTypes(["esnext"]),
      "package.json": manifest({ strict: true, lib: ["esnext"] }),
      "src/index.ts": `export async function greet(name: string): Promise<string> {
  const { join } = await import("./join");
  return join("hello", name);
}
`,
      "src/join.ts": project["src/join.ts"],
    });
    const built = await build(dir, "--splitting");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(written(dir).filter(name => name.endsWith(".aot.ts"))).toHaveLength(2);
    expect(typedFile(dir)).toContain("(import.meta.url,");
  });

  // A project for Node.js: @types/node is installed, and @types/bun is not.
  const nodeProject = (name: string, more = "") => {
    const dir = tempDir(name, {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          types: ["node"],
          lib: ["esnext"],
        },
      }),
      "package.json": manifest({ strict: true, lib: ["esnext"] }),
      "src/index.ts": `import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
export const file: string = fileURLToPath(import.meta.url);
export class Poller extends EventEmitter {
  start(): boolean {
    return this.emit("tick");
  }
}
${more}`,
    });
    // The @types/node that the types of Bun in this repository refer to.
    const typesOfBun = join(import.meta.dir, "../../packages/bun-types");
    const typesOfNode = dirname(Bun.resolveSync("@types/node/package.json", typesOfBun));
    mkdirSync(join(String(dir), "node_modules/@types"), { recursive: true });
    symlinkSync(typesOfNode, join(String(dir), "node_modules/@types/node"), "junction");
    return dir;
  };

  test("a library that is written for Node.js, with @types/node installed and not @types/bun", async () => {
    using dir = nodeProject("build-dts-node-types");
    const built = await build(dir, "--target=node");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(written(dir)).toEqual(["index.aot.ts", "index.d.ts", "index.js"]);
    expect(typedFile(dir)).toContain('return this.emit("tick");');
  });

  // The check without the types of Bun has an error at `emit`, which they clear. With them fetch has a member more, so
  // they have an error at `get`, where the check without them has none. A program that installs the package would have it.
  // TODO: on Windows the build says nothing, as in compile-library.test.ts.
  test.todoIf(isWindows)("an error that only the types of Bun report is the one named", async () => {
    using dir = nodeProject(
      "build-dts-node-types-fetch",
      "export const get: typeof fetch = async input => new Response(String(input));\n",
    );
    const built = await build(dir, "--target=node");
    expect(built.stderr).toMatch(
      /^warn: the \.aot\.ts files that --aot compiles a package from are left out: they have type errors, the first at index\.aot\.ts:\d+:\d+: TS2741: Property 'preconnect' is missing in type /,
    );
    expect(built.exitCode).toBe(0);
    expect(written(dir)).toEqual(["index.d.ts", "index.js"]);
  });

  test("a project that has bun-types installed and not @types/bun: the installed types count", async () => {
    using dir = tempDir("build-dts-bun-types-package", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          types: ["bun-types"],
          lib: ["esnext"],
        },
      }),
      "package.json": manifest({ strict: true, lib: ["esnext"] }),
      "node_modules/bun-types/package.json": JSON.stringify({
        name: "bun-types",
        version: "1.0.0",
        types: "index.d.ts",
      }),
      // A member that the types of Bun do not have: the copy that Bun carries would not know it.
      "node_modules/bun-types/index.d.ts": `interface ImportMeta {\n  readonly onlyInThisCopy: string;\n}\n`,
      "src/index.ts": `export const here: string = import.meta.onlyInThisCopy;\n`,
    });
    const built = await build(dir);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(written(dir)).toEqual(["index.aot.ts", "index.d.ts", "index.js"]);
  });

  test("two entry points without import or export that declare the same name: each is a module", async () => {
    using dir = tempDir("build-dts-entry-points-as-modules", {
      "tsconfig.json": withoutTypes(["esnext", "dom"], { moduleDetection: "force" }),
      "package.json": manifest({ strict: true, lib: ["esnext", "dom"] }),
      "src/index.ts": `const greeting: string = "hello";\nconsole.log(greeting);\n`,
      "src/other.ts": `const greeting: number = 1;\nconsole.log(greeting);\n`,
    });
    const built = await build(dir, "./src/other.ts");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(written(dir).filter(name => name.endsWith(".aot.ts"))).toEqual(["index.aot.ts", "other.aot.ts"]);
  });

  // The types of Bun say otherwise of each line. The check without them has nothing to report, so the build does not ask.
  test("a library for browsers that is right under its own lib is written as before", async () => {
    using dir = tempDir("build-dts-browser-library", {
      "tsconfig.json": withoutTypes(["esnext", "dom"]),
      "package.json": manifest({ strict: true, lib: ["esnext", "dom"] }),
      "src/index.ts": `export function later(run: () => void): number {
  const timer: number = setTimeout(run, 1);
  return timer;
}
export function wrap(inner: typeof fetch): typeof fetch {
  return (input, init) => inner(input, init);
}
export function isMac(): boolean {
  return navigator.platform === "MacIntel";
}
`,
    });
    const built = await build(dir);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(written(dir)).toEqual(["index.aot.ts", "index.d.ts", "index.js"]);
    expect(typedFile(dir)).toContain("const timer: number = setTimeout(run, 1);");
  });

  // TODO: on Windows the build says nothing, as in compile-library.test.ts.
  test.todoIf(isWindows)(
    "an error that the types of Bun keep is named, not one that they clear before it",
    async () => {
      using dir = tempDir("build-dts-error-in-both", {
        ...smallTypesOfBun,
        "tsconfig.json": bunInit(),
        "package.json": manifest(statedForBunInit()),
        ...twoCopiesOfAClass,
      });
      const built = await build(dir, "./src/make.ts", "--splitting");
      expect(built.stderr).toMatch(leftOutForTheTwoCopies);
      expect(built.exitCode).toBe(0);
      expect(written(dir).filter(name => name.endsWith(".aot.ts"))).toEqual([]);
    },
  );

  // TODO: on Windows the build says nothing, as in compile-library.test.ts.
  test.todoIf(isWindows)("an @types/bun that is installed without its files clears no error", async () => {
    using dir = tempDir("build-dts-types-of-bun-without-files", {
      "tsconfig.json": withoutTypes(["esnext"]),
      "package.json": manifest({ strict: true, lib: ["esnext"] }),
      "node_modules/@types/bun/package.json": JSON.stringify({
        name: "@types/bun",
        version: "1.0.0",
        types: "index.d.ts",
      }),
      ...twoCopiesOfAClass,
      "src/index.ts": twoCopiesOfAClass["src/index.ts"].replace("import.meta.url", '"here"'),
    });
    const built = await build(dir, "./src/make.ts", "--splitting");
    expect(built.stderr).toMatch(leftOutForTheTwoCopies);
    expect(built.exitCode).toBe(0);
    expect(written(dir).filter(name => name.endsWith(".aot.ts"))).toEqual([]);
  });

  // The third entry point has neither import nor export, so the check without the types of Bun reads it as a script, where
  // `await` is a name. It stops there and judges no file. The check with them reads a module, and finds the two copies.
  // TODO: on Windows the build says nothing, as in compile-library.test.ts.
  test.todoIf(isWindows)(
    "where the first check stops at a file that it reads as a script, the check with the types of Bun decides",
    async () => {
      using dir = tempDir("build-dts-error-of-syntax", {
        ...smallTypesOfBun,
        "tsconfig.json": bunInit(),
        "package.json": manifest(statedForBunInit()),
        ...twoCopiesOfAClass,
        "src/pattern.ts": `await /a/.exec("a");\n`,
      });
      const built = await build(dir, "./src/make.ts", "./src/pattern.ts", "--splitting");
      expect(built.stderr).toMatch(leftOutForTheTwoCopies);
      expect(built.exitCode).toBe(0);
      expect(written(dir).filter(name => name.endsWith(".aot.ts"))).toEqual([]);
    },
  );
});
