// Tests for the behavior of bake-harness.ts and client-fixture.mjs themselves.
import { expect } from "bun:test";
import { devTest, emptyHtmlFile } from "../bake-harness";

// Plain `await`, not `expect().rejects`: that matcher ticks the event loop from
// inside the call and reorders exit handling.
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err: any) {
    return err.message;
  }
  throw new Error("Expected the promise to reject");
}

devTest("a write after a fetch of a failing route waits for the reloaded page", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      body: "<h1>Hello</h1>",
    }),
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ['index.html: error: Could not resolve: "styles.css". Maybe you need to "bun install"?'],
    });
    // The fetch re-bundles the failing route and publishes its errors again.
    // The client acks that build although no write is waiting for the ack.
    expect((await dev.fetch("/")).status).toBe(500);
    await c.expectReload(async () => {
      await dev.write("styles.css", `h1 { color: red; }`);
    });
    // The write resolved on the reloaded page's ack, so its stylesheet is loaded.
    await c.style("h1").color.expect.toBe("red");
  },
});

devTest("expectElemText waits for a DOM update that lands after the ack", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: "<h1>Hello</h1>",
    }),
    "index.ts": `
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.js`
      setTimeout(() => {
        document.querySelector("h1").innerHTML = "Later";
      }, 100);
      return;
    `;
    await c.expectElemText("h1", "Later");
    expect(await c.elemText("h1")).toBe("Later");
  },
});

devTest("disposing a client reports an exit code it produces while it is being disposed", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: "<h1>Hello</h1>",
    }),
    "index.ts": `
      console.log("loaded");
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    const c = await dev.client("/");
    await c.expectMessage("loaded");

    // The fixture is left expecting a reload, so the exit(0) that dispose
    // requests becomes exitCodeMap.reloadNotCalled.
    expect(await rejectionMessage(c.expectReload(() => Promise.reject(new Error("abort before reloading"))))).toBe(
      "abort before reloading",
    );

    expect(await rejectionMessage(c[Symbol.asyncDispose]())).toBe('Client exited: "Reload not called"');
  },
});
