// Each program under ./values-against-their-types puts a value where its declared type does not allow it, by a road the type
// checker accepts: a covariant array, JSON.parse, a definite assignment assertion, a stale narrowing. The first argument says
// whether it does so ("0": it does not). An executable built with --aot either does what plain Bun does or stops at the value
// with a TypeError: `departures` lists every run that differs, with what the executable prints and its exit code.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const folder = join(import.meta.dir, "values-against-their-types");
const programs = readdirSync(folder)
  .filter(name => name.endsWith(".ts"))
  .map(name => name.slice(0, -3))
  .sort();

const readsOfUndefined =
  "TypeError: Cannot read properties of undefined (reading 'v')\nTypeError: Cannot read properties of undefined (reading 'length')\n";
const departures: Record<string, Record<string, { stdout: string; exitCode: number }>> = {
  "covariant-array": { "1": { stdout: "-1\n", exitCode: 0 } },
  "covariant-member": { "1": { stdout: "-1\n", exitCode: 0 } },
  "define-property": { "1": { stdout: "", exitCode: 1 } },
  "error-message": {
    "1": { stdout: readsOfUndefined, exitCode: 0 },
    "2": { stdout: readsOfUndefined, exitCode: 0 },
    "7": { stdout: readsOfUndefined, exitCode: 0 },
  },
  "json-parse": { "1": { stdout: "", exitCode: 1 } },
  "optional-through-wider-type": { "1": { stdout: "caught\n", exitCode: 0 } },
};

async function run(cmd: string[]) {
  await using proc = Bun.spawn({ cmd, env: bunEnv, cwd: folder, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

describe.concurrent("compile/aot/values-against-their-types", () => {
  test.each(programs)("%s", async program => {
    using dir = tempDir("aot-values-against-their-types", {});
    const executable = join(String(dir), "program");
    const build = await run([bunExe(), "build", "--compile", "--aot", `${program}.ts`, "--outfile", executable]);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
    for (const argument of ["0", "1", "2", "7"]) {
      const plain = await run([bunExe(), `${program}.ts`, argument]);
      expect({ argument, exitCode: plain.exitCode }).toEqual({ argument, exitCode: 0 });
      const compiled = await run([executable, argument]);
      const expected = departures[program]?.[argument] ?? { stdout: plain.stdout, exitCode: 0 };
      expect({ argument, stdout: compiled.stdout, exitCode: compiled.exitCode, signalCode: compiled.signalCode }).toEqual({ argument, ...expected, signalCode: null });
      if (expected.exitCode) expect(compiled.stderr).toContain("(bun --aot: ");
    }
  }, 120_000);
});
