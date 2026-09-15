// Hot tests ensure that the `import.meta.hot` interface is functional
//
// Every devTest boots a dev server and a happy-dom client. Together they cost
// about half a second per case, so cases that start from the same project are
// written as one sequence of edits on one server. Each step asserts the exact
// console output of the update it triggers.
import { expect } from "bun:test";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { devTest, emptyHtmlFile } from "../bake-harness";

devTest("import.meta.hot.accept: self-accept callbacks, then accept([deps])", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("Hello, world!");
    `,
    // Imported by a later version of index.ts
    "counter.ts": `
      export const count = 1;
    `,
    "name.ts": `
      export const name = "Alice";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("Hello, world!");

    // A module that does not accept reloads the page when it changes.
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

    // The previous version's callback runs with the new module's exports.
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

    // A version without accept() is still swapped in, because the version it
    // replaces accepted. The new body runs before the old callback.
    await dev.write(
      "index.ts",
      `
        console.log("Without anything.");
      `,
    );
    await c.expectMessage("Without anything.", []);

    // Now nothing accepts, so the next change reloads again.
    await c.expectReload(async () => {
      await dev.writeNoChanges("index.ts");
    });
    await c.expectMessage("Without anything.");

    // accept([deps], cb): updates to the listed imports are applied in place.
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
          import { count } from "./counter.ts";
          import { name } from "./name.ts";
          console.log("Initial: " + name + " " + count);
          globalThis.read = () => name + " " + count;

          import.meta.hot.accept(["./counter.ts", "./name.ts"], (newModules) => {
            if (newModules[0]) console.log("Counter updated: " + newModules[0].count);
            if (newModules[1]) console.log("Name updated: " + newModules[1].name);
          });
        `,
      );
    });
    await c.expectMessage("Initial: Alice 1");

    await dev.write(
      "counter.ts",
      `
        export const count = 2;
      `,
    );
    await c.expectMessage("Counter updated: 2");
    // The importer's live bindings see the new export.
    expect(await c.js<string>`read()`).toBe("Alice 2");

    await dev.write(
      "name.ts",
      `
        export const name = "Bob";
      `,
    );
    await c.expectMessage("Name updated: Bob");
    expect(await c.js<string>`read()`).toBe("Bob 2");

    // Both dependencies in one update
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
    expect(await c.js<string>`read()`).toBe("Charlie 3");

    // Accepting dependencies does not make a module self-accepting: editing it
    // reloads the page, and the fresh page sees the updated dependencies.
    await c.expectReload(async () => {
      await dev.writeNoChanges("index.ts");
    });
    await c.expectMessage("Initial: Charlie 3");
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
    // C does not accept yet, so making it self-accept reloads one more time.
    await c.expectReload(async () => {
      await dev.write(
        "c.ts",
        `
          import './d';
          import './unrelated';
          console.log("C");
          import.meta.hot.accept();
        `,
      );
    });
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
  },
});
devTest("import.meta.hot: indirect usage, dispose, on/off, update acks, data", {
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

    // dispose: the callback runs before the new body, and receives hot.data.
    // None of the accept() calls above registered, so this change reloads.
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
          console.log("Setting up");
          import.meta.hot.dispose(data => {
            console.log("Cleaning up, got " + (data === import.meta.hot.data ? "hot.data" : "something else"));
          });
          import.meta.hot.accept();
        `,
      );
    });
    await c.expectMessage("Setting up");
    await dev.write(
      "index.ts",
      `
        console.log("Setting up again");
        import.meta.hot.dispose(() => {
          console.log("Cleaning up again");
        });
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage("Cleaning up, got hot.data", "Setting up again");
    // The replaced version accepted, so a version without accept() is still
    // swapped in, and its predecessor is disposed.
    await dev.write(
      "index.ts",
      `
        console.log("Third setup");
      `,
    );
    await c.expectMessage("Cleaning up again", "Third setup");

    // on/off: bun:beforeUpdate fires before the new body runs, and
    // bun:afterUpdate fires after it. Listeners belong to the version that
    // registered them and are removed when that version is replaced.
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
          console.log("Listening");
          import.meta.hot.on("bun:beforeUpdate", () => {
            console.log("before update (v1)");
          });
          import.meta.hot.on("bun:afterUpdate", () => {
            console.log("after update (v1)");
          });
          import.meta.hot.accept();
        `,
      );
    });
    await c.expectMessage("Listening");
    await dev.write(
      "index.ts",
      `
        console.log("Listening again");
        import.meta.hot.on("bun:beforeUpdate", () => {
          console.log("before update (v2)");
        });
        const removed = () => {
          console.log("removed handler");
        };
        import.meta.hot.on("bun:beforeUpdate", removed);
        import.meta.hot.off("bun:beforeUpdate", removed);
        import.meta.hot.on("bun:afterUpdate", () => {
          console.log("after update (v2)");
        });
        import.meta.hot.accept();
      `,
    );
    // v1's afterUpdate listener is gone by the time the update finishes.
    await c.expectMessage("before update (v1)", "Listening again", "after update (v2)");
    await dev.write(
      "index.ts",
      `
        console.log("Third update");
        globalThis.marker = "initial";
        import.meta.hot.accept();
      `,
    );
    // v2 is still live when beforeUpdate fires, so only off() keeps the
    // removed handler quiet here.
    await c.expectMessage("before update (v2)", "Third update");

    // dev.write resolves only after the new module body has run. The body
    // parks on a promise until the test releases it. The client acks a hot
    // update from bun:afterUpdate, so no ack may arrive while it is parked.
    const acksBefore = c.acksReceived;
    const pendingWrite = dev.write(
      "index.ts",
      `
        console.log("parked");
        await new Promise(resolve => {
          globalThis.release = resolve;
        });
        globalThis.marker = "updated";
        import.meta.hot.accept();
      `,
    );
    await c.expectMessage("parked");
    // The client answers this round trip after anything it already sent, so an
    // ack sent on receipt of the update frame would be counted by now.
    expect(await c.js`globalThis.marker`).toBe("initial");
    expect(c.acksReceived).toBe(acksBefore);
    await c.js`globalThis.release()`;
    await pendingWrite;
    expect(await c.js`globalThis.marker`).toBe("updated");

    // data: writing to hot.data opts into implicit self-acceptance, the object
    // survives each version, and dispose() receives it.
    await dev.write(
      "index.ts",
      `
        import.meta.hot.data.count ??= 0;
        console.log("Initial count: " + import.meta.hot.data.count);
        import.meta.hot.data.count++;
        import.meta.hot.dispose(data => {
          console.log("Disposing with count " + data.count);
        });
      `,
    );
    await c.expectMessage("Initial count: 0");
    await dev.writeNoChanges("index.ts");
    await c.expectMessage("Disposing with count 1", "Initial count: 1");
    await dev.writeNoChanges("index.ts");
    await c.expectMessage("Disposing with count 2", "Initial count: 2");
    await dev.writeNoChanges("index.ts");
    await c.expectMessage("Disposing with count 3", "Initial count: 3");
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
