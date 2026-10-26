// Hot tests ensure that the `import.meta.hot` interface is functional
import { expect } from "bun:test";
import { isWindows } from "harness";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { Dev, devTest, emptyHtmlFile, minimalFramework, pathOutsideProjects, WAIT_MULTIPLIER } from "../bake-harness";

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
devTest("a hot-reload event that invalidates nothing is processed once", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    // Bundling the route puts the project directory on the watch list. Wait
    // for the build's own synchronization message so it is not recorded below.
    const built = dev.waitForHotReload(false);
    await dev.fetch("/");
    await built;

    // mkdir is a single notification from every platform's watcher, so the
    // dev server receives exactly one hot-reload event for it. Nothing imports
    // the directory, so the event invalidates nothing and is reported with one
    // SeenFiles. The first event of a batch used to be processed (and
    // reported) twice.
    const messages = await dev.watchSynchronizationMessagesFor(() => mkdirSync(dev.join("unrelated")));
    expect(messages).toEqual(["SeenFiles"]);
  },
});
// A save empties or renames the file before it writes the text, and inotify and
// `ReadDirectoryChangesW` report that at once. The dev server holds the file event until the
// file has its text. kqueue does not report a truncation, so nothing is held there.
const holdFor = (ms: number) => ({ BUN_DEBUG_TEST_DEV_SERVER_HALF_SAVED_WAIT_MS: String(ms) });
// Longer than a test keeps a file half-saved, so the speed of the machine does not decide the result.
const holdLong = holdFor(30_000);
const setsText = (id: string, value: string) =>
  `document.getElementById("${id}").textContent = "${value}";\nimport.meta.hot.accept();\n`;
/** Polls `done` until it is true. Fails with `what` after the time limit. */
async function until(what: string, done: () => boolean) {
  const deadline = Date.now() + 10_000 * WAIT_MULTIPLIER;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(1);
  }
}
const counterApp = (label: string) => `
  import { useState } from "react";
  export default function App() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>{"${label} " + count}</button>;
  }
`;
devTest("a save that empties the file before it writes it keeps Fast Refresh state", {
  fixture: "react-spa-simple",
  env: holdLong,
  async test(dev) {
    // Nothing is bundled or watched before the first request.
    writeFileSync(dev.join("App.tsx"), counterApp("count"));
    await using c = await dev.client();
    await c.click("button");
    await c.click("button");
    await c.expectElemText("button", "count 2");

    await dev.saveInPlace("App.tsx", counterApp("clicks"));
    // A full reload would reset the count to 0.
    await c.expectElemText("button", "clicks 2");
    // The HMR client stores this message right before it reloads the page.
    expect(await c.js`return sessionStorage.getItem("bun:hmr:message")`).toBeNull();
  },
});
devTest("a save that one Bun.write makes keeps Fast Refresh state", {
  fixture: "react-spa-simple",
  env: holdLong,
  async test(dev) {
    writeFileSync(dev.join("App.tsx"), counterApp("count"));
    await using c = await dev.client();
    await c.click("button");
    await c.click("button");
    await c.expectElemText("button", "count 2");

    await c.drainAcks();
    // On Windows `Bun.write` empties the file when it opens it, and writes the text from a later task.
    const written = Bun.write(dev.join("App.tsx"), counterApp("clicks"));
    const applied = c.nextAck("applying the text of Bun.write");
    await Promise.all([written, applied]);
    await c.expectElemText("button", "clicks 2");
    expect(await c.js`return sessionStorage.getItem("bun:hmr:message")`).toBeNull();
  },
});
devTest("a save that renames the file away before it writes the new one keeps the module's hot boundary", {
  // Only a file event ends this hold in time. inotify and `ReadDirectoryChangesW` report the write to
  // the new file. kqueue reports a write to the directory when the backup is removed.
  env: holdLong,
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<p id="a"></p>`,
    }),
    "index.ts": `
      import "./a";
    `,
    "a.ts": `
      document.getElementById("a").textContent = "a1";
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectElemText("#a", "a1");
    await dev.saveInPlace("a.ts", `document.getElementById("a").textContent = "a2";\nimport.meta.hot.accept();\n`, {
      emptyWith: "rename",
    });
    await c.expectElemText("#a", "a2");
    // The HMR client stores this message right before it reloads the page.
    expect(await c.js`return sessionStorage.getItem("bun:hmr:message")`).toBeNull();
  },
});
devTest("a file that is deleted is reported when its hold ends", {
  skip: [
    "win32", // unlinkSync is having weird behavior
  ],
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { value } from "./other";
      console.log(value);
    `,
    "other.ts": `
      export const value = 123;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(123);
    // A save that renames the file away looks the same. No file follows here, so the hold ends at its deadline.
    const held = dev.heldEvents();
    const built = c.nextAck("the bundle without the file");
    unlinkSync(dev.join("other.ts"));
    await held;
    await built;
    await c.expectErrorOverlay(['index.ts:1:23: error: Could not resolve: "./other"']);
  },
});
devTest("files saved while the dev server holds the update of another file join that update", {
  skip: ["darwin"],
  env: holdLong,
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<p id="a"></p><p id="b"></p><p id="c"></p>`,
    }),
    "index.ts": `
      import "./a";
      import "./b";
      import "./c";
    `,
    "a.ts": `
      document.getElementById("a").textContent = "a1";
      import.meta.hot.accept();
    `,
    "b.ts": `
      document.getElementById("b").textContent = "b1";
      import.meta.hot.accept();
    `,
    "c.ts": `
      document.getElementById("c").textContent = "c1";
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectElemText("#c", "c1");

    const update = (name: string) => `\ndocument.getElementById("${name}").textContent = "${name}2";\n`;
    await dev.saveInPlace("a.ts", "import.meta.hot.accept();" + update("a"), {
      emptyWith: "ftruncate",
      whileEmpty: async () => {
        // Each of these saves is a file event of its own.
        for (const name of ["b", "c"]) {
          const held = dev.heldEvents();
          appendFileSync(dev.join(name + ".ts"), update(name));
          await held;
        }
      },
    });

    await c.expectElemText("#a", "a2");
    await c.expectElemText("#b", "b2");
    await c.expectElemText("#c", "c2");
    // The HMR client stores this message right before it reloads the page.
    expect(await c.js`return sessionStorage.getItem("bun:hmr:message")`).toBeNull();
  },
});
devTest("a file that imports a half-saved file and is saved during its hold joins that update", {
  skip: ["darwin"],
  env: holdLong,
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import "./b";
    `,
    "a.ts": `
      export const a1 = "a1";
      import.meta.hot.accept();
    `,
    "b.ts": `
      import { a1 } from "./a";
      console.log("b1 has " + a1);
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("b1 has a1");

    // A save all: a.ts is emptied, b.ts is written with an import of the export that a.ts gets, a.ts gets its text.
    await dev.saveInPlace("a.ts", `export const a2 = "a2";\nimport.meta.hot.accept();\n`, {
      whileEmpty: async () => {
        const acks = c.acksReceived;
        const held = dev.heldEvents();
        writeFileSync(
          dev.join("b.ts"),
          `import { a2 } from "./a";\nconsole.log("b2 has " + a2);\nimport.meta.hot.accept();\n`,
        );
        await held;
        // A bundle of b.ts alone would read a.ts while it is empty, and it would reach the page
        // within this time. Nothing tells the test that none started.
        const deadline = Date.now() + 100 * WAIT_MULTIPLIER;
        while (c.acksReceived === acks && Date.now() < deadline) await Bun.sleep(1);
        expect(c.acksReceived).toBe(acks);
      },
    });
    // b.ts ran once, with the text of a.ts.
    await c.expectMessage("b2 has a2");
    // The HMR client stores this message right before it reloads the page.
    expect(await c.js`return sessionStorage.getItem("bun:hmr:message")`).toBeNull();
  },
});
const twoFiles = {
  "index.html": emptyHtmlFile({
    scripts: ["index.ts"],
    body: `<p id="a"></p><p id="b"></p>`,
  }),
  "index.ts": `
    import "./a";
    import "./b";
  `,
  "a.ts": setsText("a", "a1"),
  "b.ts": setsText("b", "b1"),
};
// The editor empties a.ts and then b.ts. Each order of the two writes leaves one of the files empty for longer.
for (const [first, last] of [
  ["b", "a"],
  ["a", "b"],
]) {
  devTest(`two files that one save all empties are held until both have their text (${last}.ts last)`, {
    skip: ["darwin"],
    env: holdLong,
    files: twoFiles,
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectElemText("#b", "b1");

      const files: Record<string, number> = {};
      try {
        for (const name of ["a", "b"]) {
          const held = dev.heldEvents();
          files[name] = openSync(dev.join(name + ".ts"), "w");
          await held;
        }
        const held = dev.heldEvents();
        writeSync(files[first], setsText(first, first + "2"));
        await held;
        // Without the other file to wait for, the hold would end 5 ms after that event. Nothing tells the test that it did not.
        await Bun.sleep(100);
        expect(dev.holdsEnded).toBe(0);
        const ended = dev.endedHolds();
        writeSync(files[last], setsText(last, last + "2"));
        await ended;
      } finally {
        for (const fd of Object.values(files)) closeSync(fd);
      }
      await c.expectElemText("#a", "a2");
      await c.expectElemText("#b", "b2");
      // The HMR client stores this message right before it reloads the page.
      expect(await c.js`return sessionStorage.getItem("bun:hmr:message")`).toBeNull();
    },
  });
}
devTest("a file that a later file event finds half-saved has a deadline of its own", {
  skip: ["darwin"],
  env: holdFor(1000),
  files: twoFiles,
  async test(dev) {
    // A machine that stalls past a deadline gets the empty module, and that run proves nothing.
    await using c = await dev.client("/", { allowUnlimitedReloads: true });
    await c.expectElemText("#b", "b1");
    let reloads = 0;
    c.on("reload", () => reloads++);

    const files: number[] = [];
    try {
      let held = dev.heldEvents();
      files.push(openSync(dev.join("a.ts"), "w"));
      await held;
      const heldA = performance.now();
      // b.ts is emptied late in the time that a.ts has.
      await Bun.sleep(700);
      held = dev.heldEvents();
      files.push(openSync(dev.join("b.ts"), "w"));
      await held;
      const heldB = performance.now();
      writeSync(files[0], setsText("a", "a2"));
      // The deadline of a.ts passes. b.ts is still empty, and it has time left.
      await Bun.sleep(heldA + 1150 - performance.now());
      const endedAtTheFirstDeadline = dev.holdsEnded;
      const ended = dev.endedHolds();
      writeSync(files[1], setsText("b", "b2"));
      const wroteB = performance.now();
      await ended;
      if (heldB - heldA < 1000 && wroteB - heldB < 1000) {
        expect(endedAtTheFirstDeadline).toBe(0);
        expect(reloads).toBe(0);
      }
    } finally {
      for (const fd of files) closeSync(fd);
    }
    await c.expectElemText("#a", "a2");
    await c.expectElemText("#b", "b2");
  },
});
const chainOfFiles = Array.from({ length: 30 }, (_, i) => `f${i}`);
devTest("a hold ends ten deadlines after its first file event, while files still join it", {
  skip: ["darwin"],
  env: holdFor(100),
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": chainOfFiles.map(name => `import "./${name}";`).join("\n"),
    ...Object.fromEntries(
      chainOfFiles.map(name => [`${name}.ts`, `console.log("${name}");\nimport.meta.hot.accept();\n`]),
    ),
  },
  async test(dev) {
    // The page gets the files that are still empty when the hold ends.
    await using c = await dev.client("/", { allowUnlimitedReloads: true });
    await c.expectMessage(...chainOfFiles);

    // Each file is emptied before the deadline of the file before it, so one file or another always has time left.
    let emptied = 0;
    for (const name of chainOfFiles) {
      if (dev.holdsEnded !== 0) break;
      closeSync(openSync(dev.join(name + ".ts"), "w"));
      emptied++;
      await Bun.sleep(60);
    }
    // 30 files are 1.8 s at least. The hold ends 1 s after it starts.
    expect(dev.holdsEnded).toBe(1);
    expect(emptied).toBeLessThan(chainOfFiles.length);
  },
});
devTest("a save that empties the file for a moment keeps the module's hot boundary", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<p id="a"></p>`,
    }),
    "index.ts": `
      import "./a";
    `,
    "a.ts": `
      document.getElementById("a").textContent = "0";
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    // A save that a stalled machine stretches past the hold reloads the page, and that save does not count.
    await using c = await dev.client("/", { allowUnlimitedReloads: true });
    await c.expectElemText("#a", "0");
    let reloads = 0;
    c.on("reload", () => reloads++);

    let saves = 0;
    let savesHeldUntilTheWrite = 0;
    const acksAtStart = c.acksReceived;
    for (let i = 1; i <= 10; i++) {
      const reloadsBefore = reloads;
      const heldBefore = dev.eventsHeld;
      let acks = c.acksReceived;
      const fd = openSync(dev.join("a.ts"), "w");
      const emptied = performance.now();
      // No turn of the event loop: the file is empty for about as long as a slow editor keeps it so.
      Bun.sleepSync(20);
      writeSync(fd, `document.getElementById("a").textContent = "${i}";\nimport.meta.hot.accept();\n`);
      const emptyFor = performance.now() - emptied;
      closeSync(fd);

      // The page acks each update and each load.
      let text: string | null;
      do {
        while (c.acksReceived === acks) await c.nextAck("applying a save");
        acks = c.acksReceived;
        text = await c.js<string | null>`return document.getElementById("a")?.textContent ?? null`;
      } while (text !== String(i));
      // The hold is 100 ms by default. A page that got the empty module loads again for the text.
      if (emptyFor < 50) {
        expect(reloads - reloadsBefore).toBe(0);
        saves++;
        // The dev server held the file event of the truncation, and then the file event of the write.
        if (dev.eventsHeld - heldBefore >= 2) savesHeldUntilTheWrite++;
      }
    }
    expect(saves).toBeGreaterThanOrEqual(5);
    // A save that is held until the file event of its write is one update. On a machine that stalls, the dev
    // server can see the text at the first file event, and that save is two updates, as without the hold.
    // `ReadDirectoryChangesW` can report one write more than once, after the update has started.
    if (savesHeldUntilTheWrite === 10 && !isWindows) expect(c.acksReceived - acksAtStart).toBe(10);
  },
});
devTest("a file that is saved empty replaces its module at the deadline, and is not held while it stays empty", {
  // kqueue does not report a truncation, so a save that ends empty starts no update there.
  skip: ["darwin"],
  env: holdFor(200),
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import * as dep from "./dep";
      console.log("value" in dep ? "dep has a value" : "dep has no value");
      import.meta.hot.accept();
    `,
    "dep.ts": `
      export const value = 1;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("dep has a value");

    // No text follows, so the hold ends at its deadline.
    let held = dev.heldEvents();
    writeFileSync(dev.join("dep.ts"), "");
    await held;
    await c.expectMessage("dep has no value");
    expect(dev.holdsEnded).toBe(1);

    // The hold left the file empty: it is empty on purpose.
    const heldSoFar = dev.eventsHeld;
    writeFileSync(dev.join("dep.ts"), "");
    await c.expectMessage("dep has no value");
    expect(dev.eventsHeld).toBe(heldSoFar);

    // Once a file event has seen text in the file again, a save that empties it is held again.
    await dev.write("dep.ts", "export const value = 2;");
    await c.expectMessage("dep has a value");
    held = dev.heldEvents();
    writeFileSync(dev.join("dep.ts"), "");
    await held;
    await c.expectMessage("dep has no value");
  },
});
devTest("a save is not held for an empty file that no page uses", {
  // 50 ms: the watcher waits this long for a second read, so the two saves of a round are often one file event on Linux.
  env: { BUN_INOTIFY_COALESCE_INTERVAL: "50000000" },
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<p id="a"></p>`,
    }),
    "index.ts": `
      import "./a";
    `,
    "a.ts": `
      document.getElementById("a").textContent = "0";
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectElemText("#a", "0");
    for (let round = 1; round <= 10; round++) {
      // On Linux the watcher names this file too, in the event of its directory.
      writeFileSync(dev.join("unused.ts"), "");
      writeFileSync(
        dev.join("a.ts"),
        `document.getElementById("a").textContent = "${round}";\nimport.meta.hot.accept();\n`,
      );
      await c.expectElemText("#a", String(round));
    }
    expect(dev.eventsHeld).toBe(0);
  },
});
devTest("with the hold off, the dev server bundles a file while a save keeps it empty", {
  skip: ["darwin"],
  env: holdFor(0),
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<p id="a"></p>`,
    }),
    "index.ts": `
      import "./a";
    `,
    "a.ts": `
      document.getElementById("a").textContent = "a1";
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { allowUnlimitedReloads: true });
    await c.expectElemText("#a", "a1");
    const fd = openSync(dev.join("a.ts"), "w");
    try {
      await c.nextAck("applying the update of the empty file");
      expect(dev.eventsHeld).toBe(0);
      writeSync(fd, `document.getElementById("a").textContent = "a2";\nimport.meta.hot.accept();\n`);
    } finally {
      closeSync(fd);
    }
    // The page lost its hot boundary to the empty module, so it loads again for the text.
    let acks = c.acksReceived;
    while ((await c.js<string | null>`return document.getElementById("a")?.textContent ?? null`) !== "a2") {
      while (c.acksReceived === acks) await c.nextAck("applying the text");
      acks = c.acksReceived;
    }
  },
});
devTest("a file that an onLoad plugin reads is not loaded while a save keeps it empty", {
  env: holdLong,
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<p id="a"></p>`,
    }),
    "index.ts": `
      import "./a";
    `,
    "a.ts": `
      document.getElementById("a").textContent = "a1";
      import.meta.hot.accept();
    `,
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "reads a.ts",
        setup(build) {
          build.onLoad({ filter: /[\\\\/]a\\.ts$/ }, async args => ({
            contents: await Bun.file(args.path).text(),
            loader: "ts",
          }));
        },
      };
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectElemText("#a", "a1");
    await dev.saveInPlace("a.ts", `document.getElementById("a").textContent = "a2";\nimport.meta.hot.accept();\n`);
    await c.expectElemText("#a", "a2");
    // The HMR client stores this message right before it reloads the page.
    expect(await c.js`return sessionStorage.getItem("bun:hmr:message")`).toBeNull();
  },
});
devTest("an empty file that an onLoad plugin turns into code is held at its first save only", {
  skip: ["darwin"],
  env: holdFor(200),
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./text-plugin.ts"]
    `,
    "text-plugin.ts": `
      import { readFileSync } from "node:fs";

      export default {
        name: "text",
        setup(build) {
          build.onLoad({ filter: /\\.txt$/ }, args => ({
            contents: "export default " + JSON.stringify(readFileSync(args.path, "utf8")) + ";",
            loader: "js",
          }));
        },
      };
    `,
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import text from "./note.txt";
      console.log("note: [" + text + "]");
      import.meta.hot.accept();
    `,
    "note.txt": "",
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("note: []");

    // The bundle has the code of the plugin for this file, so the dev server learns at the end of a hold that the file is empty.
    const ended = dev.endedHolds();
    writeFileSync(dev.join("note.txt"), "");
    await ended;
    await c.expectMessage("note: []");
    for (let i = 0; i < 2; i++) {
      writeFileSync(dev.join("note.txt"), "");
      await c.expectMessage("note: []");
    }
    expect(dev.holdsEnded).toBe(1);
  },
});
devTest("a save that the writer makes with several writes reaches the page as one update", {
  skip: ["darwin"],
  env: holdLong,
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<p id="a"></p>`,
    }),
    "index.ts": `
      import "./a";
    `,
    "a.ts": `
      import.meta.hot.accept();
      globalThis.runs = (globalThis.runs ?? 0) + 1;
      document.getElementById("a").textContent = "0";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectElemText("#a", "0");

    const parts = ["import.meta.hot.accept();\nglobalThis.runs = (globalThis.runs ?? 0) + 1;\n"];
    for (let n = 1; n <= 5; n++) parts.push(`document.getElementById("a").textContent = "${n}";\n`);
    let held = dev.heldEvents();
    const ended = dev.endedHolds();
    const fd = openSync(dev.join("a.ts"), "w");
    // From one write to the time that the dev server has seen the next one.
    let longestGap = 0;
    try {
      await held;
      let wrote = 0;
      for (const part of parts) {
        held = dev.heldEvents();
        const now = performance.now();
        writeSync(fd, part);
        await held;
        if (wrote !== 0) longestGap = Math.max(longestGap, performance.now() - wrote);
        wrote = now;
      }
    } finally {
      closeSync(fd);
    }
    await ended;
    await c.expectElemText("#a", "5");
    // The dev server takes the text once no file event has seen the size change for 5 ms. On a machine
    // that is slower than that from one write to the next, the page gets a part of the text first.
    if (longestGap < 4) expect(await c.js<number>`return globalThis.runs`).toBe(2);
  },
});
devTest("a file that its writer still appends to is bundled at the deadline of its hold", {
  skip: ["darwin"],
  env: holdFor(300),
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
      body: `<p id="a"></p>`,
    }),
    "index.ts": `
      import "./a";
    `,
    "a.ts": setsText("a", "a1"),
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectElemText("#a", "a1");

    const held = dev.heldEvents();
    const fd = openSync(dev.join("a.ts"), "w");
    try {
      await held;
      writeSync(fd, setsText("a", "a2"));
      // The size of the file changes for longer than the hold can last.
      for (let i = 0; i < 1000 && dev.holdsEnded === 0; i++) {
        writeSync(fd, "//\n");
        await Bun.sleep(1);
      }
    } finally {
      closeSync(fd);
    }
    expect(dev.holdsEnded).toBe(1);
    await c.expectElemText("#a", "a2");
  },
});
// Keeps a bundle that loads slow.ts open for as long as hold/on exists.
const slowBundle = {
  "bunfig.toml": `
    [serve.static]
    plugins = ["./hold-plugin.ts"]
  `,
  "hold-plugin.ts": `
    import { existsSync, readFileSync } from "node:fs";
    import { join } from "node:path";

    const on = join(import.meta.dir, "hold", "on");
    export default {
      name: "hold",
      setup(build) {
        build.onLoad({ filter: /slow\\.ts$/ }, async args => {
          if (existsSync(on)) {
            console.log("hold-plugin: the bundle is open");
            while (existsSync(on)) await Bun.sleep(5);
          }
          return { contents: readFileSync(args.path, "utf8"), loader: "ts" };
        });
      },
    };
  `,
  "hold/.keep": "",
  // With two html files, index.html is the page at /index.
  "index.html": emptyHtmlFile({
    scripts: ["index.ts"],
    body: `<p id="a"></p>`,
  }),
  "index.ts": `
    import "./a";
  `,
  "a.ts": `
    document.getElementById("a").textContent = "a1";
    import.meta.hot.accept();
  `,
  "other.html": emptyHtmlFile({
    scripts: ["slow.ts"],
  }),
  "slow.ts": `
    console.log("slow");
  `,
  "third.html": emptyHtmlFile({
    scripts: ["third.ts"],
  }),
  "third.ts": `
    console.log("third");
  `,
};
/** The script of a page. The first request for a page starts a bundle. */
async function loadPage(dev: Dev, route: string) {
  const html = await (await fetch(new URL(route, dev.baseUrl))).text();
  const src = html.match(/<script[^>]+src="([^"]+)"[^>]*data-bun-dev-server-script/)![1];
  return await (await fetch(new URL(src, dev.baseUrl))).text();
}
// The plugin keeps the bundle of /other open.
async function startSlowBundle(dev: Dev) {
  writeFileSync(dev.join("hold/on"), "");
  const open = dev.output.waitForLine(/hold-plugin: the bundle is open/);
  const page = loadPage(dev, "/other");
  await Promise.race([
    open,
    page.then(() => {
      throw new Error("The bundle of /other ended, and the plugin did not keep it open");
    }),
  ]);
  // In an object: an async function that returns a promise waits for it.
  return { page };
}
// A trace inside the project would report its own writes.
const emptiedBehindBundleTrace = pathOutsideProjects("hot-emptied-behind-a-bundle.watcher-trace");
devTest("a file that a save empties while another bundle runs is held when that bundle ends", {
  skip: ["darwin"],
  env: { ...holdLong, BUN_WATCHER_TRACE: emptiedBehindBundleTrace },
  files: slowBundle,
  async test(dev) {
    await using c = await dev.client("/index");
    await c.expectElemText("#a", "a1");
    const other = await startSlowBundle(dev);

    const traced = statSync(emptiedBehindBundleTrace).size;
    const fd = openSync(dev.join("a.ts"), "w");
    try {
      // The watcher writes its trace when it hands a batch to the dev server. The bundle is open, so the dev server keeps the event for the next bundle.
      await until("the watcher to report a.ts", () =>
        readFileSync(emptiedBehindBundleTrace, "latin1").slice(traced).includes("a.ts"),
      );
      const held = dev.heldEvents();
      unlinkSync(dev.join("hold/on"));
      expect(await other.page).toContain("slow");
      // The bundle has ended and a.ts is still empty: the event that waited starts a hold, not a bundle.
      await held;
      writeSync(fd, setsText("a", "a2"));
    } finally {
      closeSync(fd);
    }
    await c.expectElemText("#a", "a2");
    // The HMR client stores this message right before it reloads the page.
    expect(await c.js`return sessionStorage.getItem("bun:hmr:message")`).toBeNull();
  },
});
const queuedRequestTrace = pathOutsideProjects("hot-request-beside-a-held-event.watcher-trace");
devTest("a page request that waited behind a bundle is answered while the file event beside it is held", {
  skip: ["darwin"],
  env: { ...holdLong, BUN_WATCHER_TRACE: queuedRequestTrace },
  files: slowBundle,
  async test(dev) {
    await using c = await dev.client("/index");
    await c.expectElemText("#a", "a1");
    const other = await startSlowBundle(dev);

    const traced = statSync(queuedRequestTrace).size;
    const fd = openSync(dev.join("a.ts"), "w");
    try {
      await until("the watcher to report a.ts", () =>
        readFileSync(queuedRequestTrace, "latin1").slice(traced).includes("a.ts"),
      );
      // The first request for /third waits behind the open bundle too.
      const third = loadPage(dev, "/third");
      // /index is loaded, so the dev server answers it at once, after it has read the request for /third.
      await (await fetch(new URL("/index", dev.baseUrl))).text();
      const held = dev.heldEvents();
      unlinkSync(dev.join("hold/on"));
      expect(await other.page).toContain("slow");
      await held;
      // The text is not written yet. A request that waited for the hold would not be answered here.
      const thirdScript = await third;
      expect(thirdScript).toContain("third");
      expect(thirdScript).not.toContain("a.ts");
      expect(dev.holdsEnded).toBe(0);
      writeSync(fd, setsText("a", "a2"));
    } finally {
      closeSync(fd);
    }
    await c.expectElemText("#a", "a2");
    // The HMR client stores this message right before it reloads the page.
    expect(await c.js`return sessionStorage.getItem("bun:hmr:message")`).toBeNull();
  },
});
devTest("a hold whose deadline passes while another bundle runs ends when that bundle ends", {
  skip: ["darwin"],
  env: holdFor(300),
  files: slowBundle,
  async test(dev) {
    await using c = await dev.client("/index");
    await c.expectElemText("#a", "a1");

    const held = dev.heldEvents();
    const fd = openSync(dev.join("a.ts"), "w");
    try {
      await held;
      const other = await startSlowBundle(dev);
      // The deadline is a time: nothing else tells the test that it has passed.
      await Bun.sleep(400);
      expect(dev.holdsEnded).toBe(0);
      // No file event follows. The hold ends because the other bundle ends.
      const ended = dev.endedHolds();
      unlinkSync(dev.join("hold/on"));
      expect(await other.page).toContain("slow");
      await ended;
    } finally {
      closeSync(fd);
    }
  },
});
devTest("a server module is not bundled while a save keeps it empty", {
  skip: ["darwin"],
  framework: minimalFramework,
  env: holdLong,
  files: {
    "db.ts": `export const abc = "123";`,
    "routes/index.ts": `
      import { abc } from '../db';
      export default function (req, meta) {
        return new Response('Hello, ' + abc + '!');
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Hello, 123!");
    // No page is open. The dev server prints this line at the end of a bundle that a file event started.
    const reloaded = dev.output.waitForLine(/Reloaded in/);
    const held = dev.heldEvents().then(
      () => "held",
      () => "neither",
    );
    const fd = openSync(dev.join("db.ts"), "w");
    try {
      expect(await Promise.race([reloaded.then(() => "bundled"), held])).toBe("held");
      writeSync(fd, `export const abc = "456";`);
    } finally {
      closeSync(fd);
    }
    await reloaded;
    await dev.fetch("/").equals("Hello, 456!");
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
