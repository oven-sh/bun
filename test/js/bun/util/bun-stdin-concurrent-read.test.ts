import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// `Bun.stdin.text()/bytes()/arrayBuffer()/json()` read fd 0 via a `ReadFile`
// task that owns its own io poll. A second concurrent `ReadFile` on the same
// fd used to issue a second `EPOLL_CTL_ADD`, so one call rejected with the raw
// `EEXIST: file already exists, epoll_ctl` after already having consumed bytes
// (those bytes were dropped, so the other call resolved short). The helpers now
// reject `ERR_INVALID_STATE` up front for a second concurrent consumer instead,
// and route through the cached `ReadableStream` when `process.stdin` (or a
// manual `Bun.stdin.stream().getReader()`) already holds it.

const SIZE = 1024 * 1024;
const payload = Buffer.alloc(SIZE, "abcdefghij");

async function run(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(payload);
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("two concurrent Bun.stdin.text() calls: second rejects ERR_INVALID_STATE, first reads every byte", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const wrap = p => p.then(
      v => ({ state: "resolved", len: v.length }),
      e => ({ state: "rejected", code: e?.code, name: e?.name }),
    );
    const [a, b] = await Promise.all([wrap(Bun.stdin.text()), wrap(Bun.stdin.text())]);
    process.stdout.write(JSON.stringify({ a, b }));
  `);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    a: { state: "resolved", len: SIZE },
    b: { state: "rejected", code: "ERR_INVALID_STATE", name: "Error" },
  });
  expect(exitCode).toBe(0);
});

describe.each(["text", "arrayBuffer", "bytes"] as const)("Bun.stdin.%s()", method => {
  test.concurrent(`rejects when process.stdin holds the reader; process.stdin receives every byte`, async () => {
    const { stdout, stderr, exitCode } = await run(`
      let n = 0;
      process.stdin.on("data", c => (n += c.length));
      let blob = { state: "pending" };
      Bun.stdin.${method}().then(
        v => { blob = { state: "resolved" }; },
        e => { blob = { state: "rejected", code: e?.code }; },
      );
      await new Promise(r => process.stdin.once("end", r));
      await Promise.resolve();
      process.stdout.write(JSON.stringify({ n, blob }));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      n: SIZE,
      blob: { state: "rejected", code: "ERR_INVALID_STATE" },
    });
    expect(exitCode).toBe(0);
  });
});

test.concurrent("sequential Bun.stdin.text() after the first read completes does not reject", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const a = await Bun.stdin.text();
    const b = await Bun.stdin.text().then(
      v => ({ state: "resolved", len: v.length }),
      e => ({ state: "rejected", code: e?.code }),
    );
    process.stdout.write(JSON.stringify({ aLen: a.length, b }));
  `);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    aLen: SIZE,
    b: { state: "resolved", len: 0 },
  });
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.stdin.text() with no other consumer reads every byte", async () => {
  const { stdout, stderr, exitCode } = await run(
    `process.stdout.write(String((await Bun.stdin.text()).length));`,
  );
  expect(stderr).toBe("");
  expect(stdout).toBe(String(SIZE));
  expect(exitCode).toBe(0);
});
