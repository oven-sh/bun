// The cases of ./react-compiler.test.ts that run one by one. They have a file of their own because CI's runner tries a file that fails four times, the whole of it.
import { describe, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "./harness/commands";
import { afterAll, test } from "./harness/default-timeout";

const programs = join(import.meta.dir, "react-compiler");

describe.skipIf(!!unsupported)("compile/aot/react-compiler", () => {
  const folder = String(tempDir("aot-react-compiler", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test(
    "component-files-with-slow-plugin",
    () =>
      slot(async () => {
        const main = join(programs, "component-files-with-slow-plugin", "main.ts");
        const executable = join(folder, "component-files-with-slow-plugin");
        built(
          await spawned(
            [bunExe(), "run", join(programs, "build-with-slow-plugin.ts"), main, executable],
            programs,
            bunEnv,
          ),
        );
        const compiled = await spawned([executable], programs, bunEnv);
        expect(compiled.signal).toBeNull();
        // Each of the three components ran as the compiler's output.
        expect(compiled.stderr.match(/^\[react-compiler\] a cache of /gm)?.length).toBe(3);
        const plain = await spawned([bunExe(), "run", main], programs, bunEnv);
        expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
        expect(told({ ...compiled, stderr: compiled.stderr.replace(/^\[react-compiler\] .*\n/gm, "") })).toEqual(
          told(plain),
        );
      }),
    600_000,
  );

  test(
    "type-error-in-component-file",
    () =>
      slot(async () => {
        const main = join(programs, "type-error-in-component-file", "main.ts");
        const build = await spawned(
          [bunExe(), "run", join(programs, "build.ts"), main, join(folder, "type-error-in-component-file")],
          programs,
          bunEnv,
        );
        expect({ errors: build.stderr.match(/\bTS\d+: .*/g), signal: build.signal, exitCode: build.exitCode }).toEqual({
          // The helper's error. The two inside the component are not reported: the React Compiler has replaced that function, and what is checked is no longer what was written.
          errors: ["TS2322: Type 'string' is not assignable to type 'number'."],
          signal: null,
          exitCode: 1,
        });
      }),
    600_000,
  );
});
