import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import crypto from "node:crypto";

// Reading a sliced non-regular file blob (like stdin from a pipe) with a size
// close to Blob.max_size used to overflow when computing the initial read
// buffer capacity. The overflow was only reachable on POSIX; on Windows the
// ReadFileUV path already bailed on size > ULONG_MAX before the addition.
test.skipIf(isWindows)("Bun.stdin.slice(1).text() does not crash when stdin is a pipe", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(await Bun.stdin.slice(1).text());`],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write("hello world");
  await proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("hello world");
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("Bun.stdin.slice(0, N).text() caps reads at N bytes", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(await Bun.stdin.slice(0, 3).text());`],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write("0123456789");
  await proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("012");
  expect(exitCode).toBe(0);
});

// Two concurrent blob reads on a piped stdin used to spawn two independent
// readers: each did its own read() on fd 0 (splitting the byte stream) and
// each tried epoll_ctl(ADD) on fd 0, so the loser rejected with the raw
// "EEXIST: file already exists, epoll_ctl" and the winner could resolve short.
// Now the second read attaches to the in-flight reader and both resolve with
// the full, identical byte stream.
describe.skipIf(isWindows)("concurrent Bun.stdin blob reads on a pipe", () => {
  // Large enough that the pipe cannot buffer it all and the async epoll path
  // is taken, small enough to keep the test fast under ASAN.
  const SIZE = 2 * 1024 * 1024;

  async function run(script: string, payload: Uint8Array) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(payload);
    // The sliced+unsliced case can exit without reading all of stdin; drain
    // output concurrently and swallow EPIPE on the end() so that interleaving
    // is visible as a rejected result rather than a thrown write error here.
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
      proc.stdin.end().catch(() => {}),
    ]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("arrayBuffer + arrayBuffer both resolve with the full input", async () => {
    const payload = crypto.randomBytes(SIZE);
    const sha = Bun.SHA256.hash(payload, "hex");
    const { stdout, stderr, exitCode } = await run(
      `
        const rs = await Promise.allSettled([Bun.stdin.arrayBuffer(), Bun.stdin.arrayBuffer()]);
        const out = rs.map(r => r.status === "fulfilled"
          ? { status: r.status, byteLength: r.value.byteLength, sha: Bun.SHA256.hash(r.value, "hex") }
          : { status: r.status, code: r.reason?.code, message: String(r.reason?.message ?? r.reason) });
        process.stdout.write(JSON.stringify(out));
      `,
      payload,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([
      { status: "fulfilled", byteLength: SIZE, sha },
      { status: "fulfilled", byteLength: SIZE, sha },
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("text + arrayBuffer both resolve with the full input", async () => {
    const payload = new Uint8Array(Buffer.alloc(SIZE, "abcdefghij"));
    const sha = Bun.SHA256.hash(payload, "hex");
    const { stdout, stderr, exitCode } = await run(
      `
        const rs = await Promise.allSettled([Bun.stdin.text(), Bun.stdin.arrayBuffer()]);
        const out = rs.map(r => {
          if (r.status !== "fulfilled") return { status: r.status, code: r.reason?.code };
          if (typeof r.value === "string")
            return { status: r.status, length: r.value.length, sha: Bun.SHA256.hash(Buffer.from(r.value), "hex") };
          return { status: r.status, byteLength: r.value.byteLength, sha: Bun.SHA256.hash(r.value, "hex") };
        });
        process.stdout.write(JSON.stringify(out));
      `,
      payload,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([
      { status: "fulfilled", length: SIZE, sha },
      { status: "fulfilled", byteLength: SIZE, sha },
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a read started after the first resolves begins a fresh reader", async () => {
    const payload = crypto.randomBytes(SIZE);
    const { stdout, stderr, exitCode } = await run(
      `
        const a = await Bun.stdin.arrayBuffer();
        const b = await Bun.stdin.arrayBuffer();
        process.stdout.write(JSON.stringify({ a: a.byteLength, b: b.byteLength }));
      `,
      payload,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ a: SIZE, b: 0 });
    expect(exitCode).toBe(0);
  });

  test.concurrent("a concurrent sliced read does not truncate an unsliced one to its window", async () => {
    const payload = crypto.randomBytes(SIZE);
    const { stdout, stderr, exitCode } = await run(
      `
        const rs = await Promise.allSettled([Bun.stdin.slice(0, 3).bytes(), Bun.stdin.arrayBuffer()]);
        const out = rs.map(r => r.status === "fulfilled"
          ? { status: r.status, byteLength: r.value.byteLength }
          : { status: r.status, code: r.reason?.code });
        process.stdout.write(JSON.stringify(out));
      `,
      payload,
    );
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    // Mismatched (offset, max_length) means the two readers are not coalesced
    // and race on fd 0 exactly as before this change; either can lose the
    // epoll_ctl(ADD). The invariant being guarded is that the unsliced read is
    // never silently resolved with the sliced window.
    expect(result[1]).not.toEqual({ status: "fulfilled", byteLength: 3 });
    if (result[0].status === "fulfilled") expect(result[0].byteLength).toBe(3);
    expect(exitCode).toBe(0);
  });
});
