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
devTest("a hot update evaluates the modules between the saved file and the module that accepts it", {
  // One server. Each case has a page and a module graph of its own, in a directory of the same name.
  files: {
    // chain: app -> mid -> leaf. `app` self-accepts. `mid` made its export from `leaf`, so `mid` has to run again.
    "chain.html": emptyHtmlFile({ scripts: ["chain/app.ts"] }),
    "chain/app.ts": `
      import { mid } from "./mid";
      import.meta.hot.accept();
      console.log("app ran " + mid);
    `,
    "chain/mid.ts": `
      import { leaf } from "./leaf";
      console.log("mid ran");
      export const mid = "mid(" + leaf + ")";
    `,
    "chain/leaf.ts": `
      console.log("leaf ran");
      export const leaf = "v1";
    `,
    // callback: the same chain. `app` accepts with a callback, which gets the new `app`. The callback
    // belongs to the body that is replaced, and that body keeps the imports that it has.
    "callback.html": emptyHtmlFile({ scripts: ["callback/app.ts"] }),
    "callback/app.ts": `
      import { mid } from "./mid";
      export const seen = mid;
      import.meta.hot.accept(newModule => console.log("app accepted " + newModule.seen + ", imports " + mid));
    `,
    "callback/mid.ts": `
      import { leaf } from "./leaf";
      export const mid = "mid(" + leaf + ")";
    `,
    "callback/leaf.ts": `
      export const leaf = "v1";
    `,
    // order: index -> b -> d and b -> a -> d. The walk up from `d` finds `b` before `a`. `b` imports `a`, so `a` has to run first.
    "order.html": emptyHtmlFile({ scripts: ["order/index.ts"] }),
    "order/index.ts": `
      import { b } from "./b";
      console.log("index " + b);
      import.meta.hot.accept();
    `,
    "order/b.ts": `
      import { d } from "./d";
      import { a } from "./a";
      export const b = "b(" + d + "," + a + ")";
      console.log("b ran");
    `,
    "order/a.ts": `
      import { d } from "./d";
      export const a = "a(" + d + ")";
      console.log("a ran");
    `,
    "order/d.ts": `
      export const d = "d1";
    `,
    // dependency: index -> b -> c. `index` accepts `b`. A save of `c` evaluates `b` again and calls the callback with it. `index` does not run again.
    "dependency.html": emptyHtmlFile({ scripts: ["dependency/index.ts"] }),
    "dependency/index.ts": `
      import { b } from "./b";
      console.log("index ran " + b);
      import.meta.hot.accept("./b", newModule => console.log("index accepted " + newModule.b + ", imports " + b));
    `,
    "dependency/b.ts": `
      import { c } from "./c";
      export const b = "b(" + c + ")";
    `,
    "dependency/c.ts": `
      export const c = "c1";
    `,
    // dropped: index -> a -> b and index -> b. `a` runs again for a save of `b` only while its body imports `b`.
    "dropped.html": emptyHtmlFile({ scripts: ["dropped/index.ts"] }),
    "dropped/index.ts": `
      import { a } from "./a";
      import { b } from "./b";
      console.log("index " + a + " " + b);
      import.meta.hot.accept();
    `,
    "dropped/a.ts": `
      import { b } from "./b";
      export const a = "a(" + b + ")";
      console.log("a ran");
    `,
    "dropped/b.ts": `
      export const b = "b1";
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/chain");
      await c.expectMessage("leaf ran", "mid ran", "app ran mid(v1)");
      await dev.write("chain/leaf.ts", `console.log("leaf ran"); export const leaf = "v2";`);
      await c.expectMessage("leaf ran", "mid ran", "app ran mid(v2)");
      // The new `mid` takes part in the next update like the first `mid` did.
      await dev.write("chain/leaf.ts", `console.log("leaf ran"); export const leaf = "v3";`);
      await c.expectMessage("leaf ran", "mid ran", "app ran mid(v3)");
    }
    {
      await using c = await dev.client("/callback");
      await dev.write("callback/leaf.ts", `export const leaf = "v2";`);
      // `newModule` has the new value. The import that the callback reads has the value from before the save.
      await c.expectMessage("app accepted mid(v2), imports mid(v1)");
      // The callback of the second body runs now. Its import is the `mid` that the first save made.
      await dev.write("callback/leaf.ts", `export const leaf = "v3";`);
      await c.expectMessage("app accepted mid(v3), imports mid(v2)");
    }
    {
      await using c = await dev.client("/order");
      await c.expectMessage("a ran", "b ran", "index b(d1,a(d1))");
      await dev.write("order/d.ts", `export const d = "d2";`);
      await c.expectMessage("a ran", "b ran", "index b(d2,a(d2))");
    }
    {
      await using c = await dev.client("/dependency");
      await c.expectMessage("index ran b(c1)");
      await dev.write("dependency/c.ts", `export const c = "c2";`);
      await c.expectMessage("index accepted b(c2), imports b(c2)");
      await dev.write("dependency/c.ts", `export const c = "c3";`);
      await c.expectMessage("index accepted b(c3), imports b(c3)");
    }
    {
      await using c = await dev.client("/dropped");
      await c.expectMessage("a ran", "index a(b1) b1");
      await dev.write("dropped/b.ts", `export const b = "b2";`);
      await c.expectMessage("a ran", "index a(b2) b2");
      // `a` no longer imports `b`, so a save of `b` does not evaluate `a` again.
      await dev.write("dropped/a.ts", `export const a = "a()"; console.log("a ran");`);
      await c.expectMessage("a ran", "index a() b2");
      await dev.write("dropped/b.ts", `export const b = "b3";`);
      await c.expectMessage("index a() b3");
      // The same for an import that require() made.
      await dev.write("dropped/a.ts", `export const a = "a(" + require("./b").b + ")"; console.log("a ran");`);
      await c.expectMessage("a ran", "index a(b3) b3");
      await dev.write("dropped/b.ts", `export const b = "b4";`);
      await c.expectMessage("a ran", "index a(b4) b4");
      await dev.write("dropped/a.ts", `export const a = "a()"; console.log("a ran");`);
      await c.expectMessage("a ran", "index a() b4");
      await dev.write("dropped/b.ts", `export const b = "b5";`);
      await c.expectMessage("index a() b5");
    }
  },
});
devTest("a hot update disposes of each module that it evaluates again, once", {
  files: {
    // between: index -> mid -> d. A save of `d` evaluates `mid` again. Its dispose callback runs first and removes its listener.
    "between.html": emptyHtmlFile({ scripts: ["between/index.ts"] }),
    "between/index.ts": `
      import { mid } from "./mid";
      console.log("index " + mid);
      import.meta.hot.accept();
    `,
    "between/mid.ts": `
      import { d } from "./d";
      export const mid = "mid(" + d + ")";
      import.meta.hot.dispose(() => console.log("mid disposed " + mid));
      import.meta.hot.on("bun:afterUpdate", () => console.log("afterUpdate seen by " + mid));
    `,
    "between/d.ts": `
      export const d = "d1";
    `,
    // data: the dispose callback of `mid` writes to import.meta.hot.data. The body of `mid` does not use it,
    // so `mid` does not take the second save itself: `index` still runs again.
    "data.html": emptyHtmlFile({ scripts: ["data/index.ts"] }),
    "data/index.ts": `
      import { mid } from "./mid";
      console.log("index " + mid);
      import.meta.hot.accept();
    `,
    "data/mid.ts": `
      import { d } from "./d";
      export const mid = "mid(" + d + ")";
      import.meta.hot.dispose(data => {
        data.previous = mid;
      });
    `,
    "data/d.ts": `
      export const d = "d1";
    `,
    // several: both saved files lead to `index`. It is disposed of once and evaluated once.
    "several.html": emptyHtmlFile({ scripts: ["several/index.ts"] }),
    "several/index.ts": `
      import { d } from "./d";
      import { e } from "./e";
      console.log("index " + d + " " + e);
      import.meta.hot.dispose(() => console.log("index disposed"));
      import.meta.hot.accept();
    `,
    "several/d.ts": `
      export const d = "d1";
    `,
    "several/e.ts": `
      export const e = "e1";
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/between");
      await c.expectMessage("index mid(d1)");
      await dev.write("between/d.ts", `export const d = "d2";`);
      await c.expectMessage("mid disposed mid(d1)", "index mid(d2)", "afterUpdate seen by mid(d2)");
      await dev.write("between/d.ts", `export const d = "d3";`);
      await c.expectMessage("mid disposed mid(d2)", "index mid(d3)", "afterUpdate seen by mid(d3)");
    }
    {
      await using c = await dev.client("/data");
      await c.expectMessage("index mid(d1)");
      await dev.write("data/d.ts", `export const d = "d2";`);
      await c.expectMessage("index mid(d2)");
      await dev.write("data/d.ts", `export const d = "d3";`);
      await c.expectMessage("index mid(d3)");
    }
    {
      await using c = await dev.client("/several");
      await c.expectMessage("index d1 e1");
      {
        await using batch = await dev.batchChanges();
        await dev.write("several/d.ts", `export const d = "d2";`);
        await dev.write("several/e.ts", `export const e = "e2";`);
      }
      await c.expectMessage("index disposed", "index d2 e2");
    }
  },
});
devTest("import.meta.hot.accept of a dependency is called once for each accepted module that is replaced", {
  files: {
    // paths: index -> d, index -> a -> d, other -> d, other -> a. `index` and `other` accept both `d` and `a`.
    // A save of `d` replaces `d` and `a`. Each callback gets each of them once, one module for each call.
    "paths.html": emptyHtmlFile({ scripts: ["paths/index.ts"] }),
    "paths/index.ts": `
      import { d } from "./d";
      import { a } from "./a";
      import "./other";
      console.log("index " + d + " " + a);
      import.meta.hot.accept(["./d", "./a"], newModules => {
        console.log("index accepted " + newModules[0]?.d + " " + newModules[1]?.a);
      });
    `,
    "paths/other.ts": `
      import "./d";
      import "./a";
      import.meta.hot.accept(["./d", "./a"], newModules => {
        console.log("other accepted " + newModules[0]?.d + " " + newModules[1]?.a);
      });
    `,
    "paths/a.ts": `
      import { d } from "./d";
      export const a = "a(" + d + ")";
    `,
    "paths/d.ts": `
      export const d = "d1";
    `,
    // replaced: index -> mid -> d. `mid` accepts `d`, and one update replaces both.
    // Only the new body of `mid` runs. The callback of the old body does not.
    "replaced.html": emptyHtmlFile({ scripts: ["replaced/index.ts"] }),
    "replaced/index.ts": `
      import "./mid";
      import.meta.hot.accept();
    `,
    "replaced/mid.ts": `
      import { d } from "./d";
      console.log("mid v1 " + d);
      import.meta.hot.accept("./d", newModule => console.log("mid v1 accepted " + newModule.d));
    `,
    "replaced/d.ts": `
      export const d = "d1";
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/paths");
      await c.expectMessage("index d1 a(d1)");
      await dev.write("paths/d.ts", `export const d = "d2";`);
      await c.expectMessage(
        "index accepted d2 undefined",
        "index accepted undefined a(d2)",
        "other accepted d2 undefined",
        "other accepted undefined a(d2)",
      );
      // Only `a` is replaced.
      await dev.write("paths/a.ts", `import { d } from "./d"; export const a = "A(" + d + ")";`);
      await c.expectMessage("index accepted undefined A(d2)", "other accepted undefined A(d2)");
    }
    {
      await using c = await dev.client("/replaced");
      await c.expectMessage("mid v1 d1");
      {
        await using batch = await dev.batchChanges();
        await dev.write("replaced/d.ts", `export const d = "d2";`);
        await dev.write(
          "replaced/mid.ts",
          `
            import { d } from "./d";
            console.log("mid v2 " + d);
            import.meta.hot.accept("./d", newModule => console.log("mid v2 accepted " + newModule.d));
          `,
        );
      }
      await c.expectMessage("mid v2 d2");
      await dev.write("replaced/d.ts", `export const d = "d3";`);
      await c.expectMessage("mid v2 accepted d3");
    }
  },
});
devTest("a hot update that nothing accepts only reloads the page", {
  files: {
    // left: `b` accepts `d`, `c` self-accepts, and `index` imports `d` and accepts nothing, so the page reloads.
    // Every module logs through a console.log that the first load captured. The test client does not silence
    // that one on a reload, so what the runtime still does in the page that is left shows up as messages.
    "left.html": emptyHtmlFile({ scripts: ["left/index.ts"] }),
    "left/index.ts": `
      import "./b";
      import "./c";
      import "./d";
      import.meta.hot.on("bun:beforeFullReload", () => globalThis.log("full reload"));
      globalThis.log("index evaluated");
    `,
    "left/b.ts": `
      import { d } from "./d";
      globalThis.log("b evaluated " + d);
      import.meta.hot.accept("./d", newModule => globalThis.log("b accepted " + newModule.d));
    `,
    "left/c.ts": `
      import { d } from "./d";
      globalThis.log("c evaluated " + d);
      import.meta.hot.dispose(() => globalThis.log("c disposed " + d));
      import.meta.hot.accept();
    `,
    "left/d.ts": `
      globalThis.log ??= console.log;
      export const d = "d1";
      globalThis.log("d evaluated " + d);
    `,
    // path: index -> d and index -> a -> d. `index` accepts `d` but not `a`, so the update that
    // reaches `index` through `a` is not accepted.
    "path.html": emptyHtmlFile({ scripts: ["path/index.ts"] }),
    "path/index.ts": `
      import { d } from "./d";
      import { a } from "./a";
      console.log("index " + d + " " + a);
      import.meta.hot.accept("./d", newModule => console.log("index accepted " + newModule.d + " " + a));
    `,
    "path/a.ts": `
      import { d } from "./d";
      export const a = "a(" + d + ")";
    `,
    "path/d.ts": `
      export const d = "d1";
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/left");
      await c.expectMessage("d evaluated d1", "b evaluated d1", "c evaluated d1", "index evaluated");
      await c.expectReload(async () => {
        await dev.write(
          "left/d.ts",
          `
            globalThis.log ??= console.log;
            export const d = "d2";
            globalThis.log("d evaluated " + d);
          `,
        );
      });
      await c.expectMessage("full reload", "d evaluated d2", "b evaluated d2", "c evaluated d2", "index evaluated");
    }
    {
      await using c = await dev.client("/path");
      await c.expectMessage("index d1 a(d1)");
      await c.expectReload(async () => {
        await dev.write("path/d.ts", `export const d = "d2";`);
      });
      await c.expectMessage("index d2 a(d2)");
    }
  },
});
devTest("a module that only import() reaches takes each save, and the page does not reload", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import.meta.hot.accept();
      console.log("index ran");
      globalThis.open = () => import("./page").then(page => console.log("opened " + page.name));
    `,
    "page.ts": `
      export const name = "page v1";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("index ran");
    await c.js`globalThis.open()`;
    await c.expectMessage("opened page v1");
    // Each save evaluates `index` again, which holds the import(). `page` runs at the next import().
    await dev.write("page.ts", `export const name = "page v2";`);
    await c.expectMessage("index ran");
    await dev.write("page.ts", `export const name = "page v3";`);
    await c.expectMessage("index ran");
    await c.js`globalThis.open()`;
    await c.expectMessage("opened page v3");
  },
});
const store = (value: string) => `
  export const value = "${value}";
  console.log("store ran " + value);
  import.meta.hot.accept();
`;
const lazy = `
  import { value } from "./store";
  if (value === "bad") throw new Error("store is " + value);
  console.log("lazy ran with " + value);
`;
devTest("a save of a self-accepting module does not reload the page when a module that imports it failed to load", {
  // index -> import() of lazy -> store. `store` self-accepts. `lazy` throws while `store` is bad.
  files: {
    // root: `index` accepts nothing. An update that gets to it reloads the page.
    "root.html": emptyHtmlFile({ scripts: ["root/index.ts"] }),
    "root/index.ts": `
      console.log("index ran");
      globalThis.open = async () => {
        try {
          await import("./lazy");
        } catch (e) {
          console.log("lazy failed: " + e.message);
        }
      };
    `,
    "root/lazy.ts": lazy,
    "root/store.ts": store("bad"),
    // boundary: `index` self-accepts. An update that gets to it evaluates it again.
    "boundary.html": emptyHtmlFile({ scripts: ["boundary/index.ts"] }),
    "boundary/index.ts": `
      import.meta.hot.accept();
      console.log("index ran");
      globalThis.open = async () => {
        try {
          await import("./lazy");
        } catch (e) {
          console.log("lazy failed: " + e.message);
        }
      };
    `,
    "boundary/lazy.ts": lazy,
    "boundary/store.ts": store("bad"),
  },
  async test(dev) {
    for (const page of ["root", "boundary"]) {
      await using c = await dev.client("/" + page);
      await c.expectMessage("index ran");
      await c.js`globalThis.open()`;
      await c.expectMessage("store ran bad", "lazy failed: store is bad");
      // `store` takes the save itself, so the update stops there. dev.write() throws when the page
      // reloads, and a message shows when `index` runs again.
      await dev.write(page + "/store.ts", store("good"));
      await c.expectMessage("store ran good");
      // The next import() evaluates `lazy` again, with the new `store`.
      await c.js`globalThis.open()`;
      await c.expectMessage("lazy ran with good");
    }
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
