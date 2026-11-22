// The React Compiler declares a function that captures nothing beside the component, under a name of its own: `_temp`. The build declares it
// under a name that no file can write, and `.name` and a message that quotes the name say what they say in a bundled executable.
import { describe, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "./harness/commands";
import { afterAll, test } from "./harness/default-timeout";

const directory = join(import.meta.dir, "react-compiler", "same-as-bundle");
const standIn = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { paths: { "react/compiler-runtime": ["./compiler-runtime.js"] } },
  }),
  "compiler-runtime.js": `export function c(size) { return new Array(size).fill(Symbol.for("react.memo_cache_sentinel")); }\n`,
};

describe.skipIf(!!unsupported)("compile/aot/react-compiler: names of outlined functions", () => {
  const folder = String(tempDir("aot-react-compiler-names-of-outlined-functions", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test(
    "names-of-outlined-functions",
    () =>
      slot(async () => {
        const run = async (kind: "aot" | "bundle") => {
          const executable = join(folder, kind);
          const main = join(directory, "names-of-outlined-functions", "main.tsx");
          const build = [bunExe(), "run", join(directory, "build.ts"), main, executable, kind, "none"];
          built(await spawned(build, directory, bunEnv));
          return told(await spawned([executable], directory, bunEnv));
        };
        const bundled = await run("bundle");
        expect(bundled.stdout).toContain("_temp: a!");
        expect(await run("aot")).toEqual(bundled);
      }),
    600_000,
  );

  test(
    "in a test run",
    () =>
      slot(async () => {
        using project = tempDir("aot-react-compiler-names-of-outlined-functions-in-a-test-run", {
          ...standIn,
          "labels.jsx": `export function useLabel(show) {\n  "use memo";\n  return show(item => item + "!");\n}\n`,
          "names.test.js": `import { test } from "bun:test";\nimport { useLabel } from "./labels.jsx";\ntest("names", () => {\n  console.log("told:", useLabel(mark => mark.name));\n  try {\n    useLabel(undefined);\n  } catch (error) {\n    console.log("told:", error.message);\n  }\n});\n`,
        });
        const run = async (flags: string[]) => {
          const command = [bunExe(), "test", ...flags, "--react-compiler", "./names.test.js"];
          const { stdout, exitCode } = await spawned(command, String(project), bunEnv);
          return { told: stdout.match(/^told: .*$/gm), exitCode };
        };
        const plain = await run([]);
        expect(plain).toEqual({ told: ["told: _temp", expect.stringContaining("show(_temp)")], exitCode: 0 });
        expect(await run(["--aot"])).toEqual(plain);
      }),
    600_000,
  );
});
