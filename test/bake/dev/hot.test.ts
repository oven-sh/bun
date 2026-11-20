// Hot tests ensure that the `import.meta.hot` interface is functional
import { expect, test } from "bun:test";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createUpdateQueue } from "../../../src/runtime/bake/update-queue";
import { devTest, emptyHtmlFile, minimalFramework, WAIT_MULTIPLIER } from "../bake-harness";

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

const library = {
  "node_modules/unchanged-barrel/package.json": JSON.stringify({
    name: "unchanged-barrel",
    type: "module",
    exports: "./index.js",
    sideEffects: false,
  }),
  "node_modules/unchanged-barrel/index.js": `
    export { suffix } from './suffix.js';
    export { unused } from './unused.js';
  `,
  "node_modules/unchanged-barrel/suffix.js": `export const suffix = ':library';`,
  "node_modules/unchanged-barrel/unused.js": `export const unused = 'unused';`,
};

devTest("editing an accepted leaf does not hot-replace its unchanged barrel dependency", {
  files: {
    ...library,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"], body: "<h1></h1><button>Count 0</button>" }),
    "index.ts": `
      import { suffix } from 'unchanged-barrel';
      import './leaf.ts';
      document.documentElement.dataset.suffix = suffix;
      globalThis.documentToken = Math.random();
      let count = 0;
      document.querySelector('button').onclick = event => {
        event.currentTarget.textContent = 'Count ' + ++count;
      };
    `,
    "leaf.ts": `
      import { suffix } from 'unchanged-barrel';
      document.querySelector('h1').textContent = 'BEFORE' + suffix;
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { allowUnlimitedReloads: true });
    await c.expectElemText("h1", "BEFORE:library");
    await c.click("button");
    await c.expectElemText("button", "Count 1");
    const token = await c.js`globalThis.documentToken`;

    await dev.patch("leaf.ts", { find: "BEFORE", replace: "AFTER" });
    await c.expectElemText("h1", "AFTER:library");
    expect(await c.js`globalThis.documentToken`).toBe(token);
    await c.expectElemText("button", "Count 1");
  },
});

for (const shadowing of [false, true]) {
  devTest(
    `a cached sibling's import names do not change an unchanged barrel during HMR${shadowing ? " with nested shadowing" : ""}`,
    {
      files: {
        "index.html": emptyHtmlFile({ scripts: ["index.ts"], body: "<h1></h1><button>Count 0</button>" }),
        "index.ts": `
      import { prefix } from './sibling.ts';
      import { suffix } from 'unchanged-barrel';
      import './leaf.ts';
      document.documentElement.dataset.value = prefix + suffix;
      globalThis.documentToken = Math.random();
      let count = 0;
      document.querySelector('button').onclick = event => {
        event.currentTarget.textContent = 'Count ' + ++count;
      };
    `,
        "sibling.ts": `
      import { value } from './value.ts';
      export const prefix = value;
    `,
        "value.ts": `export const value = 'sibling';`,
        "leaf.ts": shadowing
          ? `
      import { suffix } from 'unchanged-barrel';
      function format(import_unchanged_barrel) {
        return import_unchanged_barrel + suffix;
      }
      document.querySelector('h1').textContent = format('BEFORE');
      import.meta.hot.accept();
    `
          : `
      import { suffix } from 'unchanged-barrel';
      document.querySelector('h1').textContent = 'BEFORE' + suffix;
      import.meta.hot.accept();
    `,
        "node_modules/unchanged-barrel/package.json": JSON.stringify({
          name: "unchanged-barrel",
          type: "module",
          exports: "./index.js",
          sideEffects: false,
        }),
        "node_modules/unchanged-barrel/index.js": `
      export { value as suffix } from './value.js';
      export { unused } from './unused.js';
    `,
        "node_modules/unchanged-barrel/value.js": `export const value = ':library';`,
        "node_modules/unchanged-barrel/unused.js": `export const unused = 'unused';`,
      },
      async test(dev) {
        await using c = await dev.client("/", { allowUnlimitedReloads: true });
        await c.expectElemText("h1", "BEFORE:library");
        await c.click("button");
        await c.expectElemText("button", "Count 1");
        const token = await c.js`globalThis.documentToken`;

        await dev.patch("leaf.ts", { find: "BEFORE", replace: "AFTER" });
        await c.expectElemText("h1", "AFTER:library");
        expect(await c.js`globalThis.documentToken`).toBe(token);
        await c.expectElemText("button", "Count 1");
      },
    },
  );
}

devTest("namespace imports do not collide with a module's local exports binding during HMR", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"], body: "<h1></h1>" }),
    "index.ts": `
      import * as ns from './dep.ts';
      const exports = 'local';
      document.querySelector('h1').textContent = [ns.value, exports].join(':');
      import.meta.hot.accept();
    `,
    "dep.ts": `export const value = 'BEFORE';`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectElemText("h1", "BEFORE:local");

    await dev.patch("dep.ts", { find: "BEFORE", replace: "AFTER" });
    await c.expectElemText("h1", "AFTER:local");
  },
});

for (const [withDispose, asyncDependency] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
] as const) {
  devTest(
    `evaluates an accepting importer after all changed dependencies${withDispose ? " and disposes it once" : ""}${asyncDependency ? " with an async dependency" : ""}`,
    {
      files: {
        "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
        "index.ts": `
      import { a } from './a.ts';
      import { b } from './b.ts';
      import { c } from './c.ts';
      console.log([a, b, c].join('|'));
      import.meta.hot.accept(() => { globalThis.importerAccepts = (globalThis.importerAccepts ?? 0) + 1; });
      ${withDispose ? `import.meta.hot.dispose(() => { globalThis.batchDisposals = (globalThis.batchDisposals ?? 0) + 1; });` : ""}
    `,
        "a.ts": `globalThis.loadsA = (globalThis.loadsA ?? 0) + 1; export const a = 'A0';`,
        "b.ts": `
      globalThis.loadsB = (globalThis.loadsB ?? 0) + 1;
      export const b = 'B0';
      import.meta.hot.accept(mod => { (globalThis.acceptedB ??= []).push(['old', mod.b]); });
    `,
        "c.ts": `globalThis.loadsC = (globalThis.loadsC ?? 0) + 1; export const c = 'C0';`,
      },
      async test(dev) {
        await using client = await dev.client("/");
        await client.expectMessage("A0|B0|C0");
        {
          await using batch = await dev.batchChanges();
          await dev.write("a.ts", `globalThis.loadsA = (globalThis.loadsA ?? 0) + 1; export const a = 'A1';`);
          await dev.write(
            "b.ts",
            `globalThis.loadsB = (globalThis.loadsB ?? 0) + 1; ${asyncDependency ? "await Promise.resolve();" : ""} export const b = 'B1';
         import.meta.hot.accept(mod => { (globalThis.acceptedB ??= []).push(['new', mod.b]); });`,
          );
          await dev.write("c.ts", `globalThis.loadsC = (globalThis.loadsC ?? 0) + 1; export const c = 'C1';`);
        }
        await client.expectMessage("A1|B1|C1");
        expect(await client.js`({ accepts: globalThis.importerAccepts, acceptedB: globalThis.acceptedB })`).toEqual({
          accepts: 1,
          acceptedB: [["old", "B1"]],
        });
        expect(await client.js`[globalThis.loadsA, globalThis.loadsB, globalThis.loadsC]`).toEqual([2, 2, 2]);
        if (withDispose) {
          expect(await client.js`globalThis.batchDisposals`).toBe(1);
        }
      },
    },
  );
}

for (const reentrant of [false, true]) {
  devTest(
    `batched importers wait for an already pending asynchronous dependency${reentrant ? " during reentrant dynamic import" : ""}`,
    {
      files: {
        "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
        "index.ts": `
      import { b } from './b.ts';
      globalThis.events = [];
      globalThis.gate = new Promise(resolve => { globalThis.releaseGate = resolve; });
      console.log(b);
      import.meta.hot.accept();
    `,
        "b.ts": `export const b = 'B0'; import.meta.hot.accept();`,
      },
      async test(dev) {
        await using client = await dev.client("/");
        await client.expectMessage("B0");
        const batch = await dev.batchChanges({ errors: null });
        await dev.write(
          "b.ts",
          `
        globalThis.events.push('dependency:start');
        console.log('holding dependency');
        ${reentrant ? "void import('./index.ts');" : ""}
        await globalThis.gate;
        export const b = 'B1';
        globalThis.events.push('dependency:end');
        import.meta.hot.accept();
      `,
        );
        await dev.write(
          "index.ts",
          `
        import { b } from './b.ts';
        globalThis.events.push('importer:' + b);
        console.log('updated importer');
        import.meta.hot.accept();
      `,
        );
        const applied = batch![Symbol.asyncDispose]();
        void applied.catch(() => {});
        let held;
        try {
          await client.expectMessage("holding dependency");
          held = await client.js`globalThis.events.slice()`;
        } finally {
          await client.js`globalThis.releaseGate()`;
          await applied;
        }
        await client.expectMessage("updated importer");
        expect(held).toEqual(["dependency:start"]);
        expect(await client.js`globalThis.events`).toEqual(["dependency:start", "dependency:end", "importer:B1"]);
      },
    },
  );
}

devTest("dynamic imports wait for an ancestor's pending asynchronous load", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { b } from './b.ts';
      export const value = 'I0';
      globalThis.events = [];
      globalThis.imported = null;
      globalThis.gate = new Promise(resolve => { globalThis.releaseGate = resolve; });
      console.log(b);
      import.meta.hot.accept();
    `,
    "b.ts": `export const b = 'B0'; import.meta.hot.accept();`,
  },
  async test(dev) {
    await using client = await dev.client("/");
    await client.expectMessage("B0");
    const batch = await dev.batchChanges({ errors: null });
    await dev.write(
      "index.ts",
      `
        import { b } from './b.ts';
        export const value = 'I1';
        globalThis.events.push('importer:' + b);
        import.meta.hot.accept();
      `,
    );
    await dev.write(
      "b.ts",
      `
        globalThis.events.push('dependency:start');
        void import('./index.ts').then(mod => {
          globalThis.imported = mod.value;
          console.log('dynamic import completed');
        });
        console.log('holding dependency');
        await globalThis.gate;
        export const b = 'B1';
        globalThis.events.push('dependency:end');
        import.meta.hot.accept();
      `,
    );
    const applied = batch![Symbol.asyncDispose]();
    void applied.catch(() => {});
    let held;
    try {
      await client.expectMessage("holding dependency");
      held = await client.js`({ events: globalThis.events.slice(), imported: globalThis.imported })`;
    } finally {
      await client.js`globalThis.releaseGate()`;
      await applied;
    }
    await client.expectMessage("dynamic import completed");
    expect(held).toEqual({ events: ["dependency:start"], imported: null });
    expect(await client.js`globalThis.imported`).toBe("I1");
    expect(await client.js`globalThis.events`).toEqual(["dependency:start", "dependency:end", "importer:B1"]);
  },
});

for (const gate of ["load", "dispose"] as const) {
  devTest(`serializes hot updates while an asynchronous ${gate} is pending`, {
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"], body: "<h1>0</h1>" }),
      "index.ts": `
        import './x.ts';
        import './y.ts';
        globalThis.acceptedX = [];
        globalThis.acceptedY = [];
        globalThis.disposed = [];
        globalThis.lifecycle = [];
        globalThis.gate = new Promise(resolve => { globalThis.releaseGate = resolve; });
        let update = 0;
        let completed = 0;
        import.meta.hot.on('bun:beforeUpdate', () => { globalThis.lifecycle.push('before:' + ++update); });
        import.meta.hot.on('bun:afterUpdate', () => {
          const value = globalThis.versionX + '|' + globalThis.versionY;
          globalThis.lifecycle.push('after:' + value);
          document.querySelector('h1').textContent = String(++completed);
        });
        console.log('ready');
      `,
      "x.ts": `
        export const x = 'X0';
        globalThis.versionX = x;
        import.meta.hot.accept(mod => { globalThis.acceptedX.push([x, mod.x]); });
        import.meta.hot.dispose(() => { globalThis.disposed.push(x); });
      `,
      "y.ts": `
        export const y = 'Y0';
        globalThis.versionY = y;
        import.meta.hot.accept(mod => { globalThis.acceptedY.push([y, mod.y]); });
        import.meta.hot.dispose(${gate === "dispose" ? "async" : ""} () => {
          globalThis.disposed.push(y);
          ${gate === "dispose" ? "console.log('holding'); await globalThis.gate;" : ""}
        });
      `,
    },
    async test(dev) {
      await using client = await dev.client("/", { storeHotChunks: true });
      await client.expectMessage("ready");
      const x = (value: string) => `
        export const x = '${value}';
        globalThis.versionX = x;
        import.meta.hot.accept(mod => { globalThis.acceptedX.push([x, mod.x]); });
        import.meta.hot.dispose(() => { globalThis.disposed.push(x); });
      `;
      const batch = await dev.batchChanges({ errors: null });
      await dev.write("x.ts", x("X1"));
      await dev.write(
        "y.ts",
        `
        ${gate === "load" ? "console.log('holding'); await globalThis.gate;" : ""}
        export const y = 'Y1';
        globalThis.versionY = y;
        import.meta.hot.accept(mod => { globalThis.acceptedY.push([y, mod.y]); });
      `,
      );
      const applied = batch![Symbol.asyncDispose]();
      void applied.catch(() => {});
      let held;
      let disposed;
      try {
        await client.expectMessage("holding");
        await client.getMostRecentHmrChunk();
        writeFileSync(dev.join("x.ts"), x("X2"));
        expect(await client.getMostRecentHmrChunk()).toContain("X2");
        held =
          await client.js`({ x: globalThis.versionX, lifecycle: globalThis.lifecycle, acceptedX: globalThis.acceptedX })`;
        disposed = await client.js<string[]>`globalThis.disposed`;
      } finally {
        await client.js`globalThis.releaseGate()`;
        await applied;
      }
      await client.expectElemText("h1", "2");
      expect(held).toEqual({ x: gate === "load" ? "X1" : "X0", lifecycle: ["before:1"], acceptedX: [] });
      expect(disposed!.sort()).toEqual(["X0", "Y0"]);
      expect(
        await client.js`({ x: globalThis.acceptedX, y: globalThis.acceptedY, lifecycle: globalThis.lifecycle })`,
      ).toEqual({
        x: [
          ["X0", "X1"],
          ["X1", "X2"],
        ],
        y: [["Y0", "Y1"]],
        lifecycle: ["before:1", "after:X1|Y1", "before:2", "after:X2|Y1"],
      });
      expect(await client.js`globalThis.disposed[2]`).toBe("X1");
      expect(await client.js`globalThis.disposed.length`).toBe(3);
    },
  });
}

devTest("CSS-only completion waits for an asynchronous JavaScript update", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"], styles: ["style.css"], body: "<h1>0</h1>" }),
    "index.ts": `
      import './value.ts';
      globalThis.lifecycle = [];
      globalThis.gate = new Promise(resolve => { globalThis.releaseGate = resolve; });
      let completed = 0;
      import.meta.hot.on('bun:beforeUpdate', () => { globalThis.lifecycle.push('before'); });
      import.meta.hot.on('bun:afterUpdate', () => {
        globalThis.lifecycle.push('after:' + globalThis.value);
        document.querySelector('h1').textContent = String(++completed);
      });
      console.log('ready');
    `,
    "value.ts": `globalThis.value = 'before'; import.meta.hot.accept();`,
    "style.css": "body { color: red; }",
  },
  async test(dev) {
    await using client = await dev.client("/");
    await client.expectMessage("ready");
    await client.style("body").color.expect.toBe("red");
    const batch = await dev.batchChanges({ errors: null });
    await dev.write(
      "value.ts",
      `console.log('holding JS'); await globalThis.gate; globalThis.value = 'after'; import.meta.hot.accept();`,
    );
    const applied = batch![Symbol.asyncDispose]();
    void applied.catch(() => {});
    let held;
    try {
      await client.expectMessage("holding JS");
      writeFileSync(dev.join("style.css"), "body { color: blue; }");
      // The style proves the CSS-only payload arrived while the JS body was still waiting.
      const deadline = Date.now() + 2_000 * WAIT_MULTIPLIER;
      let color: string | undefined;
      do {
        color = await client.style("body").color;
        if (color === "#00f") break;
        await new Promise(setImmediate);
      } while (Date.now() < deadline);
      expect(color).toBe("#00f");
      held =
        await client.js`({ value: globalThis.value, lifecycle: globalThis.lifecycle, completed: document.querySelector('h1').textContent })`;
    } finally {
      await client.js`globalThis.releaseGate()`;
      await applied;
    }
    await client.expectElemText("h1", "2");
    expect(held).toEqual({ value: "before", lifecycle: ["before"], completed: "0" });
    expect(await client.js`globalThis.lifecycle`).toEqual(["before", "after:after", "after:after"]);
    await client.style("body").color.expect.toBe("#00f");
  },
});

devTest("CSS-only completion waits for an earlier script to execute", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"], styles: ["style.css"], body: "<h1>0</h1>" }),
    "index.ts": `
      import './value.ts';
      globalThis.lifecycle = [];
      let completed = 0;
      import.meta.hot.on('bun:beforeUpdate', () => { globalThis.lifecycle.push('before'); });
      import.meta.hot.on('bun:afterUpdate', () => {
        globalThis.lifecycle.push('after:' + globalThis.value);
        document.querySelector('h1').textContent = String(++completed);
      });
      console.log('ready');
    `,
    "value.ts": `globalThis.value = 'before'; import.meta.hot.accept();`,
    "style.css": "body { color: red; }",
  },
  async test(dev) {
    await using client = await dev.client("/");
    await client.expectMessage("ready");
    await client.style("body").color.expect.toBe("red");
    await client.js`
      const appendChild = document.head.appendChild;
      const descriptor = Object.getOwnPropertyDescriptor(document.head, 'appendChild');
      let heldScript;
      Object.defineProperty(document.head, 'appendChild', {
        configurable: true,
        writable: true,
        value: function (node) {
          if (!heldScript && typeof node.src === 'string' && node.src.startsWith('blob:')) {
            heldScript = node;
            console.log('holding script');
            return node;
          }
          return appendChild.call(this, node);
        },
      });
      globalThis.releaseScript = () => {
        if (descriptor) Object.defineProperty(document.head, 'appendChild', descriptor);
        else delete document.head.appendChild;
        if (heldScript) {
          const script = heldScript;
          heldScript = null;
          appendChild.call(document.head, script);
        }
      };
    `;
    const batch = await dev.batchChanges({ errors: null });
    await dev.write("value.ts", `globalThis.value = 'after'; import.meta.hot.accept();`);
    const applied = batch![Symbol.asyncDispose]();
    void applied.catch(() => {});
    let held;
    try {
      await client.expectMessage("holding script");
      writeFileSync(dev.join("style.css"), "body { color: blue; }");
      // The style proves the later CSS payload arrived before the earlier script executed.
      const deadline = Date.now() + 2_000 * WAIT_MULTIPLIER;
      let color: string | undefined;
      do {
        color = await client.style("body").color;
        if (color === "#00f") break;
        await new Promise(setImmediate);
      } while (Date.now() < deadline);
      expect(color).toBe("#00f");
      held =
        await client.js`({ value: globalThis.value, lifecycle: globalThis.lifecycle, completed: document.querySelector('h1').textContent })`;
    } finally {
      await client.js`globalThis.releaseScript()`;
      await applied;
    }
    await client.expectElemText("h1", "2");
    expect(held).toEqual({ value: "before", lifecycle: [], completed: "0" });
    expect(await client.js`globalThis.lifecycle`).toEqual(["before", "after:after", "after:after"]);
    await client.style("body").color.expect.toBe("#00f");
  },
});

try {
  test("hot update queues reserve their tail before reentrant callbacks", async () => {
    const events: string[] = [];
    let nested!: Promise<void>;
    const update = createUpdateQueue(async (version: number) => {
      events.push(`start:${version}`);
      if (version === 1) {
        nested = update(2);
        events.push("enqueued:2");
        await Promise.resolve();
      }
      events.push(`end:${version}`);
    });
    await update(1);
    await nested;
    expect(events).toEqual(["start:1", "enqueued:2", "end:1", "start:2", "end:2"]);
  });

  test("hot update queues continue after a rejected operation", async () => {
    const events: number[] = [];
    const failure = new Error("expected update failure");
    const update = createUpdateQueue(async (version: number) => {
      events.push(version);
      if (version === 1) throw failure;
    });
    const rejected = update(1);
    const recovered = update(2);
    await expect(rejected).rejects.toBe(failure);
    await recovered;
    expect(events).toEqual([1, 2]);
  });
} catch {
  // Outside `bun test`, devTest handles interactive registrations.
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

// The server cannot reload a page to get a value that an update missed.
for (const [file, text] of [
  ["data.json", (n: number) => `{ "value": ${n} }`],
  ["data.cjs", (n: number) => `module.exports = { value: ${n} };`],
] as const) {
  devTest(`server: a save of ${file} reaches a route that imports it`, {
    framework: minimalFramework,
    files: {
      "routes/index.ts": `
        import data from '../${file}';
        export default () => new Response('value: ' + data.value);
      `,
      [file]: text(1),
    },
    async test(dev) {
      await dev.fetch("/").equals("value: 1");
      for (const n of [2, 3]) {
        await dev.write(file, text(n));
        await dev.fetch("/").equals("value: " + n);
      }
    },
  });
}

devTest("server: a module that an update reaches from two saved files is disposed of once", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      import { pool } from '../pool';
      export default () => new Response(pool());
    `,
    "pool.ts": `
      import { a } from './a';
      import { b } from './b';
      globalThis.open = (globalThis.open ?? 0) + 1;
      export const pool = () => a + ' ' + b + ' open: ' + globalThis.open;
      import.meta.hot.accept();
      import.meta.hot.dispose(() => { globalThis.open--; });
    `,
    "a.ts": `export const a = 'a1';`,
    "b.ts": `export const b = 'b1';`,
  },
  async test(dev) {
    await dev.fetch("/").equals("a1 b1 open: 1");
    for (const n of [2, 3]) {
      {
        await using batch = await dev.batchChanges();
        await dev.write("a.ts", `export const a = 'a${n}';`);
        await dev.write("b.ts", `export const b = 'b${n}';`);
      }
      await dev.fetch("/").equals(`a${n} b${n} open: 1`);
    }
  },
});

for (const [how, callback] of [
  ["throws", `() => { throw new Error('from dispose'); }`],
  ["rejects", `async () => { throw new Error('from dispose'); }`],
] as const) {
  devTest(`server: an update goes on after a dispose callback that ${how}`, {
    framework: minimalFramework,
    files: {
      "routes/index.ts": `
        import { value } from '../module';
        export default () => new Response('value: ' + value);
      `,
      "module.ts": `
        export const value = 1;
        import.meta.hot.accept();
        import.meta.hot.dispose(${callback});
      `,
    },
    async test(dev) {
      await dev.fetch("/").equals("value: 1");
      for (const n of [2, 3]) {
        await dev.patch("module.ts", { find: "value = " + (n - 1), replace: "value = " + n });
        await dev.output.waitForLine(/from dispose/);
        await dev.fetch("/").equals("value: " + n);
      }
    },
  });
}
