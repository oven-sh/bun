import { bunEnv, bunExe, isASAN, isDebug, nodeExeAtLeast } from "harness";
import { join } from "node:path";

const { isWindows } = require("../../node/test/common");

async function toUtf8(out: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<string> {
  const stream = new TextDecoderStream();
  out.pipeTo(stream.writable);
  let result = "";
  for await (const chunk of stream.readable) {
    result += chunk;
  }
  return result;
}

describe("yes is killed", () => {
  // The wall-clock window below includes the child's startup (bunExe() has to
  // boot before `yes` writes its first byte). On a debug/ASAN build that startup
  // alone is ~150-250ms, so the release 100ms budget is spent before maxBuffer
  // has anything to measure. Byte-level promptness is asserted by the "caps the
  // buffer" tests below; this is the coarse "didn't wait a full tick" sanity check.
  const killWindow = isDebug || isASAN ? 1000 : 100;

  test("Bun.spawn", async () => {
    const timeStart = Date.now();
    const proc = Bun.spawn([bunExe(), "exec", "yes"], {
      maxBuffer: 256,
      killSignal: isWindows ? "SIGKILL" : "SIGHUP",
      stdio: ["pipe", "pipe", "pipe"],
    });
    await proc.exited;
    expect(proc.exitCode).toBe(null);
    expect(proc.signalCode).toBe(isWindows ? "SIGKILL" : "SIGHUP");
    const timeEnd = Date.now();
    expect(timeEnd - timeStart).toBeLessThan(killWindow);
    const result = await toUtf8(proc.stdout);
    expect(result).toStartWith("y\n".repeat(128));
    const stderr = await toUtf8(proc.stderr);
    expect(stderr).toBe("");
  });

  test("Bun.spawnSync", () => {
    const timeStart = Date.now();
    const proc = Bun.spawnSync([bunExe(), "exec", "yes"], {
      maxBuffer: 256,
      killSignal: isWindows ? "SIGKILL" : "SIGHUP",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(proc.exitedDueToMaxBuffer).toBe(true);
    expect(proc.exitCode as number | null).toBe(null);
    expect(proc.signalCode).toBe(isWindows ? "SIGKILL" : "SIGHUP");
    const timeEnd = Date.now();
    expect(timeEnd - timeStart).toBeLessThan(killWindow);
    const result = proc.stdout.toString("utf-8");
    expect(result).toStartWith("y\n".repeat(128));
    const stderr = proc.stderr.toString("utf-8");
    expect(stderr).toBe("");
  });
});

describe("maxBuffer caps the buffer while the child is still writing", () => {
  const maxBuffer = 1024;
  // The result can only overshoot by the read that tripped the limit, and reads
  // are clamped to the remaining budget plus Node's 64 KB stdio read size. That
  // is the same bound Node gives spawnSync.
  const bound = maxBuffer + 64 * 1024;

  // The child traps SIGTERM so it outlives the maxBuffer kill and keeps
  // writing for as long as Bun keeps reading. On Windows SIGTERM maps to
  // TerminateProcess (untrappable), so the child dies; the cap assertion still
  // holds, it just doesn't exercise the "writer survives" path there.
  const firehose = `
    process.on("SIGTERM", () => {});
    const { writeSync } = require("fs");
    const chunk = Buffer.alloc(1024 * 1024, 97);
    for (let i = 0; i < 8; i++) {
      // Throws EPIPE once Bun has stopped reading.
      try { writeSync(1, chunk); } catch { break; }
    }
  `;

  test.concurrent("Bun.spawnSync", () => {
    const proc = Bun.spawnSync([bunExe(), "-e", firehose], {
      maxBuffer,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(proc.exitedDueToMaxBuffer).toBe(true);
    // Above maxBuffer: the read that trips the limit is still buffered.
    expect(proc.stdout.length).toBeGreaterThan(maxBuffer);
    expect(proc.stdout.length).toBeLessThanOrEqual(bound);
    expect(proc.stderr.length).toBe(0);
  });

  test.concurrent("Bun.spawn", async () => {
    await using proc = Bun.spawn([bunExe(), "-e", firehose], {
      maxBuffer,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await proc.exited;
    const stdout = await proc.stdout.bytes();
    expect(stdout.length).toBeGreaterThan(maxBuffer);
    expect(stdout.length).toBeLessThanOrEqual(bound);
  });
});

// Touching `proc.stdout`/`proc.stderr` hands the buffered reader to a
// `FileReader`; `maxBuffer` must still kill the child via the `MaxBuf` → `Subprocess`
// owner link (it does not go through the reader's parent vtable).
describe.each(["stdout", "stderr"] as const)("maxBuffer kills the process after .%s was accessed", fd => {
  // The child writes well past `maxBuffer` and then blocks forever. Without the
  // kill, `proc.exited` never resolves and the test times out.
  const firehose = `process.${fd}.write(Buffer.alloc(300000, 65).toString()); setInterval(() => {}, 1e9);`;
  const killSignal = isWindows ? "SIGKILL" : "SIGHUP";

  test.concurrent("Bun.spawn (getter before exit)", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", firehose],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      maxBuffer: 1000,
      killSignal,
    });
    const stream = proc[fd];
    expect(stream).toBeInstanceOf(ReadableStream);
    await proc.exited;
    expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
      exitCode: null,
      signalCode: killSignal,
    });
  });

  test.concurrent("Bun.spawn (stream consumed before exit)", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", firehose],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      maxBuffer: 1000,
      killSignal,
    });
    const [bytes] = await Promise.all([proc[fd].bytes(), proc.exited]);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.length).toBeLessThanOrEqual(1000 + 64 * 1024);
    expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
      exitCode: null,
      signalCode: killSignal,
    });
  });
});

describe("maxBuffer infinity does not limit the number of bytes", () => {
  const sample = "this is a long example string\n";
  const sample_repeat_count = 10000;
  test("Bun.spawn", async () => {
    const proc = Bun.spawn([bunExe(), "-e", `console.log(${JSON.stringify(sample)}.repeat(${sample_repeat_count}))`], {
      maxBuffer: Infinity,
    });
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    const result = await toUtf8(proc.stdout);
    expect(result).toBe(sample.repeat(sample_repeat_count) + "\n");
  });

  test("Bun.spawnSync", () => {
    const proc = Bun.spawnSync(
      [bunExe(), "-e", `console.log(${JSON.stringify(sample)}.repeat(${sample_repeat_count}))`],
      {
        maxBuffer: Infinity,
      },
    );
    expect(proc.exitCode).toBe(0);
    const result = proc.stdout.toString("utf-8");
    expect(result).toBe(sample.repeat(sample_repeat_count) + "\n");
  });
});

describe("timeout kills the process", () => {
  test("Bun.spawn", async () => {
    const timeStart = Date.now();
    const proc = Bun.spawn([bunExe(), "exec", "sleep 5"], {
      timeout: 100,
      killSignal: isWindows ? "SIGKILL" : "SIGHUP",
      stdio: ["pipe", "pipe", "pipe"],
    });
    await proc.exited;
    expect(proc.exitCode).toBe(null);
    expect(proc.signalCode).toBe(isWindows ? "SIGKILL" : "SIGHUP");
    const timeEnd = Date.now();
    expect(timeEnd - timeStart).toBeLessThan(200); // make sure it's terminating early
    const result = await toUtf8(proc.stdout);
    expect(result).toBe("");
    const stderr = await toUtf8(proc.stderr);
    expect(stderr).toBe("");
  });

  // A grandchild that inherited the pipe may still hold the write end after
  // Bun kills the child. Reading stdout/stderr after `proc.exited` must
  // deliver what was buffered instead of waiting for that grandchild to exit.
  describe.each([
    ["timeout", () => ({ timeout: 200 })],
    ["AbortSignal", () => ({ signal: AbortSignal.timeout(200) })],
  ] as const)("via %s", (_, opt) => {
    test.skipIf(isWindows)("Bun.spawn stdout does not hang when a grandchild outlives the kill", async () => {
      // `sh` spawns `sleep` before the stdout marker so the assertion proves a
      // grandchild holds the pipe's write end when the kill signal reaches `sh`.
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", "sleep 60 & echo $! >&2; echo from-child; read _"],
        env: bunEnv,
        ...opt(),
        killSignal: "SIGTERM",
        stdio: ["pipe", "pipe", "pipe"],
      });
      await proc.exited;
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
      const grandchild = parseInt(stderr.trim(), 10);
      if (Number.isInteger(grandchild))
        try {
          process.kill(grandchild);
        } catch {}
      expect({ stdout, exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: "from-child\n",
        exitCode: null,
        signalCode: "SIGTERM",
      });
      expect(stderr).toMatch(/^\d+\n$/);
    });
  });

  test("Bun.spawnSync", () => {
    const timeStart = Date.now();
    const proc = Bun.spawnSync([bunExe(), "exec", "sleep 5"], {
      timeout: 100,
      killSignal: isWindows ? "SIGKILL" : "SIGHUP",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(proc.exitedDueToTimeout).toBe(true);
    expect(proc.exitCode as number | null).toBe(null);
    expect(proc.signalCode).toBe(isWindows ? "SIGKILL" : "SIGHUP");
    const timeEnd = Date.now();
    // The timeout deadline is CLOCK_MONOTONIC at nanosecond precision, so by the
    // time spawnSync returns at least 100ms have elapsed. Date.now() truncates to
    // whole milliseconds, so floor(end) - floor(start) can equal exactly 100.
    expect(timeEnd - timeStart).toBeGreaterThanOrEqual(100); // make sure it actually waits
    expect(timeEnd - timeStart).toBeLessThan(200); // make sure it's terminating early
    const result = proc.stdout.toString("utf-8");
    expect(result).toBe("");
    const stderr = proc.stderr.toString("utf-8");
    expect(stderr).toBe("");
  });
});

describe("timeout Infinity does not kill the process", () => {
  test("Bun.spawn", async () => {
    const timeStart = Date.now();
    const proc = Bun.spawn([bunExe(), "exec", "sleep 1"], {
      timeout: Infinity,
      killSignal: isWindows ? "SIGKILL" : "SIGHUP",
      stdio: ["pipe", "pipe", "pipe"],
    });
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    const timeEnd = Date.now();
    expect(timeEnd - timeStart).toBeGreaterThan(1000); // make sure it actually waits
    expect(timeEnd - timeStart).toBeLessThan(1500); // make sure it's terminating early
    const result = await toUtf8(proc.stdout);
    expect(result).toBe("");
    const stderr = await toUtf8(proc.stderr);
    expect(stderr).toBe("");
  });

  test("Bun.spawnSync", () => {
    const timeStart = Date.now();
    const proc = Bun.spawnSync([bunExe(), "exec", "sleep 1"], {
      timeout: Infinity,
      killSignal: isWindows ? "SIGKILL" : "SIGHUP",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    const timeEnd = Date.now();
    expect(timeEnd - timeStart).toBeGreaterThan(1000); // make sure it actually waits
    expect(timeEnd - timeStart).toBeLessThan(1500);
    const result = proc.stdout.toString("utf-8");
    expect(result).toBe("");
    const stderr = proc.stderr.toString("utf-8");
    expect(stderr).toBe("");
  });
});

// The two blocks below start many processes at once. They come last, after the rows above that have a time bound.
// Bun.spawn and Bun.spawnSync count each stream. The sync calls of node:child_process do not: see the next block.
describe("maxBuffer is a limit for each of stdout and stderr", () => {
  const maxBuffer = 1000;
  // Under the limit on each stream, over it on both together.
  const a = Buffer.alloc(600, "a").toString();
  const b = Buffer.alloc(600, "b").toString();
  // The child then waits for the end of stdin: a kill for going over the limit would find it alive.
  const script = `const fs = require("node:fs"); fs.writeSync(1, "${a}"); fs.writeSync(2, "${b}"); try { fs.readSync(0, Buffer.alloc(1)); } catch {}`;
  const cmd = [bunExe(), "-e", script];
  const options = { env: bunEnv, stdout: "pipe", stderr: "pipe", maxBuffer } as const;

  test.concurrent("Bun.spawn", async () => {
    await using proc = Bun.spawn({ cmd, ...options, stdin: "pipe" });
    const take = async (stream: ReadableStream<Uint8Array>, length: number) => {
      const reader = stream.getReader();
      let text = "";
      while (text.length < length) {
        const { value, done } = await reader.read();
        if (done) break;
        text += Buffer.from(value).toString();
      }
      reader.releaseLock();
      return text;
    };
    const [stdout, stderr] = await Promise.all([take(proc.stdout, a.length), take(proc.stderr, b.length)]);
    proc.stdin.end();
    expect({ stdout, stderr, exitCode: await proc.exited, signalCode: proc.signalCode }).toEqual({
      stdout: a,
      stderr: b,
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("Bun.spawnSync", () => {
    for (const proc of [
      Bun.spawnSync({ cmd, ...options }),
      Bun.spawnSync(cmd, options),
      // node:child_process marks its calls with a private name. This string key is not that name.
      Bun.spawnSync(Object.assign({ cmd, $sharedMaxBuffer: true }, options)),
    ]) {
      expect({
        stdout: proc.stdout.toString(),
        stderr: proc.stderr.toString(),
        exitCode: proc.exitCode,
        exitedDueToMaxBuffer: proc.exitedDueToMaxBuffer,
      }).toEqual({ stdout: a, stderr: b, exitCode: 0, exitedDueToMaxBuffer: false });
    }
  });

  test.concurrent.each(["stdout", "stderr"] as const)("Bun.spawnSync: %s alone goes over the limit", stream => {
    const fd = stream === "stdout" ? 1 : 2;
    const over = [bunExe(), "-e", `require("node:fs").writeSync(${fd}, Buffer.alloc(${maxBuffer + 1}, "a"))`];
    const proc = Bun.spawnSync({ cmd: over, ...options });
    expect({ exitedDueToMaxBuffer: proc.exitedDueToMaxBuffer, [stream]: proc[stream].length }).toEqual({
      exitedDueToMaxBuffer: true,
      [stream]: maxBuffer + 1,
    });
  });

  // The child answers the kill signal with 300 bytes on stderr, which a child on Windows cannot do.
  test.concurrent.skipIf(isWindows)("Bun.spawn still reads stderr when stdout is over the limit", async () => {
    const answer = `const fs = require("node:fs"); process.on("SIGTERM", () => { fs.writeSync(2, Buffer.alloc(300, "b")); process.exit(0); }); fs.readSync(0, Buffer.alloc(1)); fs.writeSync(1, Buffer.alloc(1200, "a")); setInterval(() => {}, 1e9);`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", answer], ...options, stdin: "pipe" });
    // The child writes once it has a byte of stdin, which is after Bun.spawn returned.
    proc.stdin.write("x");
    proc.stdin.end();
    const exitCode = await proc.exited;
    const [stdout, stderr] = await Promise.all([proc.stdout.bytes(), proc.stderr.bytes()]);
    expect({ stdout: stdout.length, stderr: stderr.length, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: 1200,
      stderr: 300,
      exitCode: 0,
      signalCode: null,
    });
  });

  // Each of the next two makes its calls in a process of its own. The child of a call is a /bin/sh script.
  async function inOwnProcess(sh: string, report: string, calls: number) {
    const script = `const results = []; for (let call = 0; call < ${calls}; call++) { const result = Bun.spawnSync({ cmd: ["/bin/sh", "-c", ${JSON.stringify(sh)}], stdout: "pipe", stderr: "pipe", maxBuffer: ${maxBuffer} }); results.push(${report}); } console.log(JSON.stringify(results));`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { results: exitCode === 0 ? JSON.parse(stdout) : stdout + stderr, exitCode };
  }

  // A call that stops reading stderr at once loses this line when it finds both pipes readable, which is most
  // likely in the first call of a slow process. So there are several processes.
  test.concurrent.skipIf(isWindows)("Bun.spawnSync returns the stderr written before stdout went over", async () => {
    const runs = Array.from({ length: 4 }, () =>
      inOwnProcess(
        "echo warning >&2; printf '%02000d' 0; exec sleep 10",
        "{ exitedDueToMaxBuffer: result.exitedDueToMaxBuffer, signalCode: result.signalCode, stderr: result.stderr.toString() }",
        1,
      ),
    );
    expect(await Promise.all(runs)).toEqual(
      Array(4).fill({
        results: [{ exitedDueToMaxBuffer: true, signalCode: "SIGTERM", stderr: "warning\n" }],
        exitCode: 0,
      }),
    );
  });

  // The descendant has the pipes. It writes when the call has reaped the child (`kill -0` fails then). That is
  // before or after the call reads the pipes for the exit, and only a write after it needs the close at the end of a
  // loop turn. So there are several calls. stdout is a line with the descendant's pid, then 1200 zero bytes. `dd`
  // writes them with one write(2). The `printf` of a shell can make two (busybox on musl: 1028, then 172), and the
  // call can return between them. The descendant then stays, as `sleep`, under that pid.
  test.concurrent.skipIf(isWindows)("Bun.spawnSync returns when a descendant goes over after the child", async () => {
    const calls = 20;
    const { results, exitCode } = await inOwnProcess(
      `(while kill -0 $$ 2>/dev/null; do :; done; sh -c 'echo $PPID'; dd if=/dev/zero bs=1200 count=1 2>/dev/null; exec sleep 10) &`,
      `(() => { let descendantAlive = false; try { process.kill(parseInt(result.stdout.toString(), 10), "SIGKILL"); descendantAlive = true; } catch {} return { exitedDueToMaxBuffer: result.exitedDueToMaxBuffer, exitCode: result.exitCode, zeros: result.stdout.filter(byte => byte === 0).length, descendantAlive }; })()`,
      calls,
    );
    expect({ results, exitCode }).toEqual({
      results: Array(calls).fill({ exitedDueToMaxBuffer: true, exitCode: 0, zeros: 1200, descendantAlive: true }),
      exitCode: 0,
    });
  });
});

// Node.js has one maxBuffer for every output pipe of a sync spawn:
// https://github.com/nodejs/node/blob/v26.3.0/src/spawn_sync.cc#L648-L655
describe("maxBuffer of a node:child_process sync spawn is one limit for stdout and stderr", () => {
  const fixture = join(import.meta.dir, "spawn-maxbuf-node-sync-fixture.js");
  const MiB = 1024 * 1024;
  const over = { error: "ENOBUFS", message: "spawnSync <file> ENOBUFS", stdout: 600, stderr: 600 };
  const under = { error: null, message: null };
  // What each scenario of the fixture prints. `status` and `signal` are there when the scenario decides them.
  const expected: Record<string, object> = {
    "spawnSync kills a child that wrote 600 + 600": { ...over, status: null, signal: "SIGTERM" },
    "execFileSync kills a child that wrote 600 + 600": { ...over, status: null, signal: "SIGTERM" },
    "execSync throws ENOBUFS for 600 + 600": over,
    "500 + 500 is at the limit": { ...under, stdout: 500, stderr: 500, status: 0, signal: null },
    "500 + 501 is over the limit": { ...over, stdout: 500, stderr: 501 },
    "the default limit is 1 MiB: at it": { ...under, stdout: MiB - 100, stderr: 100, status: 0, signal: null },
    "the default limit is 1 MiB: one byte over": { ...over, stdout: MiB - 100, stderr: 101 },
    "killSignal is the signal that kills the child": { ...over, status: null, signal: "SIGKILL" },
    "execFile counts each stream": { ...under, stdout: 600, stderr: 600 },
    "a descendant goes over the limit after the child exited": {
      error: "ENOBUFS",
      stdout: 600,
      stderr: 600,
      status: 0,
      signal: null,
      descendantAlive: true,
    },
    // These two are /bin/sh scripts.
    ...(isWindows
      ? {}
      : {
          "spawnSync kills a child that writes at once": {
            error: "ENOBUFS",
            status: null,
            signal: "SIGTERM",
            pipesRead: 1,
          },
          "a pipe is not read after the limit is passed": { error: ["ENOBUFS"], stderr: 0 },
        }),
  };

  // stderr also has what execFileSync and execSync write there: the stderr of the child.
  async function run(exe: string, ...scenario: string[]) {
    await using proc = Bun.spawn({ cmd: [exe, fixture, ...scenario], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { results: exitCode === 0 ? JSON.parse(stdout) : stdout + stderr, exitCode };
  }

  test.concurrent.each(Object.keys(expected))("%s", async scenario => {
    expect(await run(bunExe(), scenario)).toEqual({ results: { [scenario]: expected[scenario] }, exitCode: 0 });
  });

  const node = nodeExeAtLeast("18.0.0");
  test.concurrent.skipIf(!node)("Node.js gives the same results", async () => {
    expect(await run(node!)).toEqual({ results: expected, exitCode: 0 });
  });
});
