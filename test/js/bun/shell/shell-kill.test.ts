import { $ } from "bun";
import { describe, expect, test } from "bun:test";

describe("Shell kill() method", () => {
  test("should be able to kill a long-running process", async () => {
    const proc = $`sleep 10`;

    // Start the process
    const promise = proc.run();

    // Give it a moment to start
    await Bun.sleep(100);

    // Kill the process
    const killed = proc.kill();
    expect(killed).toBe(true);

    // The process should exit with an error due to being killed
    const result = await promise;
    expect(result.exitCode).not.toBe(0);
  });

  test("should be able to kill with specific signal", async () => {
    const proc = $`sleep 10`;

    // Start the process
    const promise = proc.run();

    // Give it a moment to start
    await Bun.sleep(100);

    // Kill the process with SIGKILL
    const killed = proc.kill(9);
    expect(killed).toBe(true);

    // The process should exit with an error due to being killed
    const result = await promise;
    expect(result.exitCode).not.toBe(0);
  });

  test("should be able to kill with named signal", async () => {
    const proc = $`sleep 10`;

    // Start the process
    const promise = proc.run();

    // Give it a moment to start
    await Bun.sleep(100);

    // Kill the process with SIGTERM
    const killed = proc.kill("SIGTERM");
    expect(killed).toBe(true);

    // The process should exit with an error due to being killed
    const result = await promise;
    expect(result.exitCode).not.toBe(0);
  });

  test("should be able to kill with signal name without SIG prefix", async () => {
    const proc = $`sleep 10`;

    // Start the process
    const promise = proc.run();

    // Give it a moment to start
    await Bun.sleep(100);

    // Kill the process with TERM (without SIG prefix)
    const killed = proc.kill("TERM");
    expect(killed).toBe(true);

    // The process should exit with an error due to being killed
    const result = await promise;
    expect(result.exitCode).not.toBe(0);
  });

  test("should return false when trying to kill a process that hasn't started", () => {
    const proc = $`echo hello`;

    // Try to kill before starting
    const killed = proc.kill();
    expect(killed).toBe(false);
  });

  test("should return false when trying to kill a process that already exited", async () => {
    const proc = $`echo hello`;

    // Start and wait for process to finish
    await proc.run();

    // Try to kill after it's done (should return false)
    const killed = proc.kill();
    expect(killed).toBe(false);
  });

  test("should handle invalid signal names", async () => {
    const proc = $`sleep 10`;

    // Start the process
    const promise = proc.run();

    // Give it a moment to start
    await Bun.sleep(100);

    // Try to kill with invalid signal
    expect(() => proc.kill("INVALID")).toThrow("Unknown signal: INVALID");

    // Clean up
    proc.kill();
    await promise.catch(() => {});
  });

  test("should handle invalid signal type", async () => {
    const proc = $`sleep 10`;

    // Start the process
    const promise = proc.run();

    // Give it a moment to start
    await Bun.sleep(100);

    // Try to kill with invalid signal type
    expect(() => proc.kill({} as any)).toThrow("Signal must be a number or string");

    // Clean up
    proc.kill();
    await promise.catch(() => {});
  });

  test("should be able to kill multiple processes in a pipeline", async () => {
    const proc = $`sleep 10 | sleep 10`;

    // Start the pipeline
    const promise = proc.run();

    // Give it a moment to start
    await Bun.sleep(100);

    // Kill the pipeline
    const killed = proc.kill();
    expect(killed).toBe(true);

    // The pipeline should exit with an error due to being killed
    const result = await promise;
    expect(result.exitCode).not.toBe(0);
  });

  test("should work with promises (await)", async () => {
    const proc = $`sleep 10`;

    // Start process via await
    setTimeout(() => {
      proc.kill();
    }, 100);

    const result = await proc;
    expect(result.exitCode).not.toBe(0);
  });
});
