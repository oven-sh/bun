import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for ENG-22787
// When Symbol.toPrimitive is set to a class on an object, and that object is
// passed to functions that try to format it for an error message, it should
// not crash with an assertion failure and should properly display the value.

test("expect.assertions with RegExp having Symbol.toPrimitive class does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const abc = /foo.*bar/gi;
abc[Symbol.toPrimitive] = class {};
try {
  Bun.jest(abc).expect.assertions(abc);
} catch (e) {
  // Should show the regex pattern, not crash or show {f}
  console.log("error:", e.message.includes("/foo.*bar/gi"));
}
console.log("done");
`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("error: true\ndone");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("console.log with RegExp having Symbol.toPrimitive class does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const abc = /test/gi;
abc[Symbol.toPrimitive] = class {};
console.log(abc);
`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("/test/gi");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("Bun.inspect with RegExp having Symbol.toPrimitive class does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const abc = /hello/;
abc[Symbol.toPrimitive] = class {};
console.log(Bun.inspect(abc));
`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("/hello/");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("expect.assertions with StringObject having Symbol.toPrimitive class does not crash", async () => {
  // StringObject with broken toPrimitive should not crash when formatting error messages.
  // The error message may show {f} as a fallback, but no assertion failure should occur.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const str = new String("hello");
str[Symbol.toPrimitive] = class {};
try {
  Bun.jest(str).expect.assertions(str);
} catch (e) {
  // Should not crash - error message may show {f} as fallback
  console.log("caught");
}
console.log("done");
`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("caught\ndone");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
