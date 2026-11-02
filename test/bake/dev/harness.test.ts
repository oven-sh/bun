// Tests for the behavior of bake-harness.ts and client-fixture.mjs themselves.
import { expect } from "bun:test";
import { appendFileSync, linkSync, mkdirSync } from "node:fs";
import { devTest, emptyHtmlFile, WatchSynchronization } from "../bake-harness";

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

devTest("the files of a batch reach the page in one hot update", {
  // Only on Linux does `batchChanges` know that the dev server has every change.
  skip: ["darwin", "win32"],
  // The watcher thread of the dev server keeps a change for 300 ms, or until
  // the next change.
  env: { BUN_INOTIFY_COALESCE_INTERVAL: "300000000" },
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./a";
      import "./b";
      import.meta.hot.accept();
    `,
    "a.ts": `import.meta.hot.accept();`,
    "b.ts": `import.meta.hot.accept();`,
  },
  async test(dev) {
    // A second name for `b.ts`, in a folder that the dev server does not
    // watch. A write through this name is one inotify event, not two. Two
    // events can reach the watcher thread one by one, and then it does not
    // keep them. The dev server watches nothing before the first request, so
    // this setup makes no watcher event.
    mkdirSync(dev.join("link"));
    linkSync(dev.join("b.ts"), dev.join("link/b.ts"));

    await using c = await dev.client("/", { storeHotChunks: true });
    // The marks that each hot update carries.
    const updates: string[][] = [];
    c.on("hmr-chunk", (chunk: string) => updates.push([...new Set(chunk.match(/(?<=")[ab]\d(?=")/g))].sort()));
    {
      await using batch = await dev.batchChanges();
      const seenFiles = Promise.withResolvers<void>();
      dev.on("watch_synchronization", kind => kind === WatchSynchronization.SeenFiles && seenFiles.resolve());
      appendFileSync(dev.join("a.ts"), `\nexport const mark = "a1";`);
      await seenFiles.promise;
      // The dev server has the change to `a.ts`. The watcher thread still has
      // the change to `b.ts` when the batch ends.
      appendFileSync(dev.join("link/b.ts"), `\nexport const mark = "b1";`);
    }
    // A change that the batch left behind reaches the page before this update, or in it.
    await dev.write("a.ts", `export const mark = "a2"; import.meta.hot.accept();`);
    expect(updates).toEqual([["a1", "b1"], ["a2"]]);
  },
});

devTest("a batch without a change is released and sends no hot update", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      console.log("loaded");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("loaded");
    // On Linux `batchChanges` changes a fence file in a watched folder. That
    // change is not for the page.
    await c.expectNoWebSocketActivity(async () => {
      await using batch = await dev.batchChanges();
    });
  },
});
