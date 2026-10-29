// `bun test --debug-aot` runs compiled code in place of the files. What an executable does with a plugin that is registered at run time: test/aot/parallel/library-modules.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const timeout = 600_000;

const tsconfig = JSON.stringify({
  compilerOptions: {
    module: "esnext",
    moduleResolution: "bundler",
    allowJs: true,
    typeRoots: [join(import.meta.dir, "../../packages")],
    types: ["bun-types"],
  },
});

const header = String.raw`
  import { lib } from "./lib";
  console.log(lib());
  function attempt(register: (build: any) => void): void {
    try {
      Bun.plugin({ name: "probe", setup: register });
      console.log("registered");
    } catch (error: any) {
      console.log(error.name + ": " + error.message);
    }
  }
`;

async function runTests(folder: string) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--debug-aot", "./main.test.ts"], folder, bunEnv);
  return { output: stdout + stderr, exitCode };
}

describe.concurrent("plugins registered at run time", () => {
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
      async () => {
        using dir = tempDir("aot-run-time-plugin", {
          "tsconfig.json": tsconfig,
          "lib.ts": `export function lib(): string { return "lib"; }`,
          "main.test.ts": `import { test } from "bun:test";\n${header}\ntest("case", () => attempt(${register}));\n`,
        });
        const { output, exitCode } = await runTests(String(dir));
        expect(output).toMatch(message);
        expect(exitCode).toBe(0);
      },
      timeout,
    );
  }
});

describe.concurrent("mock.module under bun test --debug-aot", () => {
  test(
    "a built-in module a compiled module imports throws",
    async () => {
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
    },
    timeout,
  );

  test(
    "a package nothing compiled imports is mocked",
    async () => {
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
    },
    timeout,
  );
});
