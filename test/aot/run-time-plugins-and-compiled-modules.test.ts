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
  "legacy.cjs": `module.exports = { name: "legacy" };`,
  "data.json": `{ "name": "data" }`,
};

const header = String.raw`
  import { lib } from "./lib";
  import legacy from "./legacy.cjs";
  import data from "./data.json";
  console.log(lib(), legacy.name, data.name);
  function attempt(register: (build: any) => void): void {
    try {
      Bun.plugin({ name: "probe", setup: register });
      console.log("registered");
    } catch (error: any) {
      console.log(error.name + ": " + error.message);
    }
  }
`;

const emptyOnLoadCallback = `() => ({ contents: "", loader: "ts" })`;

async function compileAndRun(folder: string) {
  const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
  const build = await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], folder, bunEnv);
  built(build);
  return spawned([executable], folder, bunEnv);
}

async function runTests(folder: string) {
  const { stdout, stderr, exitCode } = await spawned([bunExe(), "test", "--debug-aot", "./main.test.ts"], folder, bunEnv);
  return { output: stdout + stderr, exitCode };
}

const loadError = (path: string) =>
  new RegExp(`^Error: A runtime plugin can't load ".*${path}" because it was already compiled into this executable$`, "m");

const rejected: Record<string, { register: string; message: RegExp }> = {
  "onLoad of a TypeScript module": {
    register: String.raw`build => build.onLoad({ filter: /lib\.ts$/ }, ${emptyOnLoadCallback})`,
    message: loadError(String.raw`lib\.ts`),
  },
  "onLoad of a JSON module": {
    register: String.raw`build => build.onLoad({ filter: /\.json$/ }, ${emptyOnLoadCallback})`,
    message: loadError(String.raw`data\.json`),
  },
  "onLoad of a CommonJS module": {
    register: String.raw`build => build.onLoad({ filter: /legacy/ }, ${emptyOnLoadCallback})`,
    message: loadError(String.raw`legacy\.cjs`),
  },
  "module() of a compiled path": {
    register: String.raw`build => {
      const resolved = import.meta.resolve("./lib.ts");
      build.module(resolved.startsWith("file:") ? Bun.fileURLToPath(resolved) : resolved, () => ({ exports: {}, loader: "object" }));
    }`,
    message: /^TypeError: module\(\) cannot replace a module that was compiled ahead of time$/m,
  },
  "onResolve of the entry point": {
    register: String.raw`build => build.onResolve({ filter: /main/ }, () => undefined)`,
    message: /^Error: A runtime plugin can't resolve the entry point ".*main.*" because it was already compiled into this executable$/m,
  },
};

const accepted = String.raw`
  ${header}
  attempt(build => build.onLoad({ filter: /\.yaml$/ }, () => ({ exports: { value: "from plugin" }, loader: "object" })));
  attempt(build => build.onLoad({ filter: /lib/, namespace: "virtual" }, () => ({ contents: "", loader: "ts" })));
  attempt(build => build.module("my-virtual", () => ({ exports: { value: "from module" }, loader: "object" })));
  const yamlPath = (globalThis as any).process.cwd() + "/written.yaml";
  await Bun.write(yamlPath, "value: from file");
  console.log((await import(yamlPath)).value);
  console.log((await import(["my", "virtual"].join("-"))).value);
`;

const acceptedOutput = "lib legacy data\nregistered\nregistered\nregistered\nfrom plugin\nfrom module\n";

describe.concurrent("plugins registered at run time", () => {
  for (const [name, { register, message }] of Object.entries(rejected)) {
    test(
      `${name} throws`,
      () =>
        slot(async () => {
          using dir = tempDir("aot-run-time-plugin", { ...library, "main.ts": `${header}\nattempt(${register});\n` });
          const { stdout, exitCode } = await compileAndRun(String(dir));
          expect(stdout).toMatch(message);
          expect(exitCode).toBe(0);
        }),
      timeout,
    );
  }

  test(
    "plugins for other modules register and run in an executable",
    () =>
      slot(async () => {
        using dir = tempDir("aot-run-time-plugin", { ...library, "main.ts": accepted });
        const { stdout, exitCode } = await compileAndRun(String(dir));
        expect({ stdout, exitCode }).toEqual({ stdout: acceptedOutput, exitCode: 0 });
      }),
    timeout,
  );

  test("plugins for other modules register under bun run", async () => {
    using dir = tempDir("aot-run-time-plugin", { ...library, "main.ts": accepted });
    const { stdout, exitCode } = await spawned([bunExe(), "run", "main.ts"], String(dir), bunEnv);
    expect({ stdout, exitCode }).toEqual({ stdout: acceptedOutput, exitCode: 0 });
  });
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
        expect(output).toContain(`TypeError: mock(module, fn) cannot replace a module that was compiled ahead of time: "node:fs"`);
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
