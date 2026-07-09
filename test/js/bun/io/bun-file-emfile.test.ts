// At the fd limit, the lazy IoRequestLoop init (eventfd / epoll_create1 /
// kqueue / thread spawn) must reject the one read that triggered it instead
// of aborting the process. A later read after fds free up must then succeed.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";

// Windows uses libuv for Bun.file() I/O; no lazy epoll/kqueue loop to exhaust.
describe.skipIf(!isPosix)("Bun.file(fifo).text() at the fd limit", () => {
  const fixture = /* ts */ `
    import * as fs from "node:fs";
    const spare = Number(process.argv[2]);
    const FIFO = process.argv[3];

    // Pre-open a writer so the reader's open() succeeds, write 5 bytes so the
    // first read() returns data, then close it later so the pool thread's
    // read() after those bytes gets EAGAIN and must go through
    // ReadFile::wait_for_readable -> IoRequestLoop::ensure_init.
    const W = fs.openSync(FIFO, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    fs.writeSync(W, "hello");

    const held: number[] = [];
    for (;;) { try { held.push(fs.openSync("/dev/null", "r")); } catch { break; } }
    for (let i = 0; i < spare && held.length; i++) fs.closeSync(held.pop()!);

    setTimeout(() => { try { fs.closeSync(W); } catch {} }, 400);

    let result;
    try {
      result = "resolved:" + (await Bun.file(FIFO).text()).length;
    } catch (e: any) {
      result = "rejected:" + (e?.code ?? e?.message);
    }

    // free everything and prove the process is still functional
    for (const fd of held) { try { fs.closeSync(fd); } catch {} }
    try { fs.closeSync(W); } catch {}

    // Retry with fds available: init must now succeed.
    const W2 = fs.openSync(FIFO, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    fs.writeSync(W2, "ok");
    setTimeout(() => { try { fs.closeSync(W2); } catch {} }, 100);
    let retry;
    try {
      retry = "resolved:" + (await Bun.file(FIFO).text()).length;
    } catch (e: any) {
      retry = "rejected:" + (e?.code ?? e?.message);
    }

    console.log(JSON.stringify({ result, retry, survived: true }));
  `;

  async function run(spare: number) {
    using dir = tempDir("ioloop-emfile", { "fixture.ts": fixture });
    const fifo = `${dir}/f`;
    {
      await using mk = Bun.spawn({ cmd: ["mkfifo", fifo], env: bunEnv });
      await mk.exited;
    }
    // sh lowers the fd limit, then exec's bun so its startup raise is capped
    // at 512. The fixture then exhausts whatever remains.
    await using proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        `ulimit -n 512 && exec "$1" "$2" "$3" "$4"`,
        "sh",
        bunExe(),
        `${dir}/fixture.ts`,
        String(spare),
        fifo,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    return { stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
  }

  for (const spare of [1, 2]) {
    test.concurrent(`spare=${spare}: rejects EMFILE, process survives, retry succeeds`, async () => {
      const { stdout, stderr, exitCode, signalCode } = await run(spare);
      expect({ out: JSON.parse(stdout || "null"), stderr, signalCode }).toEqual({
        out: { result: "rejected:EMFILE", retry: "resolved:2", survived: true },
        stderr: expect.any(String),
        signalCode: null,
      });
      expect(exitCode).toBe(0);
    });
  }

  test.concurrent("spare=8 control: init has enough fds, read resolves", async () => {
    const { stdout, stderr, exitCode, signalCode } = await run(8);
    expect({ out: JSON.parse(stdout || "null"), stderr, signalCode }).toEqual({
      out: { result: "resolved:5", retry: "resolved:2", survived: true },
      stderr: expect.any(String),
      signalCode: null,
    });
    expect(exitCode).toBe(0);
  });
});
