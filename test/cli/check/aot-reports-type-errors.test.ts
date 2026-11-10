import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

const files = {
  "app.ts": `import { label } from "./label";
import { untyped } from "./untyped.js";
import "./nothing-used";
const count: number = "one";
function neverCalled() {
  const inside: boolean = 1;
  return inside;
}
export const all = [count, label, untyped];
`,
  "label.ts": `export const label: string = 1;\n`,
  "nothing-used.ts": `export const unused: string = 1;\n`,
  // No type is written here, so there is none to be wrong.
  "untyped.js": `export const untyped = Math.max("one");\n`,
  "not-imported.ts": `export const alone: string = 1;\n`,
};

async function check(cwd: string, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), "check", "--no-pretty", ...args],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { errors: (stdout + stderr).match(/^\S+\(\d+,\d+\): error TS\d+/gm) ?? [], exitCode };
}

// A build computes a type only where it needs one. `bun check --aot` is asked what is wrong with the program.
test.concurrent.each(["--threads=1", "--threads=4"])(
  "bun check --aot reports the type errors of the program's own TypeScript, as bun check does, with %s",
  async threads => {
    using dir = tempDir("check-aot-reports-type-errors", files);
    const plain = await check(String(dir), threads, "app.ts");
    expect(plain).toEqual({
      errors: [
        "app.ts(4,7): error TS2322",
        "app.ts(6,9): error TS2322",
        "label.ts(1,14): error TS2322",
        "nothing-used.ts(1,14): error TS2322",
      ],
      exitCode: 1,
    });
    expect(await check(String(dir), threads, "--aot", "app.ts")).toEqual(plain);
  },
  longLimit,
);
