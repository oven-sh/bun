import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("calling .bytes() twice on a Response with async iterable body does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function* gen() { yield new Uint8Array([1, 2, 3]); }
      const r = new Response({ [Symbol.asyncIterator]: () => gen() });
      r.bytes();
      r.bytes();
      Bun.gc(true);
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

test("calling .text() twice on a Response with async iterable body does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function* gen() { yield new Uint8Array([72, 105]); }
      const r = new Response({ [Symbol.asyncIterator]: () => gen() });
      r.text();
      r.text();
      Bun.gc(true);
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

test("calling .arrayBuffer() twice on a Response with async iterable body does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function* gen() { yield new Uint8Array([1, 2, 3]); }
      const r = new Response({ [Symbol.asyncIterator]: () => gen() });
      r.arrayBuffer();
      r.arrayBuffer();
      Bun.gc(true);
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
