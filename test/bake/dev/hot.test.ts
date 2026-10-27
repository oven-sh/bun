// Hot tests ensure that the `import.meta.hot` interface is functional
import { expect } from "bun:test";
import { appendFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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

// A save can take the file away before it writes the file again. Vim moves the file to a
// backup name, writes a new file and removes the backup. Nothing is at the path in between,
// and a build in that gap fails. The dev server holds the file until it is back. While it
// holds a file, a watcher event starts no build, and the files that change wait.
//
// These tests are not run on Windows, like the other tests of this directory that unlink a file.

// What the dev server did with the next watcher event.
// 1: it saw the change and started no build. 3 or 4: a build finished.
function nextWatchReport(dev: Dev) {
  return new Promise<number>(resolve => dev.once("watch_synchronization", resolve));
}
async function takeAway(dev: Dev, file: string, how: "rename" | "unlink") {
  const path = dev.join(file);
  const report = nextWatchReport(dev);
  if (how === "rename") renameSync(path, path + "~");
  else unlinkSync(path);
  expect(await report, `the ${how} of ${file}`).toBe(1);
}
// One watcher event, and no testing batch. The dev server does not watch `node_modules`,
// so it sees only the rename into place.
function replaceFile(dev: Dev, file: string, contents: string) {
  const next = dev.join("node_modules/next");
  writeFileSync(next, contents);
  renameSync(next, dev.join(file));
}
// The second step of the save. The watcher event that finds the file again starts the build.
function writeAgain(dev: Dev, file: string, how: "rename" | "unlink", contents: string) {
  replaceFile(dev, file, contents);
  if (how === "rename") unlinkSync(dev.join(file) + "~");
}
// The next hot update that the page applies. `drainAcks` first takes in the updates before it.
async function hotUpdateAfter(c: Client, change: () => void) {
  await c.drainAcks();
  const applied = new Promise<void>(resolve => c.once("received-hmr-event", () => resolve()));
  change();
  await applied;
}
// A slow machine must not end the hold before the test writes the file again.
const holdUntilTheFileIsBack = { BUN_DEBUG_TEST_DEV_SERVER_REMOVAL_HOLD_MS: String(60 * 60 * 1000) };

devTest("a save that takes the file away first is a hot update", {
  skip: ["win32"],
  env: holdUntilTheFileIsBack,
  files: {
    "index.html": emptyHtmlFile({ styles: ["styles.css"], scripts: ["index.ts"] }),
    "index.ts": `
      import { dep } from "./dep";
      console.log("index 1, " + dep);
      import.meta.hot.accept();
    `,
    "dep.ts": `export const dep = "dep 1";`,
    "styles.css": `@import "./child.css";`,
    "child.css": `body { color: red; }`,
    "node_modules/.keep": ``,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("index 1, dep 1");
    await c.style("body").color.expect.toBe("red");

    let version = 1;
    for (const how of ["rename", "unlink"] as const) {
      version++;
      // The script of the page.
      await takeAway(dev, "index.ts", how);
      writeAgain(
        dev,
        "index.ts",
        how,
        `import { dep } from "./dep"; console.log("index ${version}, " + dep); import.meta.hot.accept();`,
      );
      await c.expectMessage(`index ${version}, dep ${version - 1}`);

      // A module that the script imports.
      await takeAway(dev, "dep.ts", how);
      writeAgain(dev, "dep.ts", how, `export const dep = "dep ${version}";`);
      await c.expectMessage(`index ${version}, dep ${version}`);

      // A stylesheet that only another stylesheet imports.
      await takeAway(dev, "child.css", how);
      await hotUpdateAfter(c, () =>
        writeAgain(dev, "child.css", how, `body { color: ${version === 2 ? "blue" : "lime"}; }`),
      );
      await c.style("body").color.expect.toBe(version === 2 ? "#00f" : "#0f0");
    }
    await c.expectErrorOverlay([]);
  },
});

devTest("a save that takes the html file or an image away first reloads the page once", {
  skip: ["win32"],
  env: holdUntilTheFileIsBack,
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"], body: "<h1>first</h1>" }),
    "index.ts": `
      import image from "./image.png";
      console.log(image);
    `,
    "image.png": "first",
    "node_modules/.keep": ``,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await dev.fetch(await c.getStringMessage()).expect.toBe("first");

    // An in-place write of either file reloads the page too. No build fails on the way.
    for (const how of ["rename", "unlink"] as const) {
      await c.expectReload(async () => {
        await takeAway(dev, "index.html", how);
        writeAgain(dev, "index.html", how, emptyHtmlFile({ scripts: ["index.ts"], body: `<h1>${how}</h1>` }));
      });
      // The script of the new page has run.
      await c.getStringMessage();
      expect(await c.elemText("h1")).toBe(how);

      await c.expectReload(async () => {
        await takeAway(dev, "image.png", how);
        writeAgain(dev, "image.png", how, `image after ${how}`);
      });
      await dev.fetch(await c.getStringMessage()).expect.toBe(`image after ${how}`);
    }
  },
});

// An editor creates the new file before it writes it. A build in between reads a module with no code.
devTest("a save that has created the file again and has not written it is not a hot update", {
  skip: ["win32"],
  env: holdUntilTheFileIsBack,
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { dep } from "./dep";
      console.log(dep);
      import.meta.hot.accept();
    `,
    "dep.ts": `export const dep = "dep 1";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("dep 1");

    await takeAway(dev, "dep.ts", "rename");
    const report = nextWatchReport(dev);
    writeFileSync(dev.join("dep.ts"), "");
    expect(await report, "the new file with no content").toBe(1);
    appendFileSync(dev.join("dep.ts"), `export const dep = "dep 2";`);
    await c.expectMessage("dep 2");
    await c.expectErrorOverlay([]);
  },
});

devTest("a file that changes while a save has taken another file away waits for that file", {
  skip: ["win32"],
  env: holdUntilTheFileIsBack,
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    // The import that does not resolve makes the dev server watch the directory for it.
    // Then each change in the directory makes the next build read the directory again,
    // and that build does not find a file that is away.
    "index.ts": `
      import { dep } from "./dep";
      try {
        require("./optional");
      } catch {}
      globalThis.dep = () => dep;
      console.log("index 1");
      import.meta.hot.accept();
    `,
    "dep.ts": `export const dep = "dep 1";`,
    "node_modules/.keep": ``,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("index 1");

    // `:wa` in Vim saves two files one after the other.
    await takeAway(dev, "dep.ts", "rename");
    const report = nextWatchReport(dev);
    replaceFile(
      dev,
      "index.ts",
      `
        import { dep } from "./dep";
        try {
          require("./optional");
        } catch {}
        globalThis.dep = () => dep;
        console.log("index 2");
        import.meta.hot.accept();
      `,
    );
    expect(await report, "the change of index.ts").toBe(1);
    await hotUpdateAfter(c, () => writeAgain(dev, "dep.ts", "rename", `export const dep = "dep 2";`));
    // One update has both files. The page can run index.ts before it loads the new dep.ts.
    await c.expectMessage("index 2");
    expect(await c.js`globalThis.dep()`).toBe("dep 2");
    await c.expectErrorOverlay([]);
  },
});

// With a Tailwind plugin, every build reads the Tailwind stylesheets again: a class name
// in any file can change them. The dev server goes by the name of the plugin.
const tailwindPlugins = {
  // A plugin like bun-plugin-tailwind, which reads the stylesheet in its own `onLoad`.
  "a plugin reads": `
    export default {
      name: "reads",
      setup(build) {
        build.onLoad({ filter: /\\.css$/ }, async ({ path }) => ({ contents: await Bun.file(path).text(), loader: "css" }));
      },
    };
  `,
  "the bundler reads": `export default { name: "noop", setup() {} };`,
};
const tailwindBunfig = `
  [serve.static]
  plugins = ["./tailwind-plugin.ts"]
`;

devTest("a request does not read a Tailwind stylesheet that a save has taken away", {
  skip: ["win32"],
  env: holdUntilTheFileIsBack,
  files: {
    "bunfig.toml": tailwindBunfig,
    "tailwind-plugin.ts": tailwindPlugins["the bundler reads"],
    "index.html": emptyHtmlFile({ styles: ["styles.css"], scripts: ["index.ts"] }),
    "index.ts": `console.log("index");`,
    "two.html": emptyHtmlFile({ scripts: ["two.ts"] }),
    "two.ts": `console.log("two");`,
    "styles.css": `.tailwind { color: red; }`,
    "node_modules/.keep": ``,
  },
  async test(dev) {
    await using c = await dev.client("/index");
    await c.expectMessage("index");
    await c.style(".tailwind").color.expect.toBe("red");

    await takeAway(dev, "styles.css", "rename");
    // The first request for a page bundles the page.
    await using two = await dev.client("/two");
    await two.expectMessage("two");
    await c.expectErrorOverlay([]);

    await hotUpdateAfter(c, () => writeAgain(dev, "styles.css", "rename", `.tailwind { color: blue; }`));
    await c.style(".tailwind").color.expect.toBe("#00f");
  },
});

// A save of two files can start a build for the first file that reads the second one
// before the watcher reports that the second one is away. The dev server does not watch
// `node_modules`, so here it never gets that report.
for (const [whoReads, plugin] of Object.entries(tailwindPlugins)) {
  devTest(`a build goes on without a stylesheet that a save has taken away (${whoReads} the stylesheet)`, {
    skip: ["win32"],
    env: holdUntilTheFileIsBack,
    files: {
      "bunfig.toml": tailwindBunfig,
      "tailwind-plugin.ts": plugin,
      "index.html": emptyHtmlFile({ styles: ["./node_modules/ui/styles.css"], scripts: ["index.ts"] }),
      "index.ts": `
        console.log("index 1");
        import.meta.hot.accept();
      `,
      "node_modules/ui/styles.css": `.tailwind { color: red; }`,
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("index 1");
      await c.style(".tailwind").color.expect.toBe("red");

      const stylesheet = dev.join("node_modules/ui/styles.css");
      renameSync(stylesheet, stylesheet + "~");
      // No batch: a batch reports a file that is not there as deleted.
      replaceFile(dev, "index.ts", `console.log("index 2"); import.meta.hot.accept();`);
      await c.expectMessage("index 2");
      await c.expectErrorOverlay([]);

      // No watcher event follows. A timer of the dev server finds the stylesheet again.
      await hotUpdateAfter(c, () => {
        writeFileSync(stylesheet, `.tailwind { color: blue; }`);
        unlinkSync(stylesheet + "~");
      });
      await c.style(".tailwind").color.expect.toBe("#00f");
    },
  });
}

// A plugin that reads the file itself can fail for another reason than a file that is away.
devTest("an error of a plugin for a stylesheet that is there is reported at once", {
  skip: ["win32"],
  env: holdUntilTheFileIsBack,
  files: {
    "bunfig.toml": tailwindBunfig,
    "tailwind-plugin.ts": `
      export default {
        name: "rejects",
        setup(build) {
          build.onLoad({ filter: /\\.css$/ }, async ({ path }) => {
            const contents = await Bun.file(path).text();
            if (contents.includes("rejected")) throw new Error("the plugin does not take this stylesheet");
            return { contents, loader: "css" };
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ styles: ["styles.css"], scripts: ["index.ts"] }),
    "index.ts": `console.log("index");`,
    "styles.css": `.tailwind { color: red; }`,
    "node_modules/.keep": ``,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("index");

    replaceFile(dev, "styles.css", `.rejected { color: red; }`);
    await dev.output.waitForLine(/the plugin does not take this stylesheet/);
  },
});

devTest("a file that is removed and does not come back is reported as deleted", {
  skip: ["win32"],
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { dep } from "./dep";
      console.log(dep);
    `,
    "dep.ts": `export const dep = "dep 1";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("dep 1");

    // No batch and no test hook: the dev server decides by itself when the file counts as deleted.
    const removed = performance.now();
    unlinkSync(dev.join("dep.ts"));
    await dev.output.waitForLine(/Could not resolve: "\.\/dep"/);
    // The file had about 100 ms to come back.
    expect(performance.now() - removed).toBeGreaterThan(90);
    await c.expectErrorOverlay(['index.ts:1:21: error: Could not resolve: "./dep"']);

    await c.expectReload(async () => {
      await dev.write("dep.ts", `export const dep = "dep 2";`);
    });
    await c.expectMessage("dep 2");
  },
});

// After the dev server reported the stylesheet as deleted, a build that does not find it
// does not take it for a file in the middle of a save. A held file would keep the next save waiting.
devTest("a deleted Tailwind stylesheet is not held when a later build does not find it", {
  skip: ["win32"],
  env: holdUntilTheFileIsBack,
  files: {
    "bunfig.toml": tailwindBunfig,
    "tailwind-plugin.ts": tailwindPlugins["the bundler reads"],
    "index.html": emptyHtmlFile({ styles: ["styles.css"], scripts: ["index.ts"] }),
    "index.ts": `
      console.log("index 1");
      import.meta.hot.accept();
    `,
    "styles.css": `.tailwind { color: red; }`,
    "node_modules/.keep": ``,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("index 1");

    await c.expectReload(async () => {
      await using _wait = await dev.batchChanges();
      unlinkSync(dev.join("styles.css"));
      writeFileSync(dev.join("index.html"), emptyHtmlFile({ scripts: ["index.ts"] }));
    });
    await c.expectMessage("index 1");

    for (const version of [2, 3]) {
      replaceFile(dev, "index.ts", `console.log("index ${version}"); import.meta.hot.accept();`);
      await c.expectMessage(`index ${version}`);
    }
    await c.expectErrorOverlay([]);
  },
});

// A bundle that loads `slow.gate` does not end before `node_modules/gate-open` exists.
// The dev server does not watch `node_modules`.
const gatePlugin = `
  import { existsSync } from "node:fs";
  import { join } from "node:path";
  export default {
    name: "gate",
    setup(build) {
      build.onLoad({ filter: /slow\\.gate$/ }, async () => {
        console.log("the bundle is at the gate");
        while (!existsSync(join(import.meta.dir, "node_modules/gate-open"))) await Bun.sleep(5);
        return { contents: "export default 1;", loader: "js" };
      });
    },
  };
`;
const gateBunfig = `
  [serve.static]
  plugins = ["./gate-plugin.ts"]
`;

devTest("a save that the watcher reports while a bundle runs is a hot update", {
  skip: ["win32"],
  env: holdUntilTheFileIsBack,
  files: {
    "bunfig.toml": gateBunfig,
    "gate-plugin.ts": gatePlugin,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { dep } from "./dep";
      import { other } from "./other";
      console.log(dep + ", " + other);
      import.meta.hot.accept();
    `,
    "dep.ts": `export const dep = "dep 1";`,
    "other.ts": `export const other = "other 1";`,
    "slow.gate": ``,
    "node_modules/.keep": ``,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("dep 1, other 1");

    replaceFile(dev, "other.ts", `import gate from "./slow.gate"; export const other = "other " + (gate + 1);`);
    await dev.output.waitForLine(/the bundle is at the gate/);

    // The report of the watcher waits for the bundle to end.
    const sawTheFileGo = new Promise<void>(resolve => {
      dev.on("watch_synchronization", function listener(report: number) {
        if (report !== 1) return;
        dev.off("watch_synchronization", listener);
        resolve();
      });
    });
    renameSync(dev.join("dep.ts"), dev.join("dep.ts~"));
    writeFileSync(dev.join("node_modules/gate-open"), "");
    await c.expectMessage("dep 1, other 2");
    await sawTheFileGo;

    writeAgain(dev, "dep.ts", "rename", `export const dep = "dep 2";`);
    await c.expectMessage("dep 2, other 2");
    await c.expectErrorOverlay([]);
  },
});

// The time to come back can end while a bundle runs. The report waits for that bundle.
devTest("a file that is removed is reported as deleted after the bundle that was in its way", {
  skip: ["win32"],
  env: { BUN_DEBUG_TEST_DEV_SERVER_REMOVAL_HOLD_MS: "500" },
  files: {
    "bunfig.toml": gateBunfig,
    "gate-plugin.ts": gatePlugin,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { dep } from "./dep";
      console.log(dep);
    `,
    "dep.ts": `export const dep = 1;`,
    "two.html": emptyHtmlFile({ scripts: ["two.ts"] }),
    "two.ts": `
      import gate from "./slow.gate";
      console.log(gate);
    `,
    "slow.gate": ``,
    "node_modules/.keep": ``,
  },
  async test(dev) {
    // The dev server watches the files of the page when the first bundle is done.
    const bundled = nextWatchReport(dev);
    await dev.fetch("/index");
    await bundled;

    await takeAway(dev, "dep.ts", "unlink");
    const heldUntil = performance.now() + 500;
    // The first request for a page bundles the page. A held file does not stop that bundle.
    const two = dev.fetch("/two");
    await dev.output.waitForLine(/the bundle is at the gate/);

    // Nothing reports that the time ended, so the test waits for it.
    await Bun.sleep(Math.max(0, heldUntil - performance.now()));
    writeFileSync(dev.join("node_modules/gate-open"), "");
    expect((await two).status).toBe(200);
    await dev.output.waitForLine(/Could not resolve: "\.\/dep"/);
  },
});

// The dev server watches no directory outside its root, so no watcher event reports
// that the file is back. A timer of the dev server looks for the files that it holds.
devTest("a save that takes a file outside the project root away first is a hot update", {
  skip: ["win32"],
  env: holdUntilTheFileIsBack,
  files: {
    "web/index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "web/index.ts": `
      import { dep } from "../outside/dep";
      console.log(dep);
      import.meta.hot.accept();
    `,
    "outside/dep.ts": `export const dep = "dep 1";`,
  },
  cwd: "web",
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("dep 1");

    await takeAway(dev, "outside/dep.ts", "rename");
    writeFileSync(dev.join("outside/dep.ts"), `export const dep = "dep 2";`);
    unlinkSync(dev.join("outside/dep.ts~"));
    await c.expectMessage("dep 2");
    await c.expectErrorOverlay([]);

    // The dev server watches the new file.
    await dev.write("outside/dep.ts", `export const dep = "dep 3";`);
    await c.expectMessage("dep 3");
  },
});
