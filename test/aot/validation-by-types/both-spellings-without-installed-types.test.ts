// `Bun.validate<T>()` and `import { validate } from "bun"` are the same function to the compiler, also where no types of Bun are
// installed: the only declarations of Bun's are those that the compiler brings along.
import { expect } from "bun:test";
import { test } from "../supported";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

const program = `
import { parse, safeValidate, schema, validate } from "bun";
import type { Int, Min } from "bun";

interface Point {
  x: number & Int & Min<0>;
  y: number;
}
interface Named {
  name: string & Bun.MinLength<2>;
  at: Point;
}

function shown(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}

const good: unknown = { x: 1, y: 2.5, z: "left out" };
const bad: unknown = { x: -1, y: "2" };
console.log(shown(() => validate<Point>(good)), shown(() => Bun.validate<Point>(good)));
console.log(shown(() => validate<Point>(bad)), "|", shown(() => Bun.validate<Point>(bad)));
console.log(shown(() => safeValidate<Point>(good)), shown(() => Bun.safeValidate<Point>(good)));
console.log(shown(() => safeValidate<Point>(bad).success), shown(() => Bun.safeValidate<Point>(bad).success));
console.log(shown(() => parse<Point>('{"x":3,"y":4}')), shown(() => Bun.parse<Point>('{"x":3,"y":4}')));
console.log(shown(() => parse<Point>('{"x":3}')), "|", shown(() => Bun.parse<Point>('{"x":3}')));
console.log(shown(() => schema<Point>()["~standard"].validate(good)), shown(() => Bun.schema<Point>()["~standard"].validate(good)));
console.log(shown(() => Bun.validate<Named>({ name: "ab", at: good })), shown(() => Bun.safeValidate<Named>({ name: "a", at: good }).success));
`;

const expected = `{"x":1,"y":2.5} {"x":1,"y":2.5}
TypeError: x: Invalid input: expected number to be >=0 | TypeError: x: Invalid input: expected number to be >=0
{"success":true,"data":{"x":1,"y":2.5}} {"success":true,"data":{"x":1,"y":2.5}}
false false
{"x":3,"y":4} {"x":3,"y":4}
TypeError: y: Invalid input: expected number, received undefined | TypeError: y: Invalid input: expected number, received undefined
{"value":{"x":1,"y":2.5}} {"value":{"x":1,"y":2.5}}
{"name":"ab","at":{"x":1,"y":2.5}} false
`;

function folder() {
  return tempDir("both-spellings-without-installed-types", {
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
