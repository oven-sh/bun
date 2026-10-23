// `JSON.parse<T>(text)` validates, and the namespace `Schema` of "bun" is known by import and through the global `Bun`, also where
// no types of Bun are installed: the only declarations of Bun's are those that the compiler brings along.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "../supported";

const program = `
import type { Schema } from "bun";

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
console.log(shown(() => JSON.parse('{"x":-1}')), shown(() => JSON.parse('{"x":-1}') as Point));
`;

const expected = `{"x":1,"y":2.5,"z":"kept"}
TypeError: x: expected number to be >=0 (and 1 more) [x,y]
TypeError: y: expected number, received undefined [y]
SyntaxError: JSON Parse error: Expected '}'
{"name":"ab","at":{"x":1,"y":2}} TypeError: name: expected string to have >=2 characters [name]
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
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", outfile],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [said, built] = await Promise.all([build.stderr.text(), build.exited]);
  expect({ said: built ? said : "", built }).toEqual({ said: "", built: 0 });
  await using ran = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([ran.stdout.text(), ran.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: expected, exitCode: 0 });
}, 120_000);

test("under bun run --aot", async () => {
  using dir = folder();
  await using ran = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", "./program.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([ran.stdout.text(), ran.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: expected, exitCode: 0 });
}, 120_000);
