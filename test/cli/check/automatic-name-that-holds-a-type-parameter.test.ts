import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["*.ts"] });

// `held` has an automatic type, and what was assigned to it is a `T extends A | B`. Where a member is read off `held` it is
// `A | B`, and where nothing is expected of it, `T`: what a walk back to the assignment finds depends on where the reference
// stands. `bun check` lets the references to such a name share what their walks find, but not that.
const source = `export {};
class A { weigh() { return 1; } }
class B { weigh() { return "b"; } }
function memberFirst<T extends A | B>(n: number, given: T) {
  let held;
  held = given as T;
  if (n) n++;
  { const member: never = held.weigh; }
  { const list = [held]; const whole: never = list; }
  { const member: never = held.weigh; }
}
function wholeFirst<T extends A | B>(n: number, given: T) {
  let held;
  held = given as T;
  if (n) n++;
  { const list = [held]; const whole: never = list; }
  { const member: never = held.weigh; }
  { const list = [held]; const whole: never = list; }
}
function behindBranches<T extends A | B>(n: number, given: T) {
  let held;
  if (n > 1) held = given as T; else held = given as T;
  if (n) n++;
  { const member: never = held.weigh; }
  if (n) n++;
  { const list = [held]; const whole: never = list; }
  if (n) n++;
  { const member: never = held.weigh; }
  { const list = [held]; const whole: never = list; }
}
`;

test(
  "what a reference to an automatic name finds at an assignment of a type parameter depends on where it stands",
  async () => {
    using dir = tempDir("check-automatic-name-that-holds-a-type-parameter", {
      "tsconfig.json": tsconfig,
      "a.ts": source,
    });
    await using proc = spawn({
      cmd: [bunExe(), "check", "--no-pretty"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
    const types = (stdout + stderr).matchAll(
      /^a\.ts\((\d+),\d+\): error TS2322: Type '(.*)' is not assignable to type 'never'/gm,
    );
    const member = "(() => number) | (() => string)";
    expect(Array.from(types, ([, line, type]) => `${line}: ${type}`)).toEqual([
      `8: ${member}`,
      "9: T[]",
      `10: ${member}`,
      "16: T[]",
      `17: ${member}`,
      "18: T[]",
      `24: ${member}`,
      "26: T[]",
      `28: ${member}`,
      "29: T[]",
    ]);
  },
  longLimit,
);
