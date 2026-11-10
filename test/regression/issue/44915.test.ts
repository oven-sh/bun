import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A class decorator that returns a new class replaces the class binding inside
// the class body too. The argument of a member decorator read it through the
// original class in 1.4.3 (a regression from 1.4.2). The other body positions
// are covered in test/bundler/transpiler/es-decorators.test.ts.
test("a member decorator argument sees the class its class decorator returns", async () => {
  using dir = tempDir("issue-44915", {
    "repro.ts": `
      function replace(cls: any, _ctx: ClassDecoratorContext) {
        return class extends cls {};
      }

      let thunk!: () => unknown;
      function capture(fn: () => unknown) {
        thunk = fn;
        return (_value: undefined, _ctx: ClassFieldDecoratorContext) => {};
      }

      @replace
      class Model {
        @capture(() => Model)
        field = 1;
      }

      console.log("decorator argument:", thunk() === Model);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "repro.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("decorator argument: true\n");
  expect(exitCode).toBe(0);
});
