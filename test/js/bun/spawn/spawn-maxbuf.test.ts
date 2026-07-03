import { bunExe } from "harness";

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

describe("maxBuffer kills the child when stdout/stderr is read as a stream", () => {
  // The child writes 8 MiB — far above `maxBuffer` and the OS pipe buffer, so it
  // blocks on backpressure long before it finishes. Reading the stream *before*
  // `await proc.exited` exercises the path where the pipe's BufferedReader has
  // been transferred to a FileReader (whose vtable has no Subprocess
  // back-reference), so the kill must dispatch through MaxBuf's own subprocess
  // back-pointer. Without the fix the child is never killed, runs to completion,
  // and the stream resolves with the full 8 MiB (> 1 MiB, exit code 0) — the
  // SIGTERM / size assertions then fail promptly instead of the test hanging.
  const producer = "for(let i=0;i<8192;i++)process.stdout.write(Buffer.alloc(1024,120))";
  const producerErr = "for(let i=0;i<8192;i++)process.stderr.write(Buffer.alloc(1024,120))";

  test.concurrent("new Response(proc.stdout).text()", async () => {
    const proc = Bun.spawn([bunExe(), "-e", producer], {
      maxBuffer: 1000,
      stdout: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(1_000_000);
    expect(proc.signalCode).toBe("SIGTERM");
    expect(proc.exitCode).toBe(null);
  });

  test.concurrent("proc.stdout.text()", async () => {
    const proc = Bun.spawn([bunExe(), "-e", producer], {
      maxBuffer: 1000,
      stdout: "pipe",
    });
    const text = await proc.stdout.text();
    await proc.exited;
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(1_000_000);
    expect(proc.signalCode).toBe("SIGTERM");
    expect(proc.exitCode).toBe(null);
  });

  test.concurrent("new Response(proc.stderr).text()", async () => {
    const proc = Bun.spawn([bunExe(), "-e", producerErr], {
      maxBuffer: 1000,
      stderr: "pipe",
    });
    const text = await new Response(proc.stderr).text();
    await proc.exited;
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(1_000_000);
    expect(proc.signalCode).toBe("SIGTERM");
    expect(proc.exitCode).toBe(null);
  });

  test.concurrent("under-limit streaming read returns full output", async () => {
    const proc = Bun.spawn([bunExe(), "-e", "process.stdout.write(Buffer.alloc(500,120))"], {
      maxBuffer: 1000,
      stdout: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    expect(text.length).toBe(500);
    expect(proc.signalCode).toBe(null);
    expect(proc.exitCode).toBe(0);
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
