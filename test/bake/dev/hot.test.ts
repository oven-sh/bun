// Hot tests ensure that the `import.meta.hot` interface is functional
import { expect } from "bun:test";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { Client, Dev, devTest, emptyHtmlFile } from "../bake-harness";

devTest("import.meta.hot.accept basic", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("Hello, world!");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("Hello, world!");
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
          console.log("Hello, Bun!");
          import.meta.hot.accept(newModule => {
            console.log(Object.keys(newModule));
            console.log(newModule.method());
          });
        `,
      );
    });
    await c.expectMessage("Hello, Bun!");
    await dev.write(
      "index.ts",
      `
        export function method() {
          return "Bun";
        }
        import.meta.hot.accept(newModule => {
          console.log(Object.keys(newModule));
        });
      `,
    );
    await c.expectMessage(["method"], "Bun");
    await dev.write(
      "index.ts",
      `
        console.log("Without anything.");
      `,
    );
    await c.expectMessage("Without anything.", []);
    await c.expectReload(async () => {
      await dev.writeNoChanges("index.ts");
    });
    await c.expectMessage("Without anything.");
  },
});
devTest("import.meta.hot.accept patches imports", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["a.ts"],
    }),
    "a.ts": `
      import { doSomething } from './b';
      console.log("A");
      globalThis.callFunction = () => doSomething();
    `,
    "b.ts": `
      import { reasonableState, inc } from './c';
      console.log("B");
      let b = 0;
      export function doSomething() {
        using _ = { [Symbol.dispose]: inc };
        return "A!" + (b++) + "!" + (reasonableState);
      }
      import.meta.hot.accept();
    `,
    "c.ts": `
      export let reasonableState = 0;
      export function inc() {
        reasonableState++;
      }
      console.log("C");
      // import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("C", "B", "A");
    expect(await c.js<string>`callFunction()`).toBe("A!0!0");
    expect(await c.js<string>`callFunction()`).toBe("A!1!1");
    await dev.patch("c.ts", { find: "0", replace: "5" });
    await c.expectMessage("C", "B"); // C does not self-accept
    expect(await c.js<string>`callFunction()`).toBe("A!0!5");
    expect(await c.js<string>`callFunction()`).toBe("A!1!6");
    await dev.patch("b.ts", { find: "A!", replace: "B!" });
    await c.expectMessage("B"); // B does not cause C to re-evaluate
    expect(await c.js<string>`callFunction()`).toBe("B!0!7");
    expect(await c.js<string>`callFunction()`).toBe("B!1!8");
    await dev.patch("c.ts", { find: "// ", replace: "" });
    await c.expectMessage("C", "B"); // C does not self-accept YET
    expect(await c.js<string>`callFunction()`).toBe("B!0!5");
    expect(await c.js<string>`callFunction()`).toBe("B!1!6");
    await dev.patch("c.ts", { find: "import.meta.hot.accept();", replace: "" });
    await c.expectMessage("C"); // C self accepted even if the new one doesnt
    expect(await c.js<string>`callFunction()`).toBe("B!2!5");
    expect(await c.js<string>`callFunction()`).toBe("B!3!6");
  },
});
devTest("import.meta.hot.accept specifier", {
  timeoutMultiplier: 3,
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["a.ts"],
    }),
    //    a
    //  b   c
    //    d
    "a.ts": `
      import './b';
      import './c';
      console.log("A");
    `,
    "b.ts": `
      import './d';
      console.log("B");
      import.meta.hot.accept("oh no", (newModule) => {
        console.log('B:' + newModule.default);
      })
    `,
    "c.ts": `
      import './d';
      console.log("C");
    `,
    "d.ts": `
      console.log("D");
      export default "hey!";

      queueMicrotask(() => {
        console.log("end");
      });
    `,
    "unrelated.ts": `
      export default "unrelated";
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/", {
        errors: [
          "b.ts:3:24: error: Dependencies to `import.meta.hot.accept` must be statically analyzable module specifiers matching direct imports.",
        ],
      });
      await dev.patch("b.ts", {
        find: "oh no",
        replace: "./d.ts",
        errors: [
          "b.ts:3:24: error: Dependencies to `import.meta.hot.accept` must be statically analyzable module specifiers matching direct imports.",
        ],
      });
      await c.expectReload(async () => {
        await dev.patch("b.ts", { find: "./d.ts", replace: "./d" });
      });
      // Module evaluation order is guaranteed since there are no top-level
      // await. `hmr-module.ts` does not use promises for synchronous ESM.
      await c.expectMessage("D", "B", "C", "A", "end");
      await c.expectReload(async () => {
        // D -> C -> A causes a page reload.
        await dev.write(
          "d.ts",
          `
            console.log("D2");
            export default "hey2!";
          `,
        );
      });
      await c.expectMessage("D2", "B", "C", "A");
    }
    await dev.write(
      "c.ts",
      `
        import './d';
        import './unrelated';
        console.log("C");
        import.meta.hot.accept();
      `,
    );
    {
      await using c = await dev.client("/");
      await c.expectMessage("D2", "B", "C", "A");
      await dev.write(
        "d.ts",
        `
          console.log("D3");
          export default "hey3!";
        `,
      );
      await c.expectMessage("D3", "C", "B:hey3!");

      await dev.write(
        "c.ts",
        `
          import './d';
          import './unrelated';
          console.log("C");
          import.meta.hot.accept("oh no", (newModule) => {
            console.log('C:' + newModule.default);
          });
        `,
        {
          errors: [
            "c.ts:4:24: error: Dependencies to `import.meta.hot.accept` must be statically analyzable module specifiers matching direct imports.",
          ],
        },
      );
      await dev.patch("c.ts", {
        find: "oh no",
        replace: "./d",
      });
      await c.expectMessage("C"); // no-reload because prev self-accepted
      await dev.write(
        "d.ts",
        `
          console.log("D4");
          export default "hey4!";
          import.meta.hot.accept();
        `,
      );
      // This order is guaranteed regardless of top-level await if it had existed.
      await c.expectMessage("D4", "B:hey4!", "C:hey4!");
      await dev.write(
        "d.ts",
        `
          console.log("D5");
          export default "hey5!";
          import.meta.hot.accept();
        `,
      );
      await c.expectMessage("D5", "B:hey5!", "C:hey5!");
      await c.hardReload();
      await c.expectMessage("D5", "B", "C", "A");
      await dev.write(
        "d.ts",
        `
          console.log("D6");
          export default "hey6!";
          import.meta.hot.accept();
        `,
      );
      await c.expectMessage("D6", "B:hey6!", "C:hey6!");
    }
  },
});
devTest("import.meta.hot.accept multiple modules", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { count } from "./counter.ts";
      import { name } from "./name.ts";
      console.log("Initial: " + name + " " + count);
      
      import.meta.hot.accept(["./counter.ts", "./name.ts"], (newModules) => {
        if (newModules[0]) console.log("Counter updated: " + newModules[0].count);
        if (newModules[1]) console.log("Name updated: " + newModules[1].name);
      });
    `,
    "counter.ts": `
      export const count = 1;
    `,
    "name.ts": `
      export const name = "Alice";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("Initial: Alice 1");

    await dev.write(
      "counter.ts",
      `
        export const count = 2;
      `,
    );

    await c.expectMessage("Counter updated: 2");

    await dev.write(
      "name.ts",
      `
        export const name = "Bob";
      `,
    );

    await c.expectMessage("Name updated: Bob");

    // Test updating both files
    {
      await using batch = await dev.batchChanges();
      await dev.write(
        "counter.ts",
        `
          export const count = 3;
        `,
      );
      await dev.write(
        "name.ts",
        `
          export const name = "Charlie";
        `,
      );
    }

    await c.expectMessageInAnyOrder("Counter updated: 3", "Name updated: Charlie");
  },
});
// The parser rewrites the `import.meta.hot.accept` dependency list's items in place.
devTest("import.meta.hot.accept with a dependency list from a define", {
  files: {
    "bunfig.toml": `
      [serve.static]
      define = { DEPS = '["./counter.ts"]' }
    `,
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { count } from "./counter.ts";
      console.log("Initial: " + count + " " + JSON.stringify(DEPS));

      import.meta.hot.accept(DEPS, (newModules) => {
        console.log("Counter updated: " + newModules[0].count);
      });
    `,
    "counter.ts": `
      export const count = 1;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(`Initial: 1 ["./counter.ts"]`);

    await dev.write(
      "counter.ts",
      `
        export const count = 2;
      `,
    );
    await c.expectMessage("Counter updated: 2");

    // index.ts doesn't accept itself, so the page reloads and the dev server parses the list again.
    await c.expectReload(async () => {
      await dev.patch("index.ts", { find: "Initial", replace: "Again" });
    });
    await c.expectMessage(`Again: 2 ["./counter.ts"]`);

    await dev.write(
      "counter.ts",
      `
        export const count = 3;
      `,
    );
    await c.expectMessage("Counter updated: 3");
  },
});
devTest("import.meta.hot.data persistence", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      // Initialize or retrieve stored value
      import.meta.hot.data.count ??= 0;
      console.log("Initial count: " + import.meta.hot.data.count);
      
      // Increment the count on each evaluation
      import.meta.hot.data.count++;

      // By using hot.data, you opt into implicit self-acceptance
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("Initial count: 0");
    await dev.writeNoChanges("index.ts");
    await c.expectMessage("Initial count: 1");
    await dev.writeNoChanges("index.ts");
    await c.expectMessage("Initial count: 2");
    await dev.writeNoChanges("index.ts");
    await c.expectMessage("Initial count: 3");
  },
});
devTest("import.meta.hot.dispose cleanup", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("Setting up");
      const id = setInterval(() => {}, 1000);
      
      import.meta.hot.dispose(() => {
        console.log("Cleaning up");
        clearInterval(id);
      });
      
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("Setting up");

    await dev.write(
      "index.ts",
      `
        console.log("Setting up again");
        const id = setInterval(() => {}, 1000);
        
        import.meta.hot.dispose(() => {
          console.log("Cleaning up");
          clearInterval(id);
        });
        
        import.meta.hot.accept();
      `,
    );

    await c.expectMessage("Cleaning up", "Setting up again");

    await dev.write(
      "index.ts",
      `
        console.log("Third setup");
      `,
    );

    await c.expectMessage("Cleaning up", "Third setup");
  },
});
devTest("import.meta.hot invalid usage", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      const hot = import.meta.hot;
      try {
        hot.accept;
        throw 'did not throw';
      } catch (e) {
        console.log(e?.message ?? e);
      }
      const accept = import.meta.hot.accept;
      try {
        accept("./something.ts", () => {});
        throw 'did not throw';
      } catch (e) {
        console.log(e?.message ?? e);
      }
      const meta = import.meta;
      try {
        meta.hot.accept();
        throw 'did not throw';
      } catch (e) {
        console.log(e?.message ?? e);
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(
      "import.meta.hot.accept cannot be used indirectly.",
      '"import.meta.hot.accept" must be directly called with string literals for the specifiers. This way, the bundler can pre-process the arguments.',
      "import.meta.hot cannot be used indirectly.",
    );
  },
});
devTest("import.meta.hot on/off events", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("Initial setup");
      // Add event listener
      import.meta.hot.on("vite:beforeUpdate", () => {
        console.log("Before update event");
      });
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("Initial setup");
    await dev.write(
      "index.ts",
      `
        console.log("Updated setup");
        // Events implementation is partial according to docs
        import.meta.hot.on("vite:beforeUpdate", () => {
          console.log("Before update event 2");
        });
        const handler = () => {
          console.log("Another handler");
        };
        import.meta.hot.on("vite:beforeUpdate", handler);
        // Remove the handler
        import.meta.hot.off("vite:beforeUpdate", handler);
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage("Updated setup");
    await dev.write(
      "index.ts",
      `
        console.log("Third update");
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage("Third update");
  },
});
devTest("hmr forwards every merged inotify sub-path from a directory batch", {
  // Windows can't rename over an open file (EPERM) and the merged-names
  // code path under test is `Environment.isLinux`-gated anyway.
  skip: ["win32", "darwin"],
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import value from "./dep";
      console.log(value);
      import.meta.hot.accept();
    `,
    "dep.ts": `
      export default "initial";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("initial");

    // Editors that save atomically (vim, emacs, IntelliJ) write to a temp
    // file in the same directory and rename over the target. inotify
    // reports CREATE tmp + MODIFY tmp + MOVED_FROM tmp + MOVED_TO target on
    // the directory watch, and INotifyWatcher merges same-index events
    // into one WatchEvent carrying N names. `DevServer.onFileUpdate` must
    // forward every name to appendDir — indexing only the first drops the
    // rename target.
    //
    // The per-file watch on the target's old inode is dead after rename-
    // over, so to keep it from independently masking the directory-watch
    // bug we first unlink the target (removing the file watch) and then
    // flood the directory with decoy CREATE events so the rename target
    // is never alone in its inotify batch.
    for (let round = 1; round <= 5; round++) {
      const target = dev.join("dep.ts");
      const content = `export default "atomic ${round}";\n`;
      {
        await using _wait = await dev.batchChanges();
        // Remove the direct file watch so only the directory watch can
        // pick up the new dep.ts.
        unlinkSync(target);
        // Decoys: many rapid CREATEs in the same directory force inotify
        // to coalesce into a single read() batch so the merge path runs.
        for (let i = 0; i < 32; i++) {
          writeFileSync(`${target}.${i}.swp`, content);
        }
        renameSync(`${target}.0.swp`, target);
        for (let i = 1; i < 32; i++) {
          unlinkSync(`${target}.${i}.swp`);
        }
      }
      await c.expectMessage(`atomic ${round}`);
    }
  },
});
devTest("hot update frames are not delivered to application websocket topics", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("initial");
      import.meta.hot.accept();
    `,
    "bun.app.ts": `
      import html from "./index.html";
      export default {
        static: {
          "/": html,
        },
        fetch(req, server) {
          if (new URL(req.url).pathname === "/app-ws") {
            if (server.upgrade(req)) return;
            return new Response("upgrade failed", { status: 400 });
          }
          return new Response("Not Found", { status: 404 });
        },
        websocket: {
          open(ws) {
            ws.subscribe("h");
            ws.subscribe("e");
            ws.subscribe("E");
            ws.send("subscribed");
          },
          message(ws, message) {
            ws.send("echo:" + message);
          },
        },
      };
    `,
  },
  htmlFiles: [],
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("initial");

    const received: string[] = [];
    const ws = new WebSocket(dev.baseUrl.replace("http", "ws") + "/app-ws");
    try {
      const opened = Promise.withResolvers<void>();
      const echoed = Promise.withResolvers<void>();
      ws.onerror = () => {
        opened.reject(new Error("application websocket errored"));
        echoed.reject(new Error("application websocket errored"));
      };
      ws.onclose = () => {
        opened.reject(new Error("application websocket closed"));
        echoed.reject(new Error("application websocket closed"));
      };
      ws.onmessage = event => {
        if (event.data === "subscribed") {
          opened.resolve();
          return;
        }
        received.push(typeof event.data === "string" ? event.data : "<binary frame>");
        if (event.data === "echo:after-update") {
          echoed.resolve();
        }
      };
      await opened.promise;

      await dev.write(
        "index.ts",
        `
          console.log("updated");
          import.meta.hot.accept();
        `,
      );
      await c.expectMessage("updated");

      ws.send("after-update");
      await echoed.promise;
      expect(received).toEqual(["echo:after-update"]);
    } finally {
      ws.onclose = null;
      ws.close();
    }
  },
});

devTest("dev.write resolves only after the new module body has run", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      globalThis.marker = "initial";
      console.log("ready");
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("ready");
    expect(await c.js`globalThis.marker`).toBe("initial");

    await dev.write(
      "index.ts",
      `
        await new Promise(r => setTimeout(r, 500));
        globalThis.marker = "updated";
        import.meta.hot.accept();
      `,
      // errors: null skips the post-write expectErrorOverlay poll (5 * 200ms),
      // which would otherwise mask a premature ack.
      { errors: null },
    );
    // dev.write resolves on bun:afterUpdate, i.e. after replaceModules has
    // awaited the 500ms TLA. Acking on WS receipt would see "initial" here.
    expect(await c.js`globalThis.marker`).toBe("updated");
  },
});

/**
 * Saves the files of `version(n)` in one batch, in their order, and returns `n` once one hot update
 * had all of them. On a slow machine the dev server can get to a later file only after it built the
 * earlier ones. The page then gets two hot updates, which is not the case under test, so the files
 * are saved again as version `n + 1`. With `inOrder`, the update also has to list them as they
 * were written: the watcher sorts the files of one read.
 */
async function saveInOneUpdate(
  dev: Dev,
  c: Client,
  first: number,
  version: (n: number) => Record<string, string>,
  inOrder = false,
) {
  for (let n = first; n < first + 5; n++) {
    const files = Object.entries(version(n));
    {
      await using batch = await dev.batchChanges();
      // `batchChanges` waited for the updates of the attempt before this one.
      if (n !== first) c.messages.length = 0;
      for (const [file, text] of files) await dev.write(file, text);
    }
    // Each module of a hot update starts a line with its id.
    const at = (update: string) => files.map(([file]) => update.indexOf(`\n  ${JSON.stringify(file)}`));
    let found = at(await c.getMostRecentHmrChunk());
    if (!found.includes(-1) && (!inOrder || found.every((index, i) => i === 0 || index > found[i - 1]))) return n;
    // The dev server builds the files in the order of the writes. The last one ends the attempt.
    while (found.at(-1) === -1) found = at(await c.getMostRecentHmrChunk());
  }
  throw new Error("The files did not get to the page in one hot update");
}

// A hot update holds its modules in the order in which the watcher saw the files, so `importer.ts`
// is first. It must not run against the previous evaluation of `imported.ts`.
devTest("a hot update evaluates a saved module before the saved module that imports it", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./importer";
    `,
    "importer.ts": `
      import { value } from "./imported";
      console.log("importer: " + value);
      import.meta.hot.accept();
    `,
    "imported.ts": `export const value = 1;`,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("importer: 1");
    const n = await saveInOneUpdate(dev, c, 2, n => ({
      "importer.ts": `
        import { value, added } from "./imported";
        console.log("importer: " + value + " " + added);
        import.meta.hot.accept();
      `,
      "imported.ts": `export const value = ${n}; export const added = "added";`,
    }));
    await c.expectMessage(`importer: ${n} added`);
  },
});

// `index.ts` is not saved. It comes right after the first saved module in the update, in either order.
devTest("a module that accepts a hot update is evaluated after every saved module that it imports", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { first } from "./first";
      import { second } from "./second";
      console.log("index: " + first + " " + second);
      import.meta.hot.accept();
    `,
    "first.ts": `export const first = "first 1";`,
    "second.ts": `export const second = "second 1";`,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("index: first 1 second 1");
    const n = await saveInOneUpdate(dev, c, 2, n => ({
      "first.ts": `export const first = "first ${n}";`,
      "second.ts": `export const second = "second ${n}";`,
    }));
    await c.expectMessage(`index: first ${n} second ${n}`);
  },
});

// The importer loads `imported.ts` before the update gets to it. The callback of the body that is
// replaced gets the new module, and the callback that the new body registers then is kept for the
// next save.
devTest("a module that its importer loads first in a hot update keeps the accept callback of its new body", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./importer";
    `,
    "importer.ts": `
      import { value } from "./imported";
      console.log("importer: " + value);
      import.meta.hot.accept();
    `,
    "imported.ts": `
      export const value = 1;
      import.meta.hot.accept(next => console.log("body 1 accepts: " + next.value));
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("importer: 1");
    let n = 1;
    for (let save = 0; save < 2; save++) {
      n = await saveInOneUpdate(dev, c, n + 1, n => ({
        "importer.ts": `
          import { value } from "./imported";
          console.log("importer: " + value);
          import.meta.hot.accept();
          // ${n}
        `,
        "imported.ts": `
          export const value = ${n};
          import.meta.hot.accept(next => console.log("body ${n} accepts: " + next.value));
        `,
      }));
      await c.expectMessage(`importer: ${n}`, `body ${n - 1} accepts: ${n}`);
    }
  },
});

// Only `util.ts` is saved. Each module that accepts the update gets its callback right after its
// own new body, before the next module runs: a callback can hand the page over to the new body.
devTest("the accept callback of a module runs before the next module of the hot update", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./one";
      import "./two";
    `,
    "one.ts": `
      import { value } from "./util";
      console.log("one: " + value);
      import.meta.hot.accept(() => console.log("one accepts"));
    `,
    "two.ts": `
      import { value } from "./util";
      console.log("two: " + value);
      import.meta.hot.accept(() => console.log("two accepts"));
    `,
    "util.ts": `export const value = 1;`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("one: 1", "two: 1");
    await dev.write("util.ts", `export const value = 2;`);
    await c.expectMessage("one: 2", "one accepts", "two: 2", "two accepts");
  },
});

// The importer starts the load of `tla.ts`, which still waits when the update gets to `tla.ts`
// itself. The update waits for that load, and then calls the accept callback of `tla.ts` once.
devTest("the accept callback of a saved module with top-level await waits for the load that its importer started", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./importer";
    `,
    "importer.ts": `
      import { value } from "./tla";
      console.log("importer: " + value);
      import.meta.hot.accept();
    `,
    "tla.ts": `
      console.log("tla starts");
      export const value = await Promise.resolve(1);
      import.meta.hot.accept(next => console.log("accepted: " + next.value));
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("tla starts", "importer: 1");
    const n = await saveInOneUpdate(
      dev,
      c,
      2,
      n => ({
        "importer.ts": `
          import { value } from "./tla";
          console.log("importer: " + value);
          import.meta.hot.accept();
          // ${n}
        `,
        "tla.ts": `
          console.log("tla starts");
          export const value = await Promise.resolve(${n});
          import.meta.hot.accept(next => console.log("accepted: " + next.value));
        `,
      }),
      true,
    );
    await c.expectMessage("tla starts", `accepted: ${n}`, `importer: ${n}`);
  },
});

// `user.ts` is saved with `shared.ts` and loads it with require() before the update gets to
// `shared.ts`. `reader.ts` is not saved, and has the new module as soon as require() returns.
for (const [form, shared] of [
  ["an ES module", `export const value = 1; import.meta.hot.accept(() => {});`],
  ["a CommonJS module", `module.exports = { value: 1 };`],
] as const) {
  devTest(
    `a saved module that another saved module loads with require() reaches its other importers (${form} before the save)`,
    {
      files: {
        "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
        "index.ts": `
        import "./reader";
        import "./user";
        import.meta.hot.accept();
      `,
        "reader.ts": `
        import { value } from "./shared";
        globalThis.readShared = () => value;
      `,
        "shared.ts": shared,
        "user.ts": `
        console.log("user: " + require("./shared").value + " reader: " + readShared());
        import.meta.hot.accept();
      `,
      },
      async test(dev) {
        await using c = await dev.client("/", { storeHotChunks: true });
        await c.expectMessage("user: 1 reader: 1");
        const n = await saveInOneUpdate(
          dev,
          c,
          2,
          n => ({
            "user.ts": `
            console.log("user: " + require("./shared").value + " reader: " + readShared());
            import.meta.hot.accept();
            // ${n}
          `,
            "shared.ts": `
            export const value = ${n};
            import.meta.hot.accept(() => {});
          `,
          }),
          true,
        );
        await c.expectMessage(`user: ${n} reader: ${n}`);
        expect(await c.js<number>`readShared()`).toBe(n);
      },
    },
  );
}

// require() refuses a module with top-level await that is not evaluated yet. The refusal must not
// keep the update from evaluating `tla.ts` when it gets to it.
devTest("a saved module with top-level await still loads after require() of it was refused", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./user";
    `,
    "user.ts": `
      import("./tla");
      console.log("user: loaded");
      import.meta.hot.accept();
    `,
    "tla.ts": `
      console.log("tla: " + (await Promise.resolve(1)));
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("user: loaded", "tla: 1");
    const n = await saveInOneUpdate(
      dev,
      c,
      2,
      n => ({
        "user.ts": `
          try {
            require("./tla");
            console.log("user: loaded");
          } catch (e) {
            console.log("user: refused");
          }
          import.meta.hot.accept();
          // ${n}
        `,
        "tla.ts": `
          console.log("tla: " + (await Promise.resolve(${n})));
          import.meta.hot.accept();
        `,
      }),
      true,
    );
    await c.expectMessage("user: refused", `tla: ${n}`);
  },
});

// `user.ts` starts the load of `tla.ts` with import(), before the update gets to `tla.ts`. The
// update waits for that load too, and then calls the accept callback of `tla.ts`.
devTest("a hot update waits for the load of a saved module that import() started", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./user";
    `,
    "user.ts": `
      import("./tla");
      import.meta.hot.accept();
    `,
    "tla.ts": `
      console.log("tla starts");
      export const value = await Promise.resolve(1);
      import.meta.hot.accept(next => console.log("accepted: " + next.value));
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("tla starts");
    const n = await saveInOneUpdate(
      dev,
      c,
      2,
      n => ({
        "user.ts": `
          import("./tla").then(tla => console.log("user: imported " + tla.value));
          import.meta.hot.accept();
          // ${n}
        `,
        "tla.ts": `
          console.log("tla starts");
          export const value = await Promise.resolve(${n});
          import.meta.hot.accept(next => console.log("accepted: " + next.value));
        `,
      }),
      true,
    );
    await c.expectMessageInAnyOrder("tla starts", `accepted: ${n}`, `user: imported ${n}`);
  },
});

// `about.ts` is in the update, and is loaded for the first time while the dispose handler of
// `other.ts` waits. That load ran the new code already, so the update leaves the module alone.
devTest("a module that is first loaded while a dispose handler waits keeps its accept handler", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./other";
      globalThis.loadAbout = () => import("./about");
    `,
    "other.ts": `
      console.log("other: 1");
      import.meta.hot.accept();
      import.meta.hot.dispose(() => loadAbout());
    `,
    "about.ts": `
      console.log("about: 1");
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("other: 1");
    const n = await saveInOneUpdate(dev, c, 2, n => ({
      "other.ts": `
        console.log("other: ${n}");
        import.meta.hot.accept();
        import.meta.hot.dispose(() => loadAbout());
      `,
      "about.ts": `
        console.log("about: ${n}");
        import.meta.hot.accept();
      `,
    }));
    await c.expectMessageInAnyOrder(`about: ${n}`, `other: ${n}`);
    await dev.write(
      "about.ts",
      `
        console.log("about: ${n + 1}");
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage(`about: ${n + 1}`);
  },
});

// A save of `x.ts` alone. `b.ts` accepts the update and is in an import cycle with `x.ts`: it is
// evaluated after `x.ts`, not under it.
devTest("a self-accepting module in an import cycle with the saved module is evaluated after it", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { b } from "./b";
      console.log("index " + b);
    `,
    "b.ts": `
      import { x } from "./x";
      export const b = "b(" + x + ")";
      console.log("b " + b);
      import.meta.hot.accept();
    `,
    // `x.ts` reads `b` only from a function: in a first load `b.ts` is not evaluated yet.
    "x.ts": `
      import { b } from "./b";
      export const x = "x1";
      export const readB = () => b;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("b b(x1)", "index b(x1)");
    await dev.patch("x.ts", { find: '"x1"', replace: '"x2"' });
    await c.expectMessage("b b(x2)");
    await dev.patch("x.ts", { find: '"x2"', replace: '"x3"' });
    await c.expectMessage("b b(x3)");
  },
});

// A save of a JSON file. The dev server sends its importer again, before the file.
for (const dispose of [false, true]) {
  devTest(`a save of an imported JSON file reaches its importer${dispose ? ", which is disposed of once" : ""}`, {
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      "index.ts": `
        import data, { value } from "./data.json";
        console.log("json: " + data.value + " " + value);
        globalThis.readJson = () => data.value + " " + value;
        import.meta.hot.accept();
        ${dispose ? `import.meta.hot.dispose(() => console.log("disposed"));` : ""}
      `,
      "data.json": `{ "value": 1 }`,
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("json: 1 1");
      for (const n of [2, 3]) {
        await dev.write("data.json", `{ "value": ${n} }`);
        await c.expectMessage(...(dispose ? ["disposed"] : []), `json: ${n} ${n}`);
        expect(await c.js<string>`readJson()`).toBe(`${n} ${n}`);
      }
    },
  });
}

devTest("a save of a CommonJS module reaches the ES modules that import it", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import dep from "./dep.cjs";
      console.log("cjs: " + dep.value);
      globalThis.readCjs = () => dep.value;
      import.meta.hot.accept();
    `,
    "dep.cjs": `module.exports = { value: 1 };`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("cjs: 1");
    for (const n of [2, 3]) {
      await dev.write("dep.cjs", `module.exports = { value: ${n} };`);
      await c.expectMessage(`cjs: ${n}`);
      expect(await c.js<number>`readCjs()`).toBe(n);
    }
  },
});

// What tsc 6.0.2 prints with `module: commonjs`. The barrel is not saved and does not run again: it
// holds the `exports` object of the file behind it, which has to stay the same object.
const tscOutput = {
  /** `export const helper = "<value>";` */
  helper: (value: string) => `
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.helper = void 0;
    exports.helper = "${value}";
  `,
  /** `export { helper } from "./helper";` */
  namedReexport: `
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.helper = void 0;
    var helper_1 = require("./helper");
    Object.defineProperty(exports, "helper", { enumerable: true, get: function () { return helper_1.helper; } });
  `,
  /** `export * from "./helper";` */
  exportStar: `
    "use strict";
    var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = { enumerable: true, get: function() { return m[k]; } };
        }
        Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
    }));
    var __exportStar = (this && this.__exportStar) || function(m, exports) {
        for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require("./helper"), exports);
  `,
};
for (const [name, barrel] of [
  ["a named re-export", tscOutput.namedReexport],
  ["`export *`", tscOutput.exportStar],
] as const) {
  devTest(`a save of the file behind ${name} in tsc CommonJS output updates in place`, {
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      "index.ts": `
        import * as dep from "./lib/dep.js";
        console.log("helper=" + dep.helper);
        import.meta.hot.accept();
      `,
      "lib/dep.js": barrel,
      "lib/helper.js": tscOutput.helper("h1"),
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("helper=h1");
      await dev.write("lib/helper.js", tscOutput.helper("h2"));
      await c.expectMessage("helper=h2");
    },
  });
}
