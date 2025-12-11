import { $ } from "bun";
import { describe, expect, test } from "bun:test";

describe("Shell AbortSignal", () => {
  describe("Basic abort tests", () => {
    test("AbortController.abort() rejects with AbortError", async () => {
      const controller = new AbortController();

      const promise = $`sleep 10`.signal(controller.signal);

      // Abort after a short delay
      setTimeout(() => {
        controller.abort();
      }, 50);

      // Use try/catch pattern instead of expect().rejects to avoid deadlock
      let caught: any;
      try {
        await promise;
        expect.unreachable("Should have thrown");
      } catch (e: any) {
        caught = e;
      }

      expect(caught.name).toBe("AbortError");
      expect(caught.message).toBe("The operation was aborted.");
    });

    test("AbortSignal.timeout() rejects with TimeoutError", async () => {
      const sig = AbortSignal.timeout(100);

      let caught: any;
      try {
        await $`sleep 10`.signal(sig);
        expect.unreachable("Should have thrown");
      } catch (e: any) {
        caught = e;
      }

      expect(caught.name).toBe("TimeoutError");
    });

    test("nothrow() resolves with exit code 143 on abort", async () => {
      const controller = new AbortController();

      const promise = $`sleep 10`.nothrow().signal(controller.signal);

      setTimeout(() => {
        controller.abort();
      }, 50);

      const result = await promise;
      expect(result.exitCode).toBe(143); // 128 + SIGTERM (15)
    });

    test("custom abort reason is preserved", async () => {
      const controller = new AbortController();
      const customError = new Error("Custom abort reason");

      const promise = $`sleep 10`.signal(controller.signal);

      setTimeout(() => {
        controller.abort(customError);
      }, 50);

      let caught: any;
      try {
        await promise;
        expect.unreachable("Should have thrown");
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(customError);
    });
  });

  describe("Already-aborted signal tests", () => {
    test("already-aborted signal rejects immediately without spawning", async () => {
      const controller = new AbortController();
      controller.abort();

      const start = Date.now();

      let caught: any;
      try {
        await $`sleep 10`.signal(controller.signal);
        expect.unreachable("Should have thrown");
      } catch (e: any) {
        caught = e;
      }

      // Should be nearly instant since no process was spawned
      expect(Date.now() - start).toBeLessThan(1000);
      expect(caught.name).toBe("AbortError");
    });

    test("already-aborted signal with nothrow resolves with exit code 143", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await $`sleep 10`.nothrow().signal(controller.signal);
      expect(result.exitCode).toBe(143);
    });
  });

  describe("Pipeline tests", () => {
    test("abort kills all processes in pipeline", async () => {
      const controller = new AbortController();

      const promise = $`sleep 10 | cat | cat`.signal(controller.signal);

      setTimeout(() => {
        controller.abort();
      }, 50);

      let caught: any;
      try {
        await promise;
        expect.unreachable("Should have thrown");
      } catch (e: any) {
        caught = e;
      }

      expect(caught.name).toBe("AbortError");
    });
  });

  describe("Helper method tests", () => {
    test(".text() rejects on abort", async () => {
      const controller = new AbortController();

      const promise = $`sleep 10`.signal(controller.signal).text();

      setTimeout(() => {
        controller.abort();
      }, 50);

      let caught: any;
      try {
        await promise;
        expect.unreachable("Should have thrown");
      } catch (e: any) {
        caught = e;
      }

      expect(caught.name).toBe("AbortError");
    });

    test(".lines() rejects on abort", async () => {
      const controller = new AbortController();

      const shellPromise = $`sleep 10`.signal(controller.signal);
      const linesPromise = (async () => {
        const lines: string[] = [];
        for await (const line of shellPromise.lines()) {
          lines.push(line);
        }
        return lines;
      })();

      setTimeout(() => {
        controller.abort();
      }, 50);

      let caught: any;
      try {
        await linesPromise;
        expect.unreachable("Should have thrown");
      } catch (e: any) {
        caught = e;
      }

      expect(caught.name).toBe("AbortError");
    });

    test(".json() rejects on abort", async () => {
      const controller = new AbortController();

      const promise = $`sleep 10 && echo '{"test": true}'`.signal(controller.signal).json();

      setTimeout(() => {
        controller.abort();
      }, 50);

      let caught: any;
      try {
        await promise;
        expect.unreachable("Should have thrown");
      } catch (e: any) {
        caught = e;
      }

      expect(caught.name).toBe("AbortError");
    });
  });

  describe("Edge case tests", () => {
    test("signal fires after process exits normally - not treated as abort", async () => {
      const controller = new AbortController();

      // Fast command that should complete before abort
      const result = await $`echo hello`.nothrow().signal(controller.signal);

      // Abort after command completes
      controller.abort();

      // Should have exit code 0, not 143
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe("hello");
    });

    test("calling signal() after shell has started throws", async () => {
      const controller = new AbortController();

      const promise = $`sleep 1`;
      promise.run(); // Start the shell

      expect(() => {
        promise.signal(controller.signal);
      }).toThrow("Shell is already running");
    });
  });

  describe("Promise combinator tests", () => {
    test("Promise.race() does not cancel shell command", async () => {
      const controller = new AbortController();
      const start = Date.now();

      // Shell command takes 2 seconds, other promise resolves immediately
      const result = await Promise.race([$`sleep 2`.nothrow().signal(controller.signal), Promise.resolve("fast")]);

      expect(result).toBe("fast");

      // The shell should still be running in the background
      // This just verifies Promise.race doesn't cancel the shell
      expect(Date.now() - start).toBeLessThan(500);

      // Now abort to clean up
      controller.abort();
    });
  });

  describe("AbortError properties tests", () => {
    test("AbortError has correct name property", async () => {
      const controller = new AbortController();

      const promise = $`sleep 10`.signal(controller.signal);
      setTimeout(() => {
        controller.abort();
      }, 50);

      let caught: any;
      try {
        await promise;
        expect.unreachable("Should have thrown");
      } catch (e: any) {
        caught = e;
      }

      expect(caught.name).toBe("AbortError");
      expect(caught instanceof DOMException).toBe(true);
    });
  });
});
