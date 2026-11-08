// The React Compiler moves the default of a parameter into the body and gives the parameter another name. A hook that is a type guard of such a
// parameter still narrows for its caller: the type checker of an --aot build reads the compiler's output in place of the component file, and
// `bun build --dts` writes the bundle with the types of its sources (.aot.ts). Both keep the written return type, which names the parameter.
import { describe, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "./harness/commands";
import { afterAll, test } from "./harness/default-timeout";

const programs = join(import.meta.dir, "react-compiler");

describe.skipIf(!!unsupported)("compile/aot/react-compiler: type guards", () => {
  const folder = String(tempDir("aot-react-compiler-type-guards", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test.concurrent(
    "type-guard-on-a-parameter-with-a-default",
    () =>
      slot(async () => {
        const main = join(programs, "type-guard-on-a-parameter-with-a-default", "main.ts");
        const executable = join(folder, "type-guard-on-a-parameter-with-a-default");
        // The build type checks main.ts, which reads what each guard has narrowed.
        built(await spawned([bunExe(), "run", join(programs, "build.ts"), main, executable], programs, bunEnv));
        const compiled = await spawned([executable], programs, bunEnv);
        expect(compiled.signal).toBeNull();
        // The compiler's output ran, and not the file as it is written: only the output asks for a cache.
        expect(compiled.stderr).toContain("[react-compiler] a cache of ");
        const plain = await spawned([bunExe(), "run", main], programs, bunEnv);
        expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
        expect(told({ ...compiled, stderr: compiled.stderr.replace(/^\[react-compiler\] .*\n/gm, "") })).toEqual(
          told(plain),
        );
      }),
    600_000,
  );

  const guards = `export function useIsString(value: unknown = "none", label: string = "x"): value is string {
  "use memo";
  return typeof value === "string" && label.length > 0;
}
export function useAssertedString(value: unknown = "none", label: string = "x"): asserts value is string {
  "use memo";
  if (typeof value !== "string" || label.length === 0) throw new TypeError("not a string");
}
export function useIsSecondString(label: string = "x", value: unknown): value is string {
  "use memo";
  return typeof value === "string" && label.length > 0;
}
`;

  test.concurrent(
    "in a test run",
    () =>
      slot(async () => {
        using project = tempDir("aot-react-compiler-type-guards-in-a-test-run", {
          "guards.tsx": guards,
          "guards.test.ts": `import { test } from "bun:test";
import { useAssertedString, useIsSecondString, useIsString } from "./guards";
test("guards", () => {
  const [guarded, asserted, second]: unknown[] = ["guarded", "asserted", "second"];
  useAssertedString(asserted, "b");
  console.log("told:", useIsString(guarded, "b") ? guarded.length : -1, asserted.toUpperCase(), useIsSecondString("b", second) ? second.length : -1);
});
`,
        });
        const run = async (flags: string[]) => {
          const command = [bunExe(), "test", ...flags, "--react-compiler", "./guards.test.ts"];
          const { stdout, stderr, exitCode } = await spawned(command, String(project), bunEnv);
          return { told: stdout.match(/^told: .*$/gm), typeErrors: (stdout + stderr).match(/\bTS\d+: .*/g), exitCode };
        };
        expect(await run([])).toEqual({ told: ["told: 7 ASSERTED 6"], typeErrors: null, exitCode: 0 });
        expect(await run(["--aot"])).toEqual({ told: ["told: 7 ASSERTED 6"], typeErrors: null, exitCode: 0 });
      }),
    600_000,
  );

  test.concurrent(
    "the .aot.ts file of bun build --dts",
    () =>
      slot(async () => {
        const compilerOptions = { strict: true, jsx: "react-jsx" };
        using project = tempDir("aot-react-compiler-type-guards-dts", {
          "tsconfig.json": JSON.stringify({
            compilerOptions: { ...compilerOptions, moduleResolution: "bundler", types: [] },
          }),
          "package.json": JSON.stringify({ name: "guards", compilerOptions }),
          "src/guards.tsx": guards,
          "src/index.ts": `import { useAssertedString, useIsSecondString, useIsString } from "./guards";
export function sizes(first: unknown, second: unknown, third: unknown): number[] {
  useAssertedString(second, "b");
  return [useIsString(first, "b") ? first.length : 0, second.length, useIsSecondString("b", third) ? third.length : 0];
}
`,
        });
        const flags = ["--dts", "--target=bun", "--react-compiler"];
        const command = [bunExe(), "build", "./src/index.ts", "--outdir", "out", ...flags];
        const { stderr, signal, exitCode } = await spawned(command, String(project), bunEnv);
        // With a type error in it the .aot.ts file is left out, and the build warns.
        const warnings = stderr.match(/^warn: .*$/gm);
        expect({ warnings, signal, exitCode }).toEqual({ warnings: null, signal: null, exitCode: 0 });
        const typed = readFileSync(join(String(project), "out/index.aot.ts"), "utf8");
        const hooks = [...typed.matchAll(/^function (use\w+)\((.*)\): (.*) \{$/gm)].map(
          ([, hook, parameters, returns]) => ({
            hook,
            parameters: parameters.split(", ").map(parameter => /^\w+/.exec(parameter)![0]),
            returns,
          }),
        );
        expect(hooks).toEqual([
          { hook: "useIsString", parameters: ["t0", "t1"], returns: "t0 is string" },
          { hook: "useAssertedString", parameters: ["t0", "t1"], returns: "asserts t0 is string" },
          { hook: "useIsSecondString", parameters: ["t0", "value"], returns: "value is string" },
        ]);
      }),
    600_000,
  );
});
