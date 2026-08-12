// Tests for the behavior of bake-harness.ts itself.
import { expect } from "bun:test";
import { devTest, emptyHtmlFile } from "../bake-harness";

const files = {
  "index.html": emptyHtmlFile({
    scripts: ["index.ts"],
    body: "<h1>Hello</h1>",
  }),
  "index.ts": `
    console.log("loaded");
    import.meta.hot.accept();
  `,
};

/**
 * Awaits `promise` like `await using` does and returns the rejection message.
 *
 * Not `expect(promise).rejects`: that matcher waits by ticking the event loop
 * from inside the matcher call, and a client exit processed that way runs
 * `onExit` before the `await proc.exited` continuation in `Client`'s dispose,
 * which is the opposite of the order a plain `await` observes.
 */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err: any) {
    return err.message;
  }
  throw new Error("Expected the promise to reject");
}

devTest("disposing a client reports an exit code the client produces while it is being disposed", {
  files,
  async test(dev) {
    const c = await dev.client("/");
    await c.expectMessage("loaded");

    // Leave the client fixture expecting a reload that never happens. Its exit
    // handler then turns the exit(0) requested by dispose into
    // exitCodeMap.reloadNotCalled, so the non-zero exit happens while dispose
    // is waiting for the process.
    expect(await rejectionMessage(c.expectReload(() => Promise.reject(new Error("abort before reloading"))))).toBe(
      "abort before reloading",
    );

    expect(await rejectionMessage(c[Symbol.asyncDispose]())).toBe('Client exited: "Reload not called"');
  },
});

devTest("disposing a client reports an exit code the client produced earlier", {
  files,
  async test(dev) {
    const c = await dev.client("/");
    await c.expectMessage("loaded");

    // index.ts self-accepts, so the update is evaluated in place and the
    // fixture exits with exitCodeMap.consoleError as soon as the new module
    // logs an error: the client is gone before dispose starts.
    expect(
      await rejectionMessage(
        dev.write(
          "index.ts",
          `
            console.error("boom");
          `,
        ),
      ),
    ).toBe("Client exited while applying hot update: Runtime error");

    expect(await rejectionMessage(c[Symbol.asyncDispose]())).toBe('Client exited: "Runtime error"');
  },
});
