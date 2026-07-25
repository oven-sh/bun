import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// process.stdin is built on Bun.stdin.stream()'s reader. The Blob read helpers
// on Bun.stdin (text/json/arrayBuffer/bytes) used to bypass that stream and
// read fd 0 directly, so a program that armed process.stdin *and* awaited
// Bun.stdin.arrayBuffer() would see the piped bytes split between the two
// consumers with no error. They now route through the same cached stream and
// reject with ERR_INVALID_STATE, matching Bun.stdin.stream().getReader().

const payload = Buffer.alloc(256 * 1024, "x").toString();

describe.each(["arrayBuffer", "bytes", "text", "json"] as const)(
  "Bun.stdin.%s() rejects when process.stdin holds the reader",
  method => {
    test.concurrent(method, async () => {
      const child = `
        let n = 0;
        process.stdin.on("data", c => (n += c.length));
        let result = { state: "pending" };
        Bun.stdin.${method}().then(
          () => { result = { state: "resolved" }; },
          e => { result = { state: "rejected", code: e && (e.code || e.name) }; },
        );
        await new Promise(r => process.stdin.once("end", r));
        await Promise.resolve();
        process.stdout.write(JSON.stringify({ n, result }));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", child],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(payload);
      await proc.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        n: payload.length,
        result: { state: "rejected", code: "ERR_INVALID_STATE" },
      });
      expect(exitCode).toBe(0);
    });
  },
);

test.concurrent("Bun.stdin.arrayBuffer() with no other consumer reads every byte", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(String((await Bun.stdin.arrayBuffer()).byteLength));`],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(payload);
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(String(payload.length));
  expect(exitCode).toBe(0);
});
