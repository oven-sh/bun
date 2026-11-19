// What the output of the React Compiler needs beside the function itself, the two sentinels and the cache function, is there for whoever calls
// the function, however early: an import cycle can call a function of a file before the body of that file begins. A bundle has the sentinels at
// its head. Each program prints as an --aot executable what it prints as a bundled executable.
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

describe.skipIf(!!unsupported)("compile/aot/react-compiler: hooks called early", () => {
  const folder = String(tempDir("aot-react-compiler-hooks-called-early", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test.concurrent.each(["hooks-called-before-their-file-begins", "commonjs-hook-called-while-its-file-runs"])(
    "%s",
    name =>
      slot(async () => {
        const run = async (kind: "aot" | "bundle") => {
          const executable = join(folder, `${name}-${kind}`);
          const main = join(directory, name, "main.tsx");
          const build = [bunExe(), "run", join(directory, "build.ts"), main, executable, kind, "none"];
          built(await spawned(build, directory, bunEnv));
          return told(await spawned([executable], directory, bunEnv));
        };
        const bundled = await run("bundle");
        expect(bundled.stderr).toContain("[react-compiler] a cache of ");
        expect(bundled.stdout).not.toContain("Error");
        expect(await run("aot")).toEqual(bundled);
      }),
    600_000,
  );

  test(
    "in a test run",
    () =>
      slot(async () => {
        using project = tempDir("aot-react-compiler-hooks-called-early-in-a-test-run", {
          ...standIn,
          "hooks.jsx": `import { early } from "./caller.js";\nexport function useList() {\n  "use memo";\n  return ["kept"];\n}\nexport const toldEarly = early;\n`,
          "caller.js": `import { useList } from "./hooks.jsx";\nexport let early;\ntry {\n  early = useList().join();\n} catch (error) {\n  early = error.name;\n}\n`,
          "early.test.js": `import { test } from "bun:test";\nimport { toldEarly, useList } from "./hooks.jsx";\ntest("early", () => console.log("told:", toldEarly, useList().join()));\n`,
        });
        const run = async (flags: string[]) => {
          const command = [bunExe(), "test", ...flags, "--react-compiler", "./early.test.js"];
          const { stdout, exitCode } = await spawned(command, String(project), bunEnv);
          return { told: stdout.match(/^told: .*$/gm), exitCode };
        };
        expect(await run([])).toEqual({ told: ["told: kept kept"], exitCode: 0 });
        expect(await run(["--aot"])).toEqual({ told: ["told: kept kept"], exitCode: 0 });
      }),
    600_000,
  );
});
