import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";
import { spawned } from "../aot/run-programs";
import { canTrim, tempDirForAotBuilds } from "./compile-trim-features";

const program = `
  import { JSON } from "bun";
  import { validate } from "bun:bundle";
  console.log(validate<{ x: number }>({ x: 1 }).x, JSON.parse<{ x: number }>('{"x":2}').x);
  for (const check of [() => validate<{ x: number }>({ x: "one" }), () => JSON.parse<{ x: number }>('{"x":"two"}')]) {
    try {
      console.log("accepted", check());
    } catch (error) {
      console.log((error as Error).name);
    }
  }
`;

test.skipIf(!canTrim).each([[[] as string[]], [["--trim"]]])(
  "validate<T>() and JSON.parse<T>() work in bun build --compile %j",
  async flags => {
    using dir = tempDirForAotBuilds("compile-trim-validate", { "program.ts": program });
    const cwd = String(dir);
    const build = await spawned(
      [bunExe(), "build", "--compile", ...flags, "program.ts", "--outfile", "program"],
      cwd,
      bunEnv,
    );
    expect(build.stderr).not.toMatch(/^error\b/m);
    expect(build.exitCode).toBe(0);
    expect(await spawned([join(cwd, isWindows ? "program.exe" : "program")], cwd, bunEnv)).toMatchObject({
      stdout: "1 2\nTypeError\nTypeError\n",
      exitCode: 0,
    });
  },
  600_000,
);
