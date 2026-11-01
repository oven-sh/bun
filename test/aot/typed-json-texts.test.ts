import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { programs } from "./harness/json-texts";
import { run } from "./harness/run";
import { partOfGrid } from "./harness/ways";
import { describe, test } from "./supported";

const grid = "every small JSON text parsed under a declared type";
describe.concurrent(grid, () => {
  const part = partOfGrid(grid, programs(), 6, program => program.name);
  test.each(part.map(program => [program.name, program.text] as const))("%s", async (name, text) => {
    using dir = tempDir("aot-json-texts", { "main.ts": text, "tsconfig.json": "{}" });
    const plain = await run([bunExe(), "run", "./main.ts"], String(dir));
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "--explain=statistics", "./main.ts", "--outfile", "compiled.exe"],
      String(dir),
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    // The build makes no parser for a table of any names, nor for a union of records.
    const parsers = Number((built.stdout + built.stderr).match(/^\s*ParsersCreated (\d+)/m)?.[1]);
    expect(parsers > 0).toBe(name !== "table" && name !== "union");
    const compiled = await run([join(String(dir), "compiled.exe")], String(dir));
    expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const expected = plain.stdout.split("\n");
    const printed = compiled.stdout.split("\n");
    expect(expected.length).toBeGreaterThan(5000);
    expect(
      expected.flatMap((line, i) => (printed[i] === line ? [] : [{ expected: line, printed: printed[i] }])),
    ).toEqual([]);
  });
});
