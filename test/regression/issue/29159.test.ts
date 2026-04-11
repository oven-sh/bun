import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/29159
// `data:application/javascript` data URLs must be parsed as plain JavaScript.
// TypeScript-only syntax like `export enum` must be rejected with SyntaxError,
// matching Node.js semantics. Previously Bun ran data URLs through its default
// tsx loader, which silently accepted TS syntax.

test("data:application/javascript rejects TypeScript enum syntax", async () => {
  // base64 of:
  //   export const a = "a";
  //
  //   export enum A {
  //     A,
  //     B,
  //     C,
  //   }
  const dataUrl =
    "data:application/javascript;base64,ZXhwb3J0IGNvbnN0IGEgPSAiYSI7CgpleHBvcnQgZW51bSBBIHsKICBBLAogIEIsCiAgQywKfQo=";

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await import(${JSON.stringify(dataUrl)});`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toMatch(/SyntaxError|Unexpected|enum/);
  expect(exitCode).not.toBe(0);
});

test("data:text/javascript rejects TypeScript enum syntax", async () => {
  const dataUrl = "data:text/javascript,export%20enum%20A%7BA%7D";

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await import(${JSON.stringify(dataUrl)});`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toMatch(/SyntaxError|Unexpected|enum/);
  expect(exitCode).not.toBe(0);
});

test("data:application/javascript still runs valid JavaScript", async () => {
  // base64 of: export const value = 42;
  const dataUrl = "data:application/javascript;base64,ZXhwb3J0IGNvbnN0IHZhbHVlID0gNDI7";

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const m = await import(${JSON.stringify(dataUrl)}); console.log(m.value);`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("42");
  expect(exitCode).toBe(0);
});
