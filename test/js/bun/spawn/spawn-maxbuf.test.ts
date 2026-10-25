import { bunEnv, bunExe, isASAN, isDebug } from "harness";

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

// Only the sync calls of node:child_process count stdout and stderr against one maxBuffer, as Node.js does:
// test/js/node/child_process/child-process-sync-stdio-pipes.test.ts
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
    for (const proc of [Bun.spawnSync({ cmd, ...options }), Bun.spawnSync(cmd, options)]) {
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
    for (const proc of [Bun.spawnSync({ cmd: over, ...options }), Bun.spawnSync(over, options)]) {
      expect({ exitedDueToMaxBuffer: proc.exitedDueToMaxBuffer, [stream]: proc[stream].length }).toEqual({
        exitedDueToMaxBuffer: true,
        [stream]: maxBuffer + 1,
      });
    }
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
