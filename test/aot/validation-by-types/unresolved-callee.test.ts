// The compiler can't always tell which function `x.parse<T>(text)` calls. It warns, and text that is no `T` still never comes back as one.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { test } from "../supported";

const show = `
interface User { id: number }
function show(run: () => unknown) {
  try {
    console.log("returned", globalThis.JSON.stringify(run()));
  } catch (error) {
    console.log("threw", (error as Error).name, "issues" in (error as Error) ? "with issues" : "without issues");
  }
}
`;

async function compileAndRun(program: string) {
  using dir = tempDir("unresolved-callee", { "program.ts": program });
  const outfile = join(String(dir), "program" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", outfile], String(dir));
  expect(built.exitCode).toBe(0);
  const compiled = await run([outfile], String(dir));
  const plain = await run([bunExe(), "run", "./program.ts"], String(dir));
  return { warnings: built.stderr.match(/warn: TS100514: .*/g) ?? [], compiled: compiled.stdout, plain: plain.stdout };
}

test('JSON.parse from "bun" throws when the compiler can\'t resolve the callee', async () => {
  const { warnings, compiled, plain } = await compileAndRun(`
import { JSON } from "bun";
${show}
function pick<T>(value: T) { return value; }
const list = [JSON];
show(() => pick(JSON).parse<User>('{"id":1}'));
show(() => pick(JSON).parse<User>('{"id":"one"}'));
show(() => list[0].parse<User>('{"id":1}'));
show(() => list[0].parse<User>('{"id":"one"}'));
`);
  expect(warnings.length).toBe(4);
  expect(warnings[0]).toContain("the call throws at run time");
  expect(compiled).toBe("threw TypeError without issues\n".repeat(4));
  expect(plain).toBe(compiled);
}, 120_000);

test('the result of another function declared as JSON.parse from "bun" is validated', async () => {
  const { warnings, compiled } = await compileAndRun(`
import { JSON } from "bun";
${show}
const own = { parse: (text: string) => globalThis.JSON.parse(text) } as unknown as typeof JSON;
const list = [own];
show(() => list[0].parse<User>('{"id":1}'));
show(() => list[0].parse<User>('{"id":"one"}'));
`);
  expect(warnings.length).toBe(2);
  expect(warnings[0]).toContain("its result is validated");
  expect(compiled).toBe('returned {"id":1}\nthrew TypeError with issues\n');
}, 120_000);
