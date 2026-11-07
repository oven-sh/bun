// `bun test --debug-aot` runs compiled code in place of the files. What an executable does with a plugin that is registered at run time: test/aot/parallel/library-modules.
// What a build finds in one test file holds for the whole run: a computed import opens it to code that no build has seen, and a plugin lets every file load again. So only the
// cases of which a build finds the same share a run, as folders of one project: the two that register a plugin. Such a run compiles much of Bun's own library, whatever it holds.
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

// A plugin outlives its test file, so no case names a file of another.
const projects = new Map<string, Record<string, string>>();
const runs = new Map<string, Promise<{ output: string; exitCode: number | null }>>();
const runTests = (project: string) =>
  runs.getOrInsertComputed(project, async () => {
    const files = projects.get(project)!;
    using dir = tempDir("aot-run-time-plugin", files);
    const testFiles = Object.keys(files).filter(path => path.endsWith(".test.ts"));
    const cmd = [bunExe(), "test", "--debug-aot", ...testFiles.map(path => "./" + path)];
    const { stdout, stderr, exitCode } = await run(cmd, String(dir), bunEnv);
    return { output: stdout + stderr, exitCode };
  });

/** Adds a folder to the project. Its test file holds one test, which has the name of the folder. */
function addCase(project: string, folder: string, ofCase: Record<string, string>) {
  const files = projects.getOrInsertComputed(project, () => ({ "tsconfig.json": tsconfig }));
  for (const [path, text] of Object.entries(ofCase)) files[`${folder}/${path}`] = text;
  return async () => {
    const { output, exitCode } = await runTests(project);
    const failed = Array.from(output.matchAll(/^\(fail\) (\S+)/gm), ([, name]) => name);
    expect(output).toMatch(new RegExp(`^\\(pass\\) ${folder}\\b`, "m"));
    // A run ends with 1 where a test has failed: that is held against the case of that test alone.
    return { output, exitCode: exitCode === 1 && failed.length > 0 && !failed.includes(folder) ? 0 : exitCode };
  };
}

describe.concurrent("plugins registered at run time", () => {
  const inPlace: Record<string, { register: string; message: RegExp }> = {
    "onResolve of the entry point": {
      register: String.raw`build => build.onResolve({ filter: /main/ }, () => undefined)`,
      message:
        /^Error: A runtime plugin can't resolve the entry point ".*main.*" because it was already compiled into this executable$/m,
    },
  };
  for (const [name, { register, message }] of Object.entries(inPlace)) {
    const runCase = addCase("plugins", "resolves", {
      "lib.ts": `export function lib(): string { return "lib"; }`,
      "main.test.ts": `import { test } from "bun:test";\n${header}\ntest("resolves", () => attempt(${register}));\n`,
    });
    test(
      `${name} throws where compiled code runs in place of the files, which bun test would put to the plugin`,
      async () => {
        const { output, exitCode } = await runCase();
        expect(output).toMatch(message);
        expect(exitCode).toBe(0);
      },
      timeout,
    );
  }
});

describe.concurrent("plugins that load files of a test run", () => {
  // More of it, against `bun test`: "a plugin that loads files of the run" in harness/modules-in-a-test-run.ts.
  const runCase = addCase("plugins", "loads", {
    "lib.ts": `export function lib(): string { return "lib"; }`,
    "late.ts": `export function lib(): string { return "late"; }`,
    "plugin.test.ts": `import { test } from "bun:test";\n${header}
          test("loads", async () => {
            attempt(build => build.onLoad({ filter: /loads[\\\\/](lib|late)\\.ts$/ }, () => ({ contents: "export const lib = () => 'from the plugin';", loader: "ts" })));
            console.log(lib(), (await import("./lib")).lib(), (await import("./late")).lib());
          });\n`,
  });
  test(
    "onLoad gets a file that has not run, and a file that has run stays",
    async () => {
      const { output, exitCode } = await runCase();
      expect(output).toContain("registered\nlib lib from the plugin\n");
      expect(exitCode).toBe(0);
    },
    timeout,
  );
});

describe.concurrent("mock.module under bun test --debug-aot", () => {
  const runBuiltIn = addCase("a mocked built-in module", "built-in", {
    "user.js": `import { existsSync } from "node:fs"; export const exists = path => existsSync(path);`,
    "mock.test.ts": `
            import { mock, test } from "bun:test";
            import { exists } from "./user.js";
            test("built-in", () => {
              console.log("exists:", exists("tsconfig.json"));
              mock.module("node:fs", () => ({ existsSync: () => false }));
              console.log("mocked:", exists("tsconfig.json"));
            });
          `,
  });
  test(
    "a built-in module a compiled module imports is mocked",
    async () => {
      const { output, exitCode } = await runBuiltIn();
      expect(output).toContain("exists: true\nmocked: false\n");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  const runPackage = addCase("a mocked package", "package", {
    "mock.test.ts": `
            import { mock, test } from "bun:test";
            test("package", async () => {
              mock.module("not-installed-package", () => ({ a: 1 }));
              console.log("value:", (await import(["not-installed", "package"].join("-"))).a);
            });
          `,
  });
  test(
    "a package nothing compiled imports is mocked",
    async () => {
      const { output, exitCode } = await runPackage();
      expect(output).toContain("value: 1");
      expect(exitCode).toBe(0);
    },
    timeout,
  );
});
