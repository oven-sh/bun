// Hot tests ensure that the `import.meta.hot` interface is functional
//
// Writes whose outcome the next `expectMessage`/`c.js` assertion pins pass
// `errors: null`. The default (`errors: []`) polls the client for an error
// overlay for a full second after every write, which is most of a write's
// cost. Skipping it loses nothing for those steps: a build error sends no
// update, so the message assertion fails, and a module that throws while it is
// re-evaluated exits the client, which rejects the write. Steps whose subject
// is the overlay itself (an error appears or clears) keep the default.
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
    // Only imported by the accept([deps]) half of the test.
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
    // The module does not accept, so editing it reloads the page.
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
        { errors: null },
      );
    });
    await c.expectMessage("Hello, Bun!");
    // The callback registered by the previous version receives the exports of
    // the new version.
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
      { errors: null },
    );
    await c.expectMessage(["method"], "Bun");
    await dev.write(
      "index.ts",
      `
        console.log("Without anything.");
      `,
      { errors: null },
    );
    await c.expectMessage("Without anything.", []);
    // Saving a non-accepting module without changes still reloads the page.
    // (`dev.writeNoChanges` cannot skip the error overlay poll.)
    await c.expectReload(async () => {
      await dev.write("index.ts", dev.read("index.ts"), { dedent: false, errors: null });
    });
    await c.expectMessage("Without anything.");

    // accept([deps], cb): the callback receives an array with the updated
    // module at its index and `undefined` for the other dependencies, and the
    // importer's live bindings are patched before the callback runs.
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
          import { count } from "./counter.ts";
          import { name } from "./name.ts";
          console.log("Initial: " + name + " " + count);
          globalThis.read = () => name + " " + count;

          import.meta.hot.accept(["./counter.ts", "./name.ts"], ([counter, nameModule]) => {
            console.log([counter ? counter.count : "unchanged", nameModule ? nameModule.name : "unchanged"]);
          });
        `,
        { errors: null },
      );
    });
    await c.expectMessage("Initial: Alice 1");

    await dev.write(
      "counter.ts",
      `
        export const count = 2;
      `,
      { errors: null },
    );
    await c.expectMessage([2, "unchanged"]);
    expect(await c.js<string>`read()`).toBe("Alice 2");

    await dev.write(
      "name.ts",
      `
        export const name = "Bob";
      `,
      { errors: null },
    );
    await c.expectMessage(["unchanged", "Bob"]);
    expect(await c.js<string>`read()`).toBe("Bob 2");

    // One hot update that contains both dependencies calls the callback once
    // per dependency.
    {
      await using batch = await dev.batchChanges({ errors: null });
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
    await c.expectMessageInAnyOrder([3, "unchanged"], ["unchanged", "Charlie"]);
    expect(await c.js<string>`read()`).toBe("Charlie 3");

    // Accepting dependencies does not make the module self-accepting: saving
    // it reloads the page, and the fresh page sees the updated dependencies.
    await c.expectReload(async () => {
      await dev.write("index.ts", dev.read("index.ts"), { dedent: false, errors: null });
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
    await dev.patch("c.ts", { find: "0", replace: "5", errors: null });
    await c.expectMessage("C", "B"); // C does not self-accept
    expect(await c.js<string>`callFunction()`).toBe("A!0!5");
    expect(await c.js<string>`callFunction()`).toBe("A!1!6");
    await dev.patch("b.ts", { find: "A!", replace: "B!", errors: null });
    await c.expectMessage("B"); // B does not cause C to re-evaluate
    expect(await c.js<string>`callFunction()`).toBe("B!0!7");
    expect(await c.js<string>`callFunction()`).toBe("B!1!8");
    await dev.patch("c.ts", { find: "// ", replace: "", errors: null });
    await c.expectMessage("C", "B"); // C does not self-accept YET
    expect(await c.js<string>`callFunction()`).toBe("B!0!5");
    expect(await c.js<string>`callFunction()`).toBe("B!1!6");
    await dev.patch("c.ts", { find: "import.meta.hot.accept();", replace: "", errors: null });
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
      // Fixing the specifier clears the overlay (the default `errors: []`
      // asserts this) and reloads the page.
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
          { errors: null },
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
        { errors: null },
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
      // The default `errors: []` asserts that the overlay is gone again.
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
        { errors: null },
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
        { errors: null },
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
        { errors: null },
      );
      await c.expectMessage("D6", "B:hey6!", "C:hey6!");
    }
  },
});
devTest("import.meta.hot: indirect usage, data, dispose, on/off", {
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
    // Only imported by the on/off section of the test.
    "dep.ts": `
      export default "dep 1";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(
      "import.meta.hot.accept cannot be used indirectly.",
      '"import.meta.hot.accept" must be directly called with string literals for the specifiers. This way, the bundler can pre-process the arguments.',
      "import.meta.hot cannot be used indirectly.",
    );

    // import.meta.hot.data: the module above does not accept, so replacing it
    // reloads the page, and the fresh page starts with empty data.
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
          // Initialize or retrieve stored value
          import.meta.hot.data.count ??= 0;
          console.log("Initial count: " + import.meta.hot.data.count);

          // Increment the count on each evaluation
          import.meta.hot.data.count++;

          // By using hot.data, you opt into implicit self-acceptance
        `,
        { errors: null },
      );
    });
    await c.expectMessage("Initial count: 0");
    // Every save re-evaluates the module with the same data object, even when
    // the contents did not change. (`dev.writeNoChanges` cannot skip the error
    // overlay poll.)
    for (let count = 1; count <= 3; count++) {
      await dev.write("index.ts", dev.read("index.ts"), { dedent: false, errors: null });
      await c.expectMessage("Initial count: " + count);
    }

    // import.meta.hot.dispose: the previous version wrote to hot.data, so this
    // update is applied in place. Dispose callbacks receive the data object
    // and run before the next version is evaluated.
    await dev.write(
      "index.ts",
      `
        console.log("Setting up");

        import.meta.hot.dispose(data => {
          data.disposed = (data.disposed ?? 0) + 1;
          console.log("Cleaning up");
        });

        import.meta.hot.accept();
      `,
      { errors: null },
    );
    await c.expectMessage("Setting up");
    await dev.write(
      "index.ts",
      `
        console.log("Setting up again, disposed " + import.meta.hot.data.disposed + "x");

        import.meta.hot.dispose(data => {
          data.disposed++;
          console.log("Cleaning up again");
        });

        import.meta.hot.accept();
      `,
      { errors: null },
    );
    await c.expectMessage("Cleaning up", "Setting up again, disposed 1x");
    // The replacement does not need to accept for the old version's dispose
    // callback to run.
    await dev.write(
      "index.ts",
      `
        console.log("Third setup, disposed " + import.meta.hot.data.disposed + "x");
      `,
      { errors: null },
    );
    await c.expectMessage("Cleaning up again", "Third setup, disposed 2x");

    // import.meta.hot.on/off: hot.data is still populated, so the module is
    // still implicitly self-accepting and this update is applied in place too.
    await dev.write(
      "index.ts",
      `
        import dep from "./dep.ts";
        console.log("Initial setup: " + dep);
        import.meta.hot.on("bun:beforeUpdate", () => {
          console.log("v1 saw bun:beforeUpdate");
        });
        import.meta.hot.on("bun:afterUpdate", () => {
          console.log("v1 saw bun:afterUpdate");
        });
        import.meta.hot.accept("./dep.ts", newDep => {
          console.log("v1 accepted " + newDep.default);
        });
      `,
      { errors: null },
    );
    // The listeners exist by the time the update that loaded v1 finishes.
    await c.expectMessage("Initial setup: dep 1", "v1 saw bun:afterUpdate");
    // An update that v1 survives fires both events around it.
    await dev.write(
      "dep.ts",
      `
        export default "dep 2";
      `,
      { errors: null },
    );
    await c.expectMessage("v1 saw bun:beforeUpdate", "v1 accepted dep 2", "v1 saw bun:afterUpdate");
    // Replacing v1 removes its listeners. beforeUpdate is emitted before v1 is
    // disposed, so that listener fires one last time. afterUpdate is emitted
    // after, so only v2's listener sees it.
    await dev.write(
      "index.ts",
      `
        console.log("Updated setup");
        const handler = () => {
          console.log("removed handler");
        };
        import.meta.hot.on("bun:beforeUpdate", handler);
        import.meta.hot.off("bun:beforeUpdate", handler);
        import.meta.hot.on("bun:beforeUpdate", () => {
          console.log("v2 saw bun:beforeUpdate");
        });
        import.meta.hot.on("bun:afterUpdate", () => {
          console.log("v2 saw bun:afterUpdate");
        });
        import.meta.hot.accept();
      `,
      { errors: null },
    );
    await c.expectMessage("v1 saw bun:beforeUpdate", "Updated setup", "v2 saw bun:afterUpdate");
    // The handler that v2 passed to off() never fires, and disposing v2
    // removes its remaining listeners.
    await dev.write(
      "index.ts",
      `
        console.log("Third update");
        import.meta.hot.accept();
      `,
      { errors: null },
    );
    await c.expectMessage("v2 saw bun:beforeUpdate", "Third update");
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
        await using _wait = await dev.batchChanges({ errors: null });
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
        { errors: null },
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

    // The new module body blocks in a top-level await until the test releases
    // it, so the write has to stay pending for as long as the test wants.
    const write = dev.write(
      "index.ts",
      `
        console.log("blocked");
        await new Promise(resolve => {
          globalThis.unblock = resolve;
        });
        globalThis.marker = "updated";
        import.meta.hot.accept();
      `,
      // errors: null also skips the post-write expectErrorOverlay poll, which
      // would otherwise mask a premature ack.
      { errors: null },
    );
    let settled = false;
    write.then(
      () => (settled = true),
      () => (settled = true),
    );
    // "blocked" proves the client received the update and started evaluating
    // it. An ack sent on WebSocket receipt would have resolved the write before
    // that point.
    await c.expectMessage("blocked");
    expect(await c.js`globalThis.marker`).toBe("initial");
    expect(settled).toBe(false);

    // dev.write resolves on bun:afterUpdate, i.e. after replaceModules has
    // awaited the top-level await.
    await c.js`globalThis.unblock()`;
    await write;
    expect(await c.js`globalThis.marker`).toBe("updated");
  },
});
