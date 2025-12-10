// https://github.com/oven-sh/bun/issues/24752
// Test that cc() works with bun build --compile
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";

test("cc() works with bun build --compile", async () => {
  using dir = tempDir("test-cc-compile", {
    "hello.ts": `
import { cc } from "bun:ffi";
import source from "./hello.c" with { type: "file" };

const {
  symbols: { hello },
} = cc({
  source,
  symbols: {
    hello: {
      args: [],
      returns: "int",
    },
  },
});

console.log("What is the answer to the universe?", hello());
`,
    "hello.c": `
int hello() {
  return 42;
}
`,
  });

  const outfile = join(String(dir), "hello");

  // Build the standalone executable
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--target", "bun", "--outfile", outfile, "--entrypoint", "hello.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  if (exitCode1 !== 0) {
    console.log("Build stdout:", stdout1);
    console.log("Build stderr:", stderr1);
  }

  expect(exitCode1).toBe(0);

  // Run the compiled executable
  await using proc2 = Bun.spawn({
    cmd: [outfile],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(normalizeBunSnapshot(stdout2, dir)).toMatchInlineSnapshot(`"What is the answer to the universe? 42"`);

  expect(exitCode2).toBe(0);
});

test("cc() works with multiple source files in bun build --compile", async () => {
  using dir = tempDir("test-cc-compile-multi", {
    "main.ts": `
import { cc } from "bun:ffi";
import add_source from "./add.c" with { type: "file" };
import mul_source from "./mul.c" with { type: "file" };

const {
  symbols: { add, multiply },
} = cc({
  source: [add_source, mul_source],
  symbols: {
    add: {
      args: ["int", "int"],
      returns: "int",
    },
    multiply: {
      args: ["int", "int"],
      returns: "int",
    },
  },
});

console.log("5 + 3 =", add(5, 3));
console.log("5 * 3 =", multiply(5, 3));
`,
    "add.c": `
int add(int a, int b) {
  return a + b;
}
`,
    "mul.c": `
int multiply(int a, int b) {
  return a * b;
}
`,
  });

  const outfile = join(String(dir), "main");

  // Build the standalone executable
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--target", "bun", "--outfile", outfile, "--entrypoint", "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  if (exitCode1 !== 0) {
    console.log("Build stdout:", stdout1);
    console.log("Build stderr:", stderr1);
  }

  expect(exitCode1).toBe(0);

  // Run the compiled executable
  await using proc2 = Bun.spawn({
    cmd: [outfile],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  const lines = normalizeBunSnapshot(stdout2, dir).split("\n").filter(Boolean);
  expect(lines).toEqual(["5 + 3 = 8", "5 * 3 = 15"]);

  expect(exitCode2).toBe(0);
});
