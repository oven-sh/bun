// A build with `--explain` counts the bytes of code by operation and form. Each emitter says which form it writes, and the row of the operation in the engine's schema (aot/ir/schema) names
// the forms that there are. A form that no row names is marked in the report, and a compiler that checks itself (assertions, ASAN, BUN_JSC_verifyAOTMachineCode=1) stops the build there.
// The library ships with Bun and is the same in every program. So it is asked here, once for all programs, and the variable makes every kind of Bun stop as one with assertions does.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("no emitter writes a form that the schema does not name", async () => {
  const names = builtinModules.filter(name => !name.startsWith("bun:internal"));
  const program = `function name() {
${names.map(name => `  require(${JSON.stringify(name)});`).join("\n")}
}
if (process.argv.length > 9) name();
`;
  using dir = tempDir("aot-forms-of-the-library", { "app.js": program });
  const cwd = String(dir);
  const { stdout, stderr, exitCode } = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--explain=forms",
      "app.js",
      "--outfile",
      join(cwd, isWindows ? "app.exe" : "app"),
    ],
    cwd,
    { ...bunEnv, BUN_JSC_verifyAOTMachineCode: "1" },
  );
  expect(stderr).not.toMatch(/^error\b/m);
  expect(exitCode).toBe(0);

  const rows = (stdout + stderr).split("\n").filter(line => line.startsWith("aot: forms: "));
  expect(rows.filter(row => row.includes("not named in the schema"))).toEqual([]);
  // The context of node:util's inspect() lists `circular?` and `seenRefs?`, which no maker gives: they are read in line, outside of loops too.
  expect(rows.filter(row => row.startsWith("aot: forms: GetSlotOrUndefined FieldLeftOutByMakers open: "))).toHaveLength(
    1,
  );
});
