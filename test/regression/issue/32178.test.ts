// https://github.com/oven-sh/bun/issues/32178
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("top-level await resumes while an AsyncLocalStorage context is active", async () => {
  using dir = tempDir("issue-32178", {
    "entry.ts": `
      import { AsyncLocalStorage } from "node:async_hooks";
      const als = new AsyncLocalStorage();
      als.enterWith({ v: 42 });
      await Promise.resolve(1);
      console.log("after microtask await:", JSON.stringify(als.getStore()));
      await new Promise(r => setImmediate(r));
      console.log("after macrotask await:", JSON.stringify(als.getStore()));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The async context must also survive across the top-level awaits, like Node.
  expect({ stdout, exitCode }).toEqual({
    stdout: 'after microtask await: {"v":42}\nafter macrotask await: {"v":42}\n',
    exitCode: 0,
  });
});

test.concurrent("imported top-level-await module entering an AsyncLocalStorage context", async () => {
  using dir = tempDir("issue-32178-import", {
    "main.ts": `
      import { store } from "./tla.ts";
      console.log("imported:", JSON.stringify(store));
    `,
    "tla.ts": `
      import { AsyncLocalStorage } from "node:async_hooks";
      const als = new AsyncLocalStorage();
      als.enterWith({ id: 7 });
      await Promise.resolve();
      await Promise.resolve();
      export const store = als.getStore();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, exitCode }).toEqual({
    stdout: 'imported: {"id":7}\n',
    exitCode: 0,
  });
});
