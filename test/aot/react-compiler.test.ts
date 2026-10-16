// With the React Compiler on, the code of a component file is the compiler's output, which --aot compiles as untyped code, and the file
// as it is written only says what the types are. Each program in ./react-compiler runs under plain Bun and as an --aot executable that
// ./react-compiler/build.ts has built, and prints the same. ./react-compiler/react-stand-in has the three modules that the output imports.
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "./run-programs";

const programs = join(import.meta.dir, "react-compiler");

describe.skipIf(!!unsupported)("compile/aot/react-compiler", () => {
  const folder = String(tempDir("aot-react-compiler", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test.concurrent.each(["stores-through-a-wider-type", "types-held-by-what-a-component-makes", "a-literal-with-a-getter-exported-by-a-component-file", "a-component-file-that-needs-no-cache"])(
    "%s",
    name =>
      slot(async () => {
        const main = join(programs, name, "main.ts");
        const executable = join(folder, name);
        built(await spawned([bunExe(), "run", join(programs, "build.ts"), main, executable], programs, bunEnv));
        const compiled = await spawned([executable], programs, bunEnv);
        expect(compiled.signal).toBeNull();
        // The compiler's output ran, and not the file as it is written: only the output asks for a cache.
        expect(compiled.stderr).toContain("[react-compiler] a cache of ");
        const plain = await spawned([bunExe(), "run", main], programs, bunEnv);
        expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
        expect(told({ ...compiled, stderr: compiled.stderr.replace(/^\[react-compiler\] .*\n/gm, "") })).toEqual(told(plain));
      }),
    600_000,
  );

  test(
    "component-files-beside-a-slow-plugin",
    () =>
      slot(async () => {
        const main = join(programs, "component-files-beside-a-slow-plugin", "main.ts");
        const executable = join(folder, "component-files-beside-a-slow-plugin");
        built(await spawned([bunExe(), "run", join(programs, "build-with-a-slow-plugin.ts"), main, executable], programs, bunEnv));
        const compiled = await spawned([executable], programs, bunEnv);
        expect(compiled.signal).toBeNull();
        // Each of the three components ran as the compiler's output.
        expect(compiled.stderr.match(/^\[react-compiler\] a cache of /gm)?.length).toBe(3);
        const plain = await spawned([bunExe(), "run", main], programs, bunEnv);
        expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
        expect(told({ ...compiled, stderr: compiled.stderr.replace(/^\[react-compiler\] .*\n/gm, "") })).toEqual(told(plain));
      }),
    600_000,
  );

  test(
    "a-type-error-in-a-component-file",
    () =>
      slot(async () => {
        const main = join(programs, "a-type-error-in-a-component-file", "main.ts");
        const build = await spawned([bunExe(), "run", join(programs, "build.ts"), main, join(folder, "a-type-error-in-a-component-file")], programs, bunEnv);
        expect({ errors: build.stderr.match(/\bTS\d+: .*/g), signal: build.signal, exitCode: build.exitCode }).toEqual({
          errors: [
            "TS2322: Type 'string' is not assignable to type 'number'.",
            "TS2322: Type 'string' is not assignable to type 'boolean'.",
            "TS2345: Argument of type 'string' is not assignable to parameter of type 'symbol'.",
          ],
          signal: null,
          exitCode: 1,
        });
      }),
    600_000,
  );
});
