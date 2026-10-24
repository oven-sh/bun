import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const timeout = 600_000;

const tsconfig = JSON.stringify({
  compilerOptions: {
    module: "esnext",
    moduleResolution: "bundler",
    resolveJsonModule: true,
    allowJs: true,
    typeRoots: [join(import.meta.dir, "../../packages")],
    types: ["bun-types"],
  },
});

const library = {
  "tsconfig.json": tsconfig,
  "lib.ts": `export function lib(): string { return "lib"; }`,
  "other.ts": `export function lib(): string { return "other"; }`,
  "late.ts": `export { lib } from "./lib";\nexport const late = "late";`,
  "legacy.cjs": `module.exports = { name: "legacy" };`,
  "data.json": `{ "name": "data" }`,
};

const header = String.raw`
  import { lib } from "./lib";
  import legacy from "./legacy.cjs";
  import data from "./data.json";
  console.log(lib(), legacy.name, data.name);
  const asked: string[] = [];
  const nameOf = (path: string) => path.split(/[\\/]/).pop()!;
  function attempt(register: (build: any) => void): void {
    try {
      Bun.plugin({ name: "probe", setup: register });
      console.log("registered");
    } catch (error: any) {
      console.log(error.name + ": " + error.message);
    }
  }
`;

const footer = String.raw`
  console.log("static:", lib(), legacy.name, data.name);
  console.log("import():", (await import("./lib")).lib(), (await import("./legacy.cjs")).default.name, (await import("./data.json")).default.name);
  console.log("require():", require("./lib").lib(), require("./legacy.cjs").name, require("./data.json").name);
  console.log("first loaded now:", (await import("./late")).lib(), (await import("./late")).late, (await import("./other")).lib());
  console.log("asked:", asked.join(" ") || "nothing");
`;

const unchanged =
  "static: lib legacy data\nimport(): lib legacy data\nrequire(): lib legacy data\nfirst loaded now: lib late other\nasked: nothing\n";

async function compileAndRun(folder: string, ...flags: string[]) {
  const executable = join(folder, "program" + flags.join("") + (isWindows ? ".exe" : ""));
  const build = await spawned(
    [bunExe(), "build", "--compile", ...flags, "main.ts", "--outfile", executable],
    folder,
    bunEnv,
  );
  built(build);
  return spawned([executable], folder, bunEnv);
}

async function runTests(folder: string) {
  const { stdout, stderr, exitCode } = await spawned(
    [bunExe(), "test", "--debug-aot", "./main.test.ts"],
    folder,
    bunEnv,
  );
  return { output: stdout + stderr, exitCode };
}

const replacement = `(args: any) => (asked.push("load:" + nameOf(args.path)), { contents: "export function lib() { return 'replaced'; } export default { name: 'replaced' };", loader: "js" })`;

const neverAsked: Record<string, string> = {
  "onLoad of a TypeScript module": String.raw`build => build.onLoad({ filter: /(lib|late|other)\.ts$/ }, ${replacement})`,
  "onLoad of a JSON module": String.raw`build => build.onLoad({ filter: /\.json$/ }, ${replacement})`,
  "onLoad of a CommonJS module": String.raw`build => build.onLoad({ filter: /legacy/ }, ${replacement})`,
  "onLoad of every file": String.raw`build => build.onLoad({ filter: /.*/ }, ${replacement})`,
  "onResolve of the entry point": String.raw`build => build.onResolve({ filter: /main/ }, (args: any) => (asked.push("resolve:" + nameOf(args.path)), undefined))`,
  "onResolve of every name": String.raw`build => build.onResolve({ filter: /.*/ }, (args: any) => (asked.push("resolve:" + nameOf(args.path)), undefined))`,
  "onResolve that sends one module of the program to another": String.raw`build => build.onResolve({ filter: /lib/ }, (args: any) => (asked.push("resolve:" + nameOf(args.path)), { path: import.meta.dir + "/other.ts" }))`,
  "onResolve that sends a module of the program to a file on disk": String.raw`build => build.onResolve({ filter: /lib/ }, (args: any) => (asked.push("resolve:" + nameOf(args.path)), { path: (globalThis as any).process.cwd() + "/other.ts" }))`,
};

const accepted = String.raw`
  ${header}
  attempt(build => build.onLoad({ filter: /\.yaml$/ }, () => ({ exports: { value: "from plugin" }, loader: "object" })));
  attempt(build => build.onLoad({ filter: /lib/, namespace: "virtual" }, () => ({ exports: { value: "from namespace" }, loader: "object" })));
  attempt(build => build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" })));
  attempt(build => build.module("my-virtual", () => ({ exports: { value: "from module" }, loader: "object" })));
  attempt(build => build.module("shared-lib", () => ({ exports: { lib }, loader: "object" })));
  const yamlPath = (globalThis as any).process.cwd() + "/written.yaml";
  await Bun.write(yamlPath, "value: from file");
  console.log((await import(yamlPath)).value);
  console.log((await import(["virtual", "lib"].join(":"))).value);
  console.log((await import(["my", "virtual"].join("-"))).value);
  console.log((await import(["shared", "lib"].join("-"))).lib === lib);
`;

const acceptedOutput =
  "lib legacy data\nregistered\nregistered\nregistered\nregistered\nregistered\nfrom plugin\nfrom namespace\nfrom module\ntrue\n";

describe.concurrent("plugins registered at run time", () => {
  for (const [name, register] of Object.entries(neverAsked)) {
    test(
      `${name} registers, and an executable never asks it for a module of the program`,
      () =>
        slot(async () => {
          using dir = tempDir("aot-run-time-plugin", {
            ...library,
            "main.ts": `${header}\nattempt(${register});\n${footer}`,
          });
          const bundled = await compileAndRun(String(dir));
          const compiled = await compileAndRun(String(dir), "--aot");
          const expected = { stdout: "lib legacy data\nregistered\n" + unchanged, exitCode: 0 };
          expect({ stdout: bundled.stdout, exitCode: bundled.exitCode }).toEqual(expected);
          expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual(expected);
        }),
      timeout,
    );
  }

  test(
    "module() of a compiled path throws",
    () =>
      slot(async () => {
        using dir = tempDir("aot-run-time-plugin", {
          ...library,
          "main.ts": String.raw`${header}
            attempt(build => {
              const resolved = import.meta.resolve("./lib.ts");
              build.module(resolved.startsWith("file:") ? Bun.fileURLToPath(resolved) : resolved, () => ({ exports: {}, loader: "object" }));
            });`,
        });
        const { stdout, exitCode } = await compileAndRun(String(dir), "--aot");
        expect(stdout).toMatch(/^TypeError: module\(\) cannot replace a module that was compiled ahead of time$/m);
        expect(exitCode).toBe(0);
      }),
    timeout,
  );

  test(
    "plugins for other modules register and run in an executable",
    () =>
      slot(async () => {
        using dir = tempDir("aot-run-time-plugin", { ...library, "main.ts": accepted });
        const { stdout, exitCode } = await compileAndRun(String(dir), "--aot");
        expect({ stdout, exitCode }).toEqual({ stdout: acceptedOutput, exitCode: 0 });
      }),
    timeout,
  );

  test("plugins for other modules register under bun run", async () => {
    using dir = tempDir("aot-run-time-plugin", { ...library, "main.ts": accepted });
    const { stdout, exitCode } = await spawned([bunExe(), "run", "main.ts"], String(dir), bunEnv);
    expect({ stdout, exitCode }).toEqual({ stdout: acceptedOutput, exitCode: 0 });
  });

  const inPlace: Record<string, { register: string; message: RegExp }> = {
    "onLoad of a module": {
      register: String.raw`build => build.onLoad({ filter: /lib\.ts$/ }, () => ({ contents: "", loader: "ts" }))`,
      message: /^Error: A runtime plugin can't load ".*lib\.ts" because it was already compiled into this executable$/m,
    },
    "onResolve of the entry point": {
      register: String.raw`build => build.onResolve({ filter: /main/ }, () => undefined)`,
      message:
        /^Error: A runtime plugin can't resolve the entry point ".*main.*" because it was already compiled into this executable$/m,
    },
  };
  for (const [name, { register, message }] of Object.entries(inPlace)) {
    test(
      `${name} throws where compiled code runs in place of the files, which bun test would put to the plugin`,
      () =>
        slot(async () => {
          using dir = tempDir("aot-run-time-plugin", {
            ...library,
            "main.test.ts": `import { test } from "bun:test";\n${header}\ntest("case", () => attempt(${register}));\n`,
          });
          const { output, exitCode } = await runTests(String(dir));
          expect(output).toMatch(message);
          expect(exitCode).toBe(0);
        }),
      timeout,
    );
  }
});

describe.concurrent("mock.module under bun test --debug-aot", () => {
  test(
    "a built-in module a compiled module imports throws",
    () =>
      slot(async () => {
        using dir = tempDir("aot-run-time-mock", {
          "tsconfig.json": tsconfig,
          "user.js": `import { existsSync } from "node:fs"; export const exists = path => existsSync(path);`,
          "main.test.ts": `
            import { mock, test } from "bun:test";
            import { exists } from "./user.js";
            test("case", () => {
              console.log("exists:", exists("main.test.ts"));
              try {
                mock.module("node:fs", () => ({ existsSync: () => false }));
                console.log("mocked");
              } catch (error: any) {
                console.log(error.name + ": " + error.message);
              }
            });
          `,
        });
        const { output, exitCode } = await runTests(String(dir));
        expect(output).toContain(
          `TypeError: mock(module, fn) cannot replace a module that was compiled ahead of time: "node:fs"`,
        );
        expect(output).not.toContain("mocked");
        expect(exitCode).toBe(0);
      }),
    timeout,
  );

  test(
    "a package nothing compiled imports is mocked",
    () =>
      slot(async () => {
        using dir = tempDir("aot-run-time-mock", {
          "tsconfig.json": tsconfig,
          "main.test.ts": `
            import { mock, test } from "bun:test";
            test("case", async () => {
              mock.module("not-installed-package", () => ({ a: 1 }));
              console.log("value:", (await import(["not-installed", "package"].join("-"))).a);
            });
          `,
        });
        const { output, exitCode } = await runTests(String(dir));
        expect(output).toContain("value: 1");
        expect(exitCode).toBe(0);
      }),
    timeout,
  );
});
