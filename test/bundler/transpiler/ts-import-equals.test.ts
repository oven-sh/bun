import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("TypeScript import-equals elision", () => {
  async function run(src: string) {
    using dir = tempDir("ts-import-equals", { "index.ts": src });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("one elided type alias does not duplicate the trailing statement", async () => {
    const { stdout, stderr, exitCode } = await run(
      `namespace Src { export const val = 5; export type T = string }
import V = Src.val;
import T = Src.T;
let n = 0;
n++;
console.log("tail", n, V);
`,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("tail 1 5\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("two elided type aliases do not duplicate the trailing two statements", async () => {
    const { stdout, stderr, exitCode } = await run(
      `namespace Src { export const val = 5; export type T = string; export type U = number }
import V = Src.val;
import T = Src.T;
import U = Src.U;
console.log("A");
console.log("B", V);
`,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("A\nB 5\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("chained unused import-equals are fully elided", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const foo = {
  a: { b: { c: 123 } },
  get x(): any { throw new Error("x should not be evaluated") },
};
import a = foo.a
import b = a.b
import c = b.c

import x = foo.x
import y = x.y
import z = y.z

console.log("bar", c);
`,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("bar 123\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun build --target=bun emits each statement once", async () => {
    using dir = tempDir("ts-import-equals-build", {
      "index.ts": `namespace Src { export const val = 5; export type T = string; export type U = number }
import V = Src.val;
import T = Src.T;
import U = Src.U;
console.log("A");
console.log("B", V);
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--target=bun", "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.match(/console\.log\("A"\)/g)?.length).toBe(1);
    expect(stdout.match(/console\.log\("B", V\)/g)?.length).toBe(1);
    expect(stdout).not.toContain("Src.T");
    expect(stdout).not.toContain("Src.U");
    expect(exitCode).toBe(0);
  });
});
