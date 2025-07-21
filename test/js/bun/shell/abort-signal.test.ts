import { test, expect, describe } from "bun:test";
import { $ } from "bun";

describe("Shell AbortSignal support", () => {
  test("AbortSignal can be passed to shell command", () => {
    const controller = new AbortController();
    const cmd = $`echo hello`.signal(controller.signal);
    expect(cmd).toBeDefined();
  });

  test("shell command aborted immediately", async () => {
    const controller = new AbortController();
    controller.abort(); // Abort before starting
    
    let error: any;
    try {
      await $`echo hello`.signal(controller.signal);
    } catch (e) {
      error = e;
    }
    
    expect(error).toBeDefined();
    expect(error.exitCode).toBe(128); // Signal exit code
  });

  test("shell command aborted during execution", async () => {
    const controller = new AbortController();
    
    // Start a long-running command and abort it after a short delay
    const promise = $`sleep 10`.signal(controller.signal);
    
    // Abort after 100ms
    setTimeout(() => controller.abort(), 100);
    
    let error: any;
    try {
      await promise;
    } catch (e) {
      error = e;
    }
    
    expect(error).toBeDefined();
    expect(error.exitCode).toBe(128); // Signal exit code
  });

  test("shell command with abort reason", async () => {
    const controller = new AbortController();
    const reason = new Error("Command was cancelled");
    controller.abort(reason);
    
    let error: any;
    try {
      await $`echo hello`.signal(controller.signal);
    } catch (e) {
      error = e;
    }
    
    expect(error).toBeDefined();
  });

  test("shell command aborts multiple commands in pipeline", async () => {
    const controller = new AbortController();
    
    const promise = $`sleep 10 | grep hello`.signal(controller.signal);
    setTimeout(() => controller.abort(), 100);
    
    let error: any;
    try {
      await promise;
    } catch (e) {
      error = e;
    }
    
    expect(error).toBeDefined();
    expect(error.exitCode).toBe(128);
  });

  test("shell command completes normally without abort", async () => {
    const controller = new AbortController();
    
    const result = await $`echo hello world`.signal(controller.signal);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("hello world\n");
  });

  test("multiple shell commands with same abort signal", async () => {
    const controller = new AbortController();
    
    const cmd1 = $`sleep 5`.signal(controller.signal);
    const cmd2 = $`sleep 5`.signal(controller.signal);
    
    // Abort both commands
    setTimeout(() => controller.abort(), 50);
    
    const results = await Promise.allSettled([cmd1, cmd2]);
    
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    
    if (results[0].status === "rejected") {
      expect(results[0].reason.exitCode).toBe(128);
    }
    if (results[1].status === "rejected") {
      expect(results[1].reason.exitCode).toBe(128);
    }
  });

  test("shell command with null abort signal", async () => {
    const result = await $`echo test`.signal(null);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("test\n");
  });

  test("shell command with undefined abort signal", async () => {
    const result = await $`echo test`.signal(undefined);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("test\n");
  });

  test("shell command method chaining with signal", async () => {
    const controller = new AbortController();
    
    const result = await $`echo test`
      .cwd(process.cwd())
      .signal(controller.signal)
      .env({ TEST_VAR: "value" });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("test\n");
  });

  test("shell command aborted with custom signal", async () => {
    // Test using AbortSignal.timeout() if available
    if (typeof AbortSignal.timeout === "function") {
      let error: any;
      try {
        await $`sleep 1`.signal(AbortSignal.timeout(50)); // 50ms timeout
      } catch (e) {
        error = e;
      }
      
      expect(error).toBeDefined();
      expect(error.exitCode).toBe(128);
    }
  });

  test("nested shell commands with abort signal", async () => {
    const controller = new AbortController();
    
    // Test command substitution with abort signal
    const promise = $`echo $(sleep 5 && echo world)`.signal(controller.signal);
    setTimeout(() => controller.abort(), 100);
    
    let error: any;
    try {
      await promise;
    } catch (e) {
      error = e;
    }
    
    expect(error).toBeDefined();
    expect(error.exitCode).toBe(128);
  });

  test("shell command with builtin and abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    
    let error: any;
    try {
      await $`cd /tmp`.signal(controller.signal);
    } catch (e) {
      error = e;
    }
    
    expect(error).toBeDefined();
    expect(error.exitCode).toBe(128);
  });

  test("abort signal is properly cleaned up", async () => {
    const controller = new AbortController();
    
    // Run a quick command to completion
    await $`echo cleanup test`.signal(controller.signal);
    
    // Signal should still be usable for other operations
    expect(controller.signal.aborted).toBe(false);
    
    // Abort for next command
    controller.abort();
    
    let error: any;
    try {
      await $`echo after abort`.signal(controller.signal);
    } catch (e) {
      error = e;
    }
    
    expect(error).toBeDefined();
    expect(controller.signal.aborted).toBe(true);
  });

  test("shell error handling with abort signal", async () => {
    const controller = new AbortController();
    
    // Test error vs abort distinction  
    try {
      // This command will fail normally
      await $`command-that-does-not-exist`.signal(controller.signal);
      expect(true).toBe(false); // Should not reach here
    } catch (e: any) {
      // Should be a normal command not found error, not an abort
      expect(e.exitCode).not.toBe(128);
    }
  });
});