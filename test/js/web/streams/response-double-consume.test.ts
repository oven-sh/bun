import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("calling .bytes() twice on a Response with async iterable body does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function* gen() { yield new Uint8Array([1, 2, 3]); }
      const r = new Response({ [Symbol.asyncIterator]: () => gen() });
      const first = await r.bytes();
      try { await r.bytes(); } catch (e) { process.exit(0); }
      process.exit(1);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("calling .text() twice on a Response with async iterable body does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function* gen() { yield new Uint8Array([72, 105]); }
      const r = new Response({ [Symbol.asyncIterator]: () => gen() });
      const first = await r.text();
      try { await r.text(); } catch (e) { process.exit(0); }
      process.exit(1);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("calling .arrayBuffer() twice on a Response with async iterable body does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function* gen() { yield new Uint8Array([1, 2, 3]); }
      const r = new Response({ [Symbol.asyncIterator]: () => gen() });
      const first = await r.arrayBuffer();
      try { await r.arrayBuffer(); } catch (e) { process.exit(0); }
      process.exit(1);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
