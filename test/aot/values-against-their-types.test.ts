// Each program under ./values-against-their-types puts a value where its declared type does not allow it, by a road the type
// checker accepts: a covariant array, JSON.parse, a definite assignment assertion, a stale narrowing. The first argument says
// whether it does so ("0": it does not). Nothing throws because of a type: an executable built with --aot does what plain Bun
// does. `departures` lists every run that differs, with what the executable prints: only the text of an error's message does.
import { expect } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { describe, test } from "./supported";

const folder = join(import.meta.dir, "values-against-their-types");
const programs = readdirSync(folder)
  .filter(name => name.endsWith(".ts"))
  .map(name => name.slice(0, -3))
  .sort();

const readsOfUndefined =
  "TypeError: undefined is not an object (evaluating 'undefined.v')\nTypeError: undefined is not an object (evaluating 'undefined.length')\n";
const departures: Record<string, Record<string, string>> = {
  "error-message": { "1": readsOfUndefined, "2": readsOfUndefined, "7": readsOfUndefined },
};

async function run(cmd: string[]) {
  await using proc = Bun.spawn({ cmd, env: bunEnv, cwd: folder, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

describe.concurrent("compile/aot/values-against-their-types", () => {
  test.each(programs)(
    "%s",
    async program => {
      using dir = tempDir("aot-values-against-their-types", {});
      const executable = join(String(dir), "program");
      const build = await run([bunExe(), "build", "--compile", "--aot", `${program}.ts`, "--outfile", executable]);
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
        stderr: expect.not.stringMatching(/^error\b/m),
        exitCode: 0,
      });
      for (const argument of ["0", "1", "2", "7"]) {
        const plain = await run([bunExe(), `${program}.ts`, argument]);
        expect({ argument, exitCode: plain.exitCode }).toEqual({ argument, exitCode: 0 });
        const compiled = await run([executable, argument]);
        const stdout = departures[program]?.[argument] ?? plain.stdout;
        expect({
          argument,
          stdout: compiled.stdout,
          exitCode: compiled.exitCode,
          signalCode: compiled.signalCode,
        }).toEqual({ argument, stdout, exitCode: 0, signalCode: null });
      }
    },
    120_000,
  );
});
