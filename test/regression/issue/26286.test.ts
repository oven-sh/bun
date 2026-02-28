import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";

// https://github.com/oven-sh/bun/issues/26286
// Bun.Terminal callbacks not invoked inside AsyncLocalStorage.run()

// Bun.Terminal uses PTY which is not supported on Windows
test.skipIf(isWindows)("Bun.Terminal data callback works inside AsyncLocalStorage.run()", async () => {
  const storage = new AsyncLocalStorage();

  async function terminalTest() {
    const { promise, resolve } = Promise.withResolvers<Uint8Array>();

    await using terminal = new Bun.Terminal({
      data(term, data) {
        resolve(data);
      },
    });

    const process = Bun.spawn([bunExe(), "-e", "console.log('Hello')"], {
      terminal,
      env: bunEnv,
    });

    const data = await promise;
    await process.exited;

    return { data };
  }

  // Test inside AsyncLocalStorage.run()
  const result = await storage.run({ testContext: true }, terminalTest);

  expect(result.data).not.toBeNull();
  expect(new TextDecoder().decode(result.data!)).toContain("Hello");
});

test.skipIf(isWindows)("Bun.Terminal preserves async context inside callbacks", async () => {
  const storage = new AsyncLocalStorage<{ id: number }>();

  async function terminalTest() {
    const { promise, resolve } = Promise.withResolvers<{ id: number } | undefined>();

    await using terminal = new Bun.Terminal({
      data(term, data) {
        resolve(storage.getStore());
      },
    });

    const process = Bun.spawn([bunExe(), "-e", "console.log('Hello')"], {
      terminal,
      env: bunEnv,
    });

    const contextInCallback = await promise;
    await process.exited;

    return { contextInCallback };
  }

  const result = await storage.run({ id: 42 }, terminalTest);

  expect(result.contextInCallback).not.toBeUndefined();
  expect(result.contextInCallback?.id).toBe(42);
});
