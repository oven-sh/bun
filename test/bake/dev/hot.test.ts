// Hot tests ensure that the `import.meta.hot` interface is functional
import { expect } from "bun:test";
import { linkSync, readdirSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { devTest, emptyHtmlFile } from "../bake-harness";

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
  // The merged-names code path under test is `Environment.isLinux`-gated.
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
    "held/.keep": "",
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("initial");

    // Tools that save atomically (sed -i, rsync, patch) write to a temp
    // file in the same directory and rename over the target. inotify
    // reports CREATE tmp + MODIFY tmp + MOVED_FROM tmp + MOVED_TO target on
    // the directory watch, and INotifyWatcher merges same-index events
    // into one WatchEvent carrying N names. `DevServer.onFileUpdate` must
    // forward every name to appendDir — indexing only the first drops the
    // rename target.
    //
    // The watch on the target itself reports a replaced inode too, and
    // would mask a lost directory event. A hard link in held/, which nothing
    // watches, keeps the old inode alive, so that watch stays silent. The
    // directory then names dep.ts only once, in the event of the rename. We
    // flood it with decoy CREATE events so that name is never alone in its
    // inotify batch.
    for (let round = 1; round <= 5; round++) {
      const target = dev.join("dep.ts");
      const content = `export default "atomic ${round}";\n`;
      {
        await using _wait = await dev.batchChanges();
        linkSync(target, dev.join(`held/dep.${round}.ts`));
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
// What each open descriptor of `pid` points to (Linux).
function openFdTargets(pid: number): string[] {
  const fdDir = `/proc/${pid}/fd`;
  return readdirSync(fdDir).flatMap(fd => {
    try {
      return [readlinkSync(`${fdDir}/${fd}`)];
    } catch {
      // A socket or pipe closed between readdir and readlink.
      return [];
    }
  });
}
devTest("a file replaced by an atomic save keeps being watched", {
  // An inotify watch follows the inode. An atomic save replaces the inode, and
  // the kernel reports the old one as deleted only once nothing holds it open.
  // The watcher then puts the watch on the new inode. So the dev server must
  // not keep a descriptor for a watched file. On Windows the handle it kept
  // made the rename itself fail with EPERM (#41045). kqueue watches through a
  // descriptor by design and reports the replaced inode at rename time.
  skip: ["darwin"],
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

    // Save the way sed -i, rsync and patch do: write a temp file and rename
    // it over the target. dep.ts is a new inode afterwards.
    {
      await using _wait = await dev.batchChanges();
      writeFileSync(dev.join("dep.ts.tmp"), 'export default "atomic";\n');
      renameSync(dev.join("dep.ts.tmp"), dev.join("dep.ts"));
    }
    await c.expectMessage("atomic");

    // Neither the replaced inode ("dep.ts (deleted)") nor the new one may stay
    // open after the bundles that read them.
    if (process.platform === "linux") {
      const openTargets = openFdTargets(dev.devProcess.pid);
      expect(openTargets).toContain("anon_inode:inotify");
      const dep = dev.join("dep.ts");
      expect(openTargets.filter(target => target === dep || target === `${dep} (deleted)`)).toEqual([]);
    }

    // On Linux only the watch on the file itself reports a rename away from
    // the path (the directory watch does not subscribe to IN_MOVED_FROM), so
    // this is noticed only if the new inode is the one being watched.
    {
      await using _wait = await dev.batchChanges({
        errors: ['index.ts:1:19: error: Could not resolve: "./dep"'],
      });
      renameSync(dev.join("dep.ts"), dev.join("dep.moved.ts"));
    }

    {
      await using _wait = await dev.batchChanges();
      renameSync(dev.join("dep.moved.ts"), dev.join("dep.ts"));
    }
    await c.expectMessage("atomic");
  },
});
devTest("a file outside the root reloads after each save by rename", {
  // Nothing watches the directory of a file outside the root, so only the
  // watch on the file itself can report that it was replaced.
  skip: ["win32", "darwin"],
  files: {
    "web/index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "web/index.ts": `
      import { value } from "../outside/dep";
      console.log(value);
      import.meta.hot.accept();
    `,
    "outside/dep.ts": `
      export const value = "save 1";
    `,
  },
  cwd: "web",
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("save 1");
    const dep = dev.join("outside/dep.ts");
    for (let n = 2; n <= 4; n++) {
      {
        await using _wait = await dev.batchChanges();
        writeFileSync(dep + ".tmp", `export const value = "save ${n}";\n`);
        renameSync(dep + ".tmp", dep);
      }
      await c.expectMessage(`save ${n}`);
    }
    // kqueue watches through a descriptor, and /proc is Linux's.
    if (process.platform === "linux") {
      expect(openFdTargets(dev.devProcess.pid).filter(target => target.startsWith(dep))).toEqual([]);
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
