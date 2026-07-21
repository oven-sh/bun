import { bunEnv, bunExe } from "harness";

const { isWindows } = require("../../node/test/common");

async function toUtf8(out: ReadableStream<Uint8Array>): Promise<string> {
  const stream = new TextDecoderStream();
  out.pipeTo(stream.writable);
  let result = "";
  for await (const chunk of stream.readable) {
    result += chunk;
  }
  return result;
}

describe("yes is killed", () => {
  // TODO
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
    expect(timeEnd - timeStart).toBeLessThan(100); // make sure it's not waiting a full tick
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
    expect(proc.exitCode).toBe(null);
    expect(proc.signalCode).toBe(isWindows ? "SIGKILL" : "SIGHUP");
    const timeEnd = Date.now();
    expect(timeEnd - timeStart).toBeLessThan(100); // make sure it's not waiting a full tick
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

  // `killSignal: 0` sends no signal at all, so the child outlives the kill and
  // keeps writing for as long as Bun keeps reading. A child that merely
  // installs a SIGTERM handler, or is slow to die, behaves the same way.
  const firehose = `
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
      killSignal: 0,
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
      killSignal: 0,
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
  // the timeout kill. Reading stdout/stderr after `proc.exited` must deliver
  // what was buffered instead of waiting for that grandchild to exit.
  test.skipIf(isWindows)("Bun.spawn stdout does not hang when a grandchild outlives the timeout", async () => {
    // `sh` spawns `sleep` before the stdout marker so the assertion proves a
    // grandchild holds the pipe's write end when the kill signal reaches `sh`.
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", "sleep 60 & echo $! >&2; echo from-child; read _"],
      env: bunEnv,
      timeout: 200,
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

  test("Bun.spawnSync", () => {
    const timeStart = Date.now();
    const proc = Bun.spawnSync([bunExe(), "exec", "sleep 5"], {
      timeout: 100,
      killSignal: isWindows ? "SIGKILL" : "SIGHUP",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(proc.exitedDueToTimeout).toBe(true);
    expect(proc.exitCode).toBe(null);
    expect(proc.signalCode).toBe(isWindows ? "SIGKILL" : "SIGHUP");
    const timeEnd = Date.now();
    expect(timeEnd - timeStart).toBeGreaterThan(100); // make sure it actually waits
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
