import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Response.bytes() with async iterable body does not crash with null deref", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function* gen() {}
      const body = {};
      body[Symbol.asyncIterator] = () => gen();
      const resp = new Response(body);
      try { resp.bytes(); } catch {}
      try { resp.bytes(); } catch(e) { console.log(e.message); }
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("null is not an object");
  expect(exitCode).toBe(0);
});

test("Response.arrayBuffer() with async iterable body does not crash with null deref", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function* gen() {}
      const body = {};
      body[Symbol.asyncIterator] = () => gen();
      const resp = new Response(body);
      try { resp.arrayBuffer(); } catch {}
      try { resp.arrayBuffer(); } catch(e) { console.log(e.message); }
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).not.toContain("null is not an object");
  expect(exitCode).toBe(0);
});

test("an error from an async-iterable body whose `code` getter throws surfaces that getter's error", async () => {
  // The source inspects `error.code` (ERR_INVALID_THIS / ERR_INVALID_STATE handling); if that
  // lookup throws, its exception is what the read rejects with rather than being ignored.
  const getterError = new Error("code getter threw");
  const original = {
    get code() {
      throw getterError;
    },
  };
  const response = new Response({
    async *[Symbol.asyncIterator]() {
      yield "x";
      throw original;
    },
  });
  await expect(response.text()).rejects.toBe(getterError);

  const plain = new Error("plain");
  await expect(
    new Response({
      async *[Symbol.asyncIterator]() {
        throw plain;
      },
    }).text(),
  ).rejects.toBe(plain);
});
