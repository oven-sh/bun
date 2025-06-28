import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("does not segfault", () => {
  const dir = tempDirWithFiles("10887", {
    "index.ts": `
      function deco() {
        console.log('deco init');
        return (target, key) => console.log('deco call');
      }

      enum Enum {
        ONE = '1',
      }

      class Example {
        @deco()
        [Enum.ONE]: string;

        constructor() {
          this[Enum.ONE] = 'Hello World';
        }
      }

      class Foo {
        foo;
      }
    `,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "index.ts"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.stdout.toString()).toBe("deco init\ndeco call\n");
  expect(result.exitCode).toBe(0);
});
