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
