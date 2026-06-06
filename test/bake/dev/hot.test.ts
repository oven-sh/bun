// Hot tests ensure that the `import.meta.hot` interface is functional
import { expect } from "bun:test";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
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
devTest("editing an imported JSON file updates importers without a reload", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import data, { value } from "./data.json";
      console.log("json:" + data.value + ":" + value);
      globalThis.readJson = () => "live:" + data.value + ":" + value;
      import.meta.hot.accept();
    `,
    "data.json": `{ "value": 1 }`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("json:1:1");
    await dev.patch("data.json", { find: "1", replace: "2" });
    await c.expectMessage("json:2:2");
    expect(await c.js<string>`readJson()`).toBe("live:2:2");
    await dev.patch("data.json", { find: "2", replace: "3" });
    await c.expectMessage("json:3:3");
    expect(await c.js<string>`readJson()`).toBe("live:3:3");
  },
});
devTest("editing a CommonJS module updates ESM importers without a reload", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import dep from "./dep.cjs";
      console.log("cjs:" + dep.value);
      globalThis.readCjs = () => "live:" + dep.value;
      import.meta.hot.accept();
    `,
    "dep.cjs": `module.exports = { value: 1 };`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("cjs:1");
    await dev.patch("dep.cjs", { find: "1", replace: "2" });
    await c.expectMessage("cjs:2");
    expect(await c.js<string>`readCjs()`).toBe("live:2");
    await dev.patch("dep.cjs", { find: "2", replace: "3" });
    await c.expectMessage("cjs:3");
    expect(await c.js<string>`readCjs()`).toBe("live:3");
  },
});
devTest("keys removed from a CommonJS module disappear after a hot update", {
  // Unlike a wholesale `module.exports = {...}` assignment, incremental
  // `exports.x = ...` modules mutate the same exports object across reloads
  // unless the runtime resets it, so a deleted export would linger forever.
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import * as dep from "./dep.cjs";
      console.log("inc:" + dep.a + ":" + dep.b);
      globalThis.readInc = () => "live:" + dep.a + ":" + (dep.b === undefined ? "gone" : dep.b);
      import.meta.hot.accept();
    `,
    "dep.cjs": `
      exports.a = 1;
      exports.b = 2;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("inc:1:2");
    await dev.write("dep.cjs", `exports.a = 10;`);
    await c.expectMessage("inc:10:undefined");
    expect(await c.js<string>`readInc()`).toBe("live:10:gone");
  },
});
devTest("a module flipping between CommonJS and ESM across hot updates stays fresh", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { value } from "./dep.js";
      console.log("flip:" + value);
      globalThis.readFlip = () => "live:" + value;
      import.meta.hot.accept();
    `,
    "dep.js": `module.exports = { value: 1 };`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("flip:1");
    // CJS -> ESM
    await dev.write("dep.js", `export const value = 2;`);
    await c.expectMessage("flip:2");
    expect(await c.js<string>`readFlip()`).toBe("live:2");
    // ESM -> CJS
    await dev.write("dep.js", `module.exports = { value: 3 };`);
    await c.expectMessage("flip:3");
    expect(await c.js<string>`readFlip()`).toBe("live:3");
    // CJS again, exercising the stale-reset arm after a flip
    await dev.write("dep.js", `module.exports = { value: 4 };`);
    await c.expectMessage("flip:4");
    expect(await c.js<string>`readFlip()`).toBe("live:4");
  },
});
// Long enough that the module loader's old recursive dependency walk
// (loadModuleSync/loadModuleAsync <-> parseEsmDependencies, ~2 fat native
// frames per import edge) exceeds the V8 call-stack limit in the node-based
// client fixture, both at initial page load and when the whole chain is
// stale in one hot update. The loader must traverse the dependency closure
// iteratively for this to pass. The chain uses side-effect imports plus a
// globalThis side channel (not re-export live bindings) so that on the fixed
// build no user-level getter chain scales with the constant: only the
// loader's own traversal sees the depth, and DEEP_CHAIN_LENGTH can be raised
// freely if engine stack limits grow. Bundle time inside the fixed
// per-message wait window (2000 * WAIT_MULTIPLIER in bake-harness.ts; NOT
// scaled by timeoutMultiplier) is the only upper bound on the constant.
const DEEP_CHAIN_LENGTH = 2500;
const deepChainFiles: Record<string, string> = {
  "index.html": emptyHtmlFile({
    scripts: ["index.ts"],
  }),
  "index.ts": `
    import "./a0";
    console.log("chain:" + globalThis.chainValue);
    globalThis.readChain = () => "live:" + globalThis.chainValue;
    import.meta.hot.accept();
  `,
  [`a${DEEP_CHAIN_LENGTH}.ts`]: `globalThis.chainValue = 1;`,
};
for (let i = 0; i < DEEP_CHAIN_LENGTH; i++) {
  deepChainFiles[`a${i}.ts`] = `import "./a${i + 1}";`;
}
devTest("hot update applies across a deep import chain without a page reload", {
  // Protects the outer test timeout for the two ~2500-file bundles; the
  // per-message wait window is fixed and cannot be extended, so if this test
  // times out waiting for a message, shrink DEEP_CHAIN_LENGTH (keeping the
  // USE_SYSTEM_BUN=1 run failing) instead of touching timeouts.
  timeoutMultiplier: 5,
  files: deepChainFiles,
  async test(dev) {
    await using c = await dev.client("/");
    // On the unfixed build the recursive initial-load walk of all
    // DEEP_CHAIN_LENGTH+1 modules overflows the stack here.
    await c.expectMessage("chain:1");

    // Editing the leaf re-evaluates only the leaf and the self-accepting
    // entry (replaceModules marks only payload modules and accepting
    // boundaries stale); the leaf reloads first by Set insertion order. No
    // full page reload may occur (the client fixture fails the test on an
    // unexpected location.reload()).
    await dev.patch(`a${DEEP_CHAIN_LENGTH}.ts`, { find: "= 1", replace: "= 2" });
    await c.expectMessage("chain:2");
    expect(await c.js<string>`readChain()`).toBe("live:2");

    // Touch every module in the chain in a single batch so one hot update
    // marks the entire chain stale: the first reloaded root's traversal then
    // re-evaluates the whole cone through the loader in one synchronous
    // pass, which is the depth that used to RangeError. Each rewrite is
    // semantically distinct from the loaded version so no current or future
    // content-dedup can drop it from the update payload. dev.write (not raw
    // writeFileSync) re-arms the batch's SeenFiles synchronization per file.
    {
      await using _batch = await dev.batchChanges();
      await dev.write(`a${DEEP_CHAIN_LENGTH}.ts`, `globalThis.chainValue = 3;`);
      for (let i = 0; i < DEEP_CHAIN_LENGTH; i++) {
        await dev.write(`a${i}.ts`, `import "./a${i + 1}"; globalThis.touched = ${i};`);
      }
    }
    await c.expectMessage("chain:3");
    expect(await c.js<string>`readChain()`).toBe("live:3");
  },
});
devTest("require() of a hot-reloaded ESM module sees fresh exports", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      const m = require("./esm.ts");
      console.log("esm:" + m.x);
      import.meta.hot.accept();
    `,
    "esm.ts": `export const x = 1;`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("esm:1");
    await dev.patch("esm.ts", { find: "1", replace: "2" });
    await c.expectMessage("esm:2");
  },
});
