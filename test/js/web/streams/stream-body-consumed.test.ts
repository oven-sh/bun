import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("ReadableStream.text() after body consumed does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const response = new Response("hello");
      const body = response.body;
      try { await response.json(); } catch(e) {}
      try { await body.text(); } catch(e) {}
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test.concurrent("ReadableStream.blob() after body consumed does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const response = new Response("hello");
      const body = response.body;
      try { await response.text(); } catch(e) {}
      try { await body.blob(); } catch(e) {}
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
