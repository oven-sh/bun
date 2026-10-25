// `JSON.parse<T>(text)` validates, and the namespace `Schema` of "bun" is known by import and through the global `Bun`, also where
// no types of Bun are installed: the only declarations of Bun's are those that the compiler brings along.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { test } from "../supported";

const program = `
import { JSON } from "bun"; import type { Schema } from "bun";

interface Point {
  x: number & Schema.Int & Schema.Min<0>;
  y: number;
}
interface Named {
  name: string & Bun.Schema.MinLength<2>;
  at: Point;
}

function shown(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error) {
    const issues: Schema.Issue[] | undefined = (error as Partial<Schema.Error>).issues;
    return (error as Error).name + ": " + (error as Error).message + (issues ? " [" + issues.map(issue => issue.path.join(".")).join() + "]" : "");
  }
}

console.log(shown(() => JSON.parse<Point>('{"x":1,"y":2.5,"z":"kept"}')));
console.log(shown(() => JSON.parse<Point>('{"x":-1,"y":"2"}')));
console.log(shown(() => JSON.parse<Point>('{"x":3}')));
console.log(shown(() => JSON.parse<Point>('{"x":3')));
console.log(shown(() => JSON.parse<Named>('{"name":"ab","at":{"x":1,"y":2}}')), shown(() => JSON.parse<Named>('{"name":"a","at":{"x":1,"y":2}}')));
console.log(shown(() => globalThis.JSON.parse('{"x":-1}')), shown(() => globalThis.JSON.parse('{"x":-1}') as Point));
`;

const expected = `{"x":1,"y":2.5,"z":"kept"}
TypeError: Expected x to be at least 0 (and 1 more) [x,y]
TypeError: Missing required property y [y]
SyntaxError: JSON Parse error: Expected '}'
{"name":"ab","at":{"x":1,"y":2}} TypeError: Expected name to have at least 2 characters [name]
{"x":-1} {"x":-1}
`;

function folder() {
  return tempDir("json-parse-type-argument-without-installed-types", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, lib: ["esnext"], typeRoots: ["./no-types-here"] },
    }),
    "program.ts": program,
  });
}

test("in an executable", async () => {
  using dir = folder();
  const outfile = join(String(dir), "program" + (isWindows ? ".exe" : ""));
  const { stderr: said, exitCode: built } = await run(
    [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", outfile],
    String(dir),
  );
  expect({ said: built ? said : "", built }).toEqual({ said: "", built: 0 });
  const { stdout, exitCode } = await run([outfile], String(dir));
  expect({ stdout, exitCode }).toEqual({ stdout: expected, exitCode: 0 });
}, 120_000);

test("under bun run --aot", async () => {
  using dir = folder();
  const { stdout, exitCode } = await run([bunExe(), "run", "--aot", "./program.ts"], String(dir));
  expect({ stdout, exitCode }).toEqual({ stdout: expected, exitCode: 0 });
}, 120_000);
