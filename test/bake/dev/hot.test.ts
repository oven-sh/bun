// Hot tests ensure that the `import.meta.hot` interface is functional
import { expect } from "bun:test";
import { isDebug, runWithErrorPromise } from "harness";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { Dev, devTest, emptyHtmlFile, minimalFramework, WAIT_MULTIPLIER } from "../bake-harness";

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
devTest("modules between the updated module and its accepting boundary are evaluated again", {
  // One server; each case has its own page and module graph under a directory of the same name. Clients are opened one at a time.
  files: {
    // accept: index -> d, index -> a -> d. `index` accepts both and is not evaluated again, but `a` computed its export from `d` and has to be; one callback carries both.
    "accept.html": emptyHtmlFile({ scripts: ["accept/index.ts"] }),
    "accept/index.ts": `
      import { d } from "./d";
      import { a } from "./a";
      console.log("index " + d + " " + a);
      globalThis.snapshot = () => d + " " + a;
      import.meta.hot.accept(["./d", "./a"], newModules => {
        globalThis.accepted = newModules[0].d + " " + newModules[1].a;
      });
    `,
    // chain: index -> b -> c. `index` accepts `b`, so an edit of `c` is handled by evaluating `b` again and calling the callback with it (Vite semantics).
    "chain.html": emptyHtmlFile({ scripts: ["chain/index.ts"] }),
    "chain/index.ts": `
      import { b } from "./b";
      console.log("index " + b);
      import.meta.hot.accept("./b", newModule => console.log("index accepted " + newModule.b));
    `,
    "chain/b.ts": `
      import { c } from "./c";
      export const b = "b(" + c + ")";
      console.log("b evaluated " + b);
    `,
    "chain/c.ts": `
      export const c = "c1";
    `,
    "accept/a.ts": `
      import { d } from "./d";
      export const a = "a(" + d + ")";
      console.log("a evaluated " + a);
    `,
    "accept/d.ts": `
      export const d = "d1";
    `,
    // order: index -> b -> d, b -> a -> d. Walking up from `d` finds `b` first, but `b` must still be evaluated after `a`, which it imports.
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
      console.log("b evaluated " + b);
    `,
    "order/a.ts": `
      import { d } from "./d";
      export const a = "a(" + d + ")";
      console.log("a evaluated " + a);
    `,
    "order/d.ts": `
      export const d = "d1";
    `,
    // self: index -> d, index -> y -> d, both accepting `d`. `index` reloads first but must see the new `y`; `y`'s callback runs once its TLA finishes.
    "self.html": emptyHtmlFile({ scripts: ["self/index.ts"] }),
    "self/index.ts": `
      import { d } from "./d";
      import { y } from "./y";
      console.log("index " + d + " " + y);
      import.meta.hot.accept();
    `,
    "self/y.ts": `
      import { d } from "./d";
      await 0;
      export const y = "y(" + d + ")";
      console.log("y evaluated " + y);
      import.meta.hot.accept(newModule => {
        console.log("y accepted " + newModule.y);
      });
    `,
    "self/d.ts": `
      export const d = "d1";
    `,
    // dispose: index (self-accepting) -> mid -> d. The replaced `mid` runs its dispose callbacks, removing its listener; only the new copy's fires.
    "dispose.html": emptyHtmlFile({ scripts: ["dispose/index.ts"] }),
    "dispose/index.ts": `
      import { mid } from "./mid";
      console.log("index " + mid);
      import.meta.hot.accept();
    `,
    "dispose/mid.ts": `
      import { d } from "./d";
      export const mid = "mid(" + d + ")";
      console.log("mid evaluated " + mid);
      import.meta.hot.dispose(() => console.log("mid disposed " + mid));
      import.meta.hot.on("bun:afterUpdate", () => console.log("afterUpdate seen by " + mid));
    `,
    "dispose/d.ts": `
      export const d = "d1";
    `,
    // reload: b accepts d, c self-accepts, index does not accept: the update fails. Logging goes through a captured console.log so anything done in the page being left would show up between "full reload" and the fresh page.
    "reload.html": emptyHtmlFile({ scripts: ["reload/index.ts"] }),
    "reload/index.ts": `
      import "./b";
      import "./c";
      import "./d";
      import.meta.hot.on("bun:beforeFullReload", () => globalThis.log("full reload"));
      globalThis.log("index evaluated");
    `,
    "reload/b.ts": `
      import { d } from "./d";
      globalThis.log("b evaluated " + d);
      import.meta.hot.accept("./d", newModule => globalThis.log("b accepted " + newModule.d));
    `,
    "reload/c.ts": `
      import { d } from "./d";
      globalThis.log("c evaluated " + d);
      import.meta.hot.dispose(() => globalThis.log("c disposed " + d));
      import.meta.hot.accept();
    `,
    "reload/d.ts": `
      globalThis.log ??= console.log;
      export const d = "d1";
      globalThis.log("d evaluated " + d);
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/accept");
      await c.expectMessage("a evaluated a(d1)", "index d1 a(d1)");
      await dev.write("accept/d.ts", `export const d = "d2";`);
      await c.expectMessage("a evaluated a(d2)");
      expect(await c.js<string>`snapshot()`).toBe("d2 a(d2)");
      expect(await c.js<string>`globalThis.accepted`).toBe("d2 a(d2)");
      // The re-evaluated `a` takes part in the next update like the original did.
      await dev.write("accept/d.ts", `export const d = "d3";`);
      await c.expectMessage("a evaluated a(d3)");
      expect(await c.js<string>`snapshot()`).toBe("d3 a(d3)");
      expect(await c.js<string>`globalThis.accepted`).toBe("d3 a(d3)");
    }
    {
      await using c = await dev.client("/chain");
      await c.expectMessage("b evaluated b(c1)", "index b(c1)");
      await dev.write("chain/c.ts", `export const c = "c2";`);
      await c.expectMessage("b evaluated b(c2)", "index accepted b(c2)");
      await dev.write("chain/c.ts", `export const c = "c3";`);
      await c.expectMessage("b evaluated b(c3)", "index accepted b(c3)");
    }
    {
      await using c = await dev.client("/order");
      await c.expectMessage("a evaluated a(d1)", "b evaluated b(d1,a(d1))", "index b(d1,a(d1))");
      await dev.write("order/d.ts", `export const d = "d2";`);
      await c.expectMessage("a evaluated a(d2)", "b evaluated b(d2,a(d2))", "index b(d2,a(d2))");
    }
    {
      await using c = await dev.client("/self");
      await c.expectMessage("y evaluated y(d1)", "index d1 y(d1)");
      await dev.write("self/d.ts", `export const d = "d2";`);
      // A callback that ran too early would see the previous `y`; its position relative to `index` depends on how in-flight loads are reported.
      await c.expectMessageInAnyOrder("y evaluated y(d2)", "index d2 y(d2)", "y accepted y(d2)");
    }
    {
      await using c = await dev.client("/dispose");
      await c.expectMessage("mid evaluated mid(d1)", "index mid(d1)");
      await dev.write("dispose/d.ts", `export const d = "d2";`);
      await c.expectMessage(
        "mid disposed mid(d1)",
        "mid evaluated mid(d2)",
        "index mid(d2)",
        "afterUpdate seen by mid(d2)",
      );
      await dev.write("dispose/d.ts", `export const d = "d3";`);
      await c.expectMessage(
        "mid disposed mid(d2)",
        "mid evaluated mid(d3)",
        "index mid(d3)",
        "afterUpdate seen by mid(d3)",
      );
    }
    {
      await using c = await dev.client("/reload");
      await c.expectMessage("d evaluated d1", "b evaluated d1", "c evaluated d1", "index evaluated");
      await c.expectReload(async () => {
        await dev.write(
          "reload/d.ts",
          `
            globalThis.log ??= console.log;
            export const d = "d2";
            globalThis.log("d evaluated " + d);
          `,
        );
      });
      await c.expectMessage("full reload", "d evaluated d2", "b evaluated d2", "c evaluated d2", "index evaluated");
    }
  },
});
devTest("server: modules between the updated module and the route are evaluated again", {
  framework: minimalFramework,
  files: {
    // Routes never accept updates; the server applies them anyway. The route imports `config` before `derived`, which still has to be found.
    "config.ts": `
      export const value = "v1";
    `,
    "derived.ts": `
      import { value } from "./config";
      export const derived = "derived(" + value + ")";
    `,
    "routes/index.ts": `
      import { value } from "../config";
      import { derived } from "../derived";
      export default function () {
        return new Response(value + " " + derived);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("v1 derived(v1)");
    await dev.write("config.ts", `export const value = "v2";`);
    await dev.fetch("/").equals("v2 derived(v2)");
  },
});
devTest("server: modules an update never got to evaluate keep their hooks for the next update", {
  framework: minimalFramework,
  files: {
    "config.ts": `
      export const value = "v1";
    `,
    "mid.ts": `
      import { value } from "./config";
      export const mid = "mid(" + value + ")";
      import.meta.hot.dispose(() => (globalThis.log ??= []).push("mid disposed " + mid));
    `,
    "boundary.ts": `
      import { mid } from "./mid";
      export const boundary = "boundary(" + mid + ")";
      import.meta.hot.accept(newModule => (globalThis.log ??= []).push("boundary accepted " + newModule.boundary));
    `,
    "routes/index.ts": `
      import { boundary } from "../boundary";
      export default function () {
        return Response.json({ boundary, log: globalThis.log ?? [] });
      }
    `,
  },
  async test(dev) {
    expect(await dev.fetch("/").json()).toStrictEqual({ boundary: "boundary(mid(v1))", log: [] });
    // `config` throws first in the reload loop: `mid` and `boundary` were disposed but never evaluated again.
    await dev.write(
      "config.ts",
      `
        throw new Error("config boom");
        export const value = "v2";
      `,
    );
    await dev.output.waitForLine(/config boom/);
    expect(await dev.fetch("/").json()).toStrictEqual({
      boundary: "boundary(mid(v1))",
      log: ["mid disposed mid(v1)"],
    });
    // The fix walks up through `mid` to `boundary`, which still self-accepts.
    await dev.write("config.ts", `export const value = "v3";`);
    expect(await dev.fetch("/").json()).toStrictEqual({
      boundary: "boundary(mid(v3))",
      log: ["mid disposed mid(v1)", "boundary accepted boundary(mid(v3))"],
    });
    await dev.write("config.ts", `export const value = "v4";`);
    expect(await dev.fetch("/").json()).toStrictEqual({
      boundary: "boundary(mid(v4))",
      log: [
        "mid disposed mid(v1)",
        "boundary accepted boundary(mid(v3))",
        "mid disposed mid(v3)",
        "boundary accepted boundary(mid(v4))",
      ],
    });
  },
});
devTest("server: an import() that lands while a dispose promise is pending evaluates the new body once", {
  framework: minimalFramework,
  files: {
    "counted.ts": `
      globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
      export const value = "v1";
      import.meta.hot.dispose(() => globalThis.disposing.promise);
    `,
    // "arm" creates the promise the next dispose returns, "release" resolves it, anything else imports `counted`.
    "routes/index.ts": `
      export default async function (req) {
        const op = req.headers.get("x-command");
        if (op === "arm") {
          globalThis.disposing = Promise.withResolvers();
          return new Response("armed");
        }
        if (op === "release") {
          globalThis.disposing.resolve();
          return new Response("released");
        }
        const { value } = await import("../counted");
        return Response.json({ value, evaluations: globalThis.evaluations });
      }
    `,
  },
  async test(dev) {
    const command = (line: string) => dev.fetch("/", { headers: { "x-command": line } });
    await command("arm").equals("armed");
    expect(await command("load").json()).toStrictEqual({ value: "v1", evaluations: 1 });
    await dev.patch("counted.ts", { find: '"v1"', replace: '"v2"' });
    // The update is waiting on the dispose promise; this import evaluates v2.
    expect(await command("load").json()).toStrictEqual({ value: "v2", evaluations: 2 });
    await command("release").equals("released");
    expect(await command("load").json()).toStrictEqual({ value: "v2", evaluations: 2 });
  },
});
devTest("server: a sync throw during an update with a reload in flight leaves no unhandled rejection", {
  framework: minimalFramework,
  files: {
    "config.ts": `
      export const value = "v1";
    `,
    // Both importers of `config` are reloaded by the update; `slow` (listed first) comes back as a promise that rejects, then `sync` throws right away.
    "slow.ts": `
      import { value } from "./config";
      await 1;
      if (value === "v2") throw new Error("slow rejected");
      export const slow = "slow(" + value + ")";
    `,
    "sync.ts": `
      import { value } from "./config";
      if (value === "v2") throw new Error("sync threw");
      export const sync = "sync(" + value + ")";
    `,
    "routes/index.ts": `
      import { slow } from "../slow";
      import { sync } from "../sync";
      export default function () {
        return new Response(slow + " " + sync);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("slow(v1) sync(v1)");
    await dev.write("config.ts", `export const value = "v2";`);
    // An unhandled rejection from `slow` would have taken the dev server down before the next update.
    await dev.write("config.ts", `export const value = "v3";`);
    await dev.fetch("/").equals("slow(v3) sync(v3)");
  },
});
devTest("import.meta.hot.accept specifier callbacks run once per update, dispose once per module", {
  files: {
    // once: index -> d, index -> a -> d, index -> b -> c -> d, index -> other -> d, other -> a. `index` and `other` are reached once per path; each callback runs once, with every accepted module the update replaced.
    "once.html": emptyHtmlFile({ scripts: ["once/index.ts"] }),
    "once/index.ts": `
      import { d } from "./d";
      import { a } from "./a";
      import { b } from "./b";
      import "./other";
      console.log("index " + d + " " + a + " " + b);
      import.meta.hot.accept(["./d", "./a", "./b"], newModules => {
        console.log("index accepted " + newModules[0]?.d + " " + newModules[1]?.a + " " + newModules[2]?.b);
      });
    `,
    "once/other.ts": `
      import "./d";
      import "./a";
      import.meta.hot.accept(["./d", "./a"], newModules => {
        console.log("other accepted " + newModules[0]?.d + " " + newModules[1]?.a);
      });
    `,
    "once/a.ts": `
      import { d } from "./d";
      export const a = "a(" + d + ")";
    `,
    "once/b.ts": `
      import { c } from "./c";
      export const b = "b(" + c + ")";
    `,
    "once/c.ts": `
      import { d } from "./d";
      export const c = "c(" + d + ")";
    `,
    "once/d.ts": `
      export const d = "d1";
    `,
    // two: both replaced modules propagate up to `index`, which must be disposed of and re-evaluated once (a second dispose used to throw).
    "two.html": emptyHtmlFile({ scripts: ["two/index.ts"] }),
    "two/index.ts": `
      import "./d";
      import "./e";
      console.log("index evaluated");
      import.meta.hot.dispose(() => {
        console.log("index disposed");
      });
      import.meta.hot.accept();
    `,
    "two/d.ts": `
      export const d = "d1";
    `,
    "two/e.ts": `
      export const e = "e1";
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/once");
      await c.expectMessage("index d1 a(d1) b(c(d1))");
      await dev.write("once/d.ts", `export const d = "d2";`);
      await c.expectMessage("index accepted d2 a(d2) b(c(d2))", "other accepted d2 a(d2)");
      // The next update starts over: the callbacks run again, still once each.
      await dev.write("once/d.ts", `export const d = "d3";`);
      await c.expectMessage("index accepted d3 a(d3) b(c(d3))", "other accepted d3 a(d3)");
      // Only `a` is replaced: the callbacks report just it.
      await dev.write("once/a.ts", `import { d } from "./d"; export const a = "A(" + d + ")";`);
      await c.expectMessage("index accepted undefined A(d3) undefined", "other accepted undefined A(d3)");
    }
    {
      await using c = await dev.client("/two");
      await c.expectMessage("index evaluated");
      {
        await using batch = await dev.batchChanges();
        await dev.write("two/d.ts", `export const d = "d2";`);
        await dev.write("two/e.ts", `export const e = "e2";`);
      }
      await c.expectMessage("index disposed", "index evaluated");
    }
  },
});
devTest("an accept callback is not run for an importer the same update evaluated again", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./mid";
      import.meta.hot.accept();
    `,
    "mid.ts": `
      import { d } from "./d";
      console.log("mid v1 " + d);
      import.meta.hot.accept("./d", newModule => console.log("mid v1 accepted " + newModule.d));
    `,
    "d.ts": `
      export const d = "d1";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("mid v1 d1");
    // `mid` accepts `d`, but is replaced in the same update: only its new body runs, not the callback its old body registered.
    {
      await using batch = await dev.batchChanges();
      await dev.write("d.ts", `export const d = "d2";`);
      await dev.write(
        "mid.ts",
        `
          import { d } from "./d";
          console.log("mid v2 " + d);
          import.meta.hot.accept("./d", newModule => console.log("mid v2 accepted " + newModule.d));
        `,
      );
    }
    await c.expectMessage("mid v2 d2");
    await dev.write("d.ts", `export const d = "d3";`);
    await c.expectMessage("mid v2 accepted d3");
  },
});
devTest("import.meta.hot.dispose runs for every module the update evaluates again", {
  files: {
    // importer: index handles every update with its accept callback and is never evaluated again, so its own dispose callback must never run.
    "importer.html": emptyHtmlFile({ scripts: ["importer/index.ts"] }),
    "importer/index.ts": `
      import { d } from "./d";
      console.log("index " + d);
      import.meta.hot.dispose(() => {
        console.log("index disposed");
      });
      import.meta.hot.accept("./d", newModule => {
        console.log("index accepted " + newModule.d);
      });
    `,
    "importer/d.ts": `
      export const d = "d1";
      console.log("evaluated " + d);
      import.meta.hot.dispose(() => {
        console.log("disposed " + d);
      });
    `,
    // self: both d and index are evaluated again; all dispose callbacks run, and index's returned promise settles, before either evaluates.
    "self.html": emptyHtmlFile({ scripts: ["self/index.ts"] }),
    "self/index.ts": `
      import { d } from "./d";
      console.log("index " + d);
      import.meta.hot.dispose(async () => {
        await null;
        console.log("index disposed");
      });
      import.meta.hot.accept();
    `,
    "self/d.ts": `
      export const d = "d1";
      console.log("evaluated " + d);
      import.meta.hot.dispose(() => {
        console.log("disposed " + d);
      });
    `,
    // several: the boundary is reached from both replaced modules and sits between them in reload order; each module is disposed of and evaluated once per update.
    "several.html": emptyHtmlFile({ scripts: ["several/index.ts"] }),
    "several/index.ts": `
      import "./d";
      import "./e";
      console.log("index evaluated");
      import.meta.hot.dispose(() => {
        console.log("index disposed");
      });
      import.meta.hot.accept();
    `,
    "several/d.ts": `
      export const d = "d1";
      console.log("evaluated " + d);
      import.meta.hot.dispose(() => {
        console.log("disposed " + d);
      });
    `,
    "several/e.ts": `
      export const e = "e1";
      console.log("evaluated " + e);
      import.meta.hot.dispose(() => {
        console.log("disposed " + e);
      });
    `,
    // threw: the failing module is reached through import() so the page stays up; what it set up before throwing is torn down when the fix replaces it.
    "threw.html": emptyHtmlFile({ scripts: ["threw/index.ts"] }),
    "threw/index.ts": `
      globalThis.loadDep = async () => {
        try {
          return (await import("./dep")).value;
        } catch (e) {
          return "failed: " + e.message;
        }
      };
      console.log("index evaluated");
      import.meta.hot.accept();
    `,
    "threw/dep.ts": `
      import.meta.hot.dispose(() => {
        console.log("dep disposed");
      });
      export const value = "v1";
      throw new Error("dep is broken");
    `,
    // listeners: only the listener registered by the current copy of d is still attached once an update accepted by its importer is applied.
    "listeners.html": emptyHtmlFile({ scripts: ["listeners/index.ts"] }),
    "listeners/index.ts": `
      import { d } from "./d";
      console.log("index " + d);
      import.meta.hot.accept("./d", newModule => {
        console.log("index accepted " + newModule.d);
      });
    `,
    "listeners/d.ts": `
      export const d = "d1";
      import.meta.hot.on("bun:afterUpdate", () => {
        console.log(d + " saw afterUpdate");
      });
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/importer");
      await c.expectMessage("evaluated d1", "index d1");
      // The copy being thrown away is disposed of before the next one is evaluated.
      await dev.patch("importer/d.ts", { find: "d1", replace: "d2" });
      await c.expectMessage("disposed d1", "evaluated d2", "index accepted d2");
      // The dispose callback registered by a copy that was itself hot-loaded runs too, and the first copy's callback does not run again.
      await dev.patch("importer/d.ts", { find: "d2", replace: "d3" });
      await c.expectMessage("disposed d2", "evaluated d3", "index accepted d3");
      // The next copy self-accepts. The copy being replaced still does not, so this update is still accepted by index.
      await dev.write(
        "importer/d.ts",
        `
          export const d = "d4";
          console.log("evaluated " + d);
          import.meta.hot.dispose(() => {
            console.log("disposed " + d);
          });
          import.meta.hot.accept();
        `,
      );
      await c.expectMessage("disposed d3", "evaluated d4", "index accepted d4");
      // Self-accepting update: only the copy being replaced is disposed of; the callbacks of d1, d2 and d3 were consumed by the earlier updates.
      await dev.patch("importer/d.ts", { find: "d4", replace: "d5" });
      await c.expectMessage("disposed d4", "evaluated d5", "index accepted d5");
    }
    {
      await using c = await dev.client("/self");
      await c.expectMessage("evaluated d1", "index d1");
      await dev.patch("self/d.ts", { find: "d1", replace: "d2" });
      await c.expectMessage("disposed d1", "index disposed", "evaluated d2", "index d2");
      await dev.patch("self/d.ts", { find: "d2", replace: "d3" });
      await c.expectMessage("disposed d2", "index disposed", "evaluated d3", "index d3");
    }
    {
      await using c = await dev.client("/several");
      await c.expectMessage("evaluated d1", "evaluated e1", "index evaluated");
      // The order the modules of one update are processed in is not specified; the dispose/evaluate ordering is pinned by the case above.
      {
        await using batch = await dev.batchChanges();
        await dev.patch("several/d.ts", { find: "d1", replace: "d2" });
        await dev.patch("several/e.ts", { find: "e1", replace: "e2" });
      }
      await c.expectMessageInAnyOrder(
        "disposed d1",
        "disposed e1",
        "index disposed",
        "evaluated d2",
        "evaluated e2",
        "index evaluated",
      );
      {
        await using batch = await dev.batchChanges();
        await dev.patch("several/d.ts", { find: "d2", replace: "d3" });
        await dev.patch("several/e.ts", { find: "e2", replace: "e3" });
      }
      await c.expectMessageInAnyOrder(
        "disposed d2",
        "disposed e2",
        "index disposed",
        "evaluated d3",
        "evaluated e3",
        "index evaluated",
      );
    }
    {
      await using c = await dev.client("/threw");
      await c.expectMessage("index evaluated");
      expect(await c.js`loadDep()`).toBe("failed: dep is broken");
      await dev.write(
        "threw/dep.ts",
        `
          import.meta.hot.dispose(() => {
            console.log("dep disposed");
          });
          export const value = "v2";
        `,
      );
      // dep is replaced and index, which imported it, self-accepts.
      await c.expectMessage("dep disposed", "index evaluated");
      expect(await c.js`loadDep()`).toBe("v2");
      await dev.patch("threw/dep.ts", { find: "v2", replace: "v3" });
      await c.expectMessage("dep disposed", "index evaluated");
      expect(await c.js`loadDep()`).toBe("v3");
    }
    {
      await using c = await dev.client("/listeners");
      await c.expectMessage("index d1");
      await dev.patch("listeners/d.ts", { find: "d1", replace: "d2" });
      await c.expectMessage("index accepted d2", "d2 saw afterUpdate");
      await dev.patch("listeners/d.ts", { find: "d2", replace: "d3" });
      await c.expectMessage("index accepted d3", "d3 saw afterUpdate");
    }
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
      import.meta.hot.on("bun:beforeUpdate", () => {
        console.log("bun:beforeUpdate (initial)");
      });
      // "vite:*" names are aliases of the "bun:*" events
      import.meta.hot.on("vite:beforeUpdate", () => {
        console.log("vite:beforeUpdate (initial)");
      });
      import.meta.hot.accept();
    `,
    // "off" accepts either name for a listener registered under the other.
    "off.html": emptyHtmlFile({
      scripts: ["off.ts"],
    }),
    "off.ts": `
      console.log("Initial setup");
      const a = () => console.log("a");
      import.meta.hot.on("bun:beforeUpdate", a);
      import.meta.hot.off("vite:beforeUpdate", a);
      const b = () => console.log("b");
      import.meta.hot.on("vite:beforeUpdate", b);
      import.meta.hot.off("bun:beforeUpdate", b);
      import.meta.hot.on("vite:beforeUpdate", () => console.log("still listening"));
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/");
      await c.expectMessage("Initial setup");
      await dev.write(
        "index.ts",
        `
          console.log("Updated setup");
          import.meta.hot.on("vite:beforeUpdate", () => {
            console.log("vite:beforeUpdate (updated)");
          });
          import.meta.hot.on("vite:afterUpdate", () => {
            console.log("vite:afterUpdate (updated)");
          });
          const handler = () => {
            console.log("removed handler");
          };
          import.meta.hot.on("vite:beforeUpdate", handler);
          import.meta.hot.off("vite:beforeUpdate", handler);
          import.meta.hot.accept();
        `,
      );
      // The initial module's listeners fire for the update replacing it; the new module's afterUpdate listener fires once the update is done.
      await c.expectMessage(
        "bun:beforeUpdate (initial)",
        "vite:beforeUpdate (initial)",
        "Updated setup",
        "vite:afterUpdate (updated)",
      );
      await dev.write(
        "index.ts",
        `
          console.log("Third update");
          import.meta.hot.accept();
        `,
      );
      // The initial module's listeners were removed with it, and off() never fires; the replaced module's afterUpdate listener is removed before this update finishes.
      await c.expectMessage("vite:beforeUpdate (updated)", "Third update");
    }
    {
      await using c = await dev.client("/off");
      await c.expectMessage("Initial setup");
      await dev.write(
        "off.ts",
        `
          console.log("Updated setup");
          import.meta.hot.accept();
        `,
      );
      await c.expectMessage("still listening", "Updated setup");
    }
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
    // Bundling the route puts the project directory on the watch list; wait out the build's own synchronization message.
    const built = dev.waitForHotReload(false);
    await dev.fetch("/");
    await built;

    // mkdir is one watcher notification on every platform; nothing imports it, so it is exactly one SeenFiles.
    const messages = await dev.watchSynchronizationMessagesFor(() => mkdirSync(dev.join("unrelated")));
    expect(messages).toStrictEqual(["SeenFiles"]);
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

// Two routes, so that `roundTrip` below always has a different route to switch to.
const hmrSubscriptionFiles = {
  "a.html": emptyHtmlFile({ scripts: ["a.ts"], body: "<h1>A</h1>" }),
  "b.html": emptyHtmlFile({ body: "<h1>B</h1>" }),
  "a.ts": `
    console.log(0);
  `,
};

/** Opens a raw `/_bun/hmr` socket next to the harness's own and records the id byte of every frame published to it. */
async function openHmrSocket(dev: Dev) {
  const received: string[] = [];
  const probeReplies: PromiseWithResolvers<void>[] = [];
  const opened = Promise.withResolvers<void>();
  let failure: Error | undefined;
  let frameWaiter: { done(): boolean; resolve(): void; reject(err: Error): void } | undefined;
  const fail = (why: string) => {
    failure ??= new Error(`${why} (received ${JSON.stringify(received)})`);
    opened.reject(failure);
    for (const reply of probeReplies.splice(0)) reply.reject(failure);
    frameWaiter?.reject(failure);
    frameWaiter = undefined;
  };
  const ws = new WebSocket(dev.baseUrl.replace("http", "ws") + "/_bun/hmr");
  ws.binaryType = "arraybuffer";
  ws.onerror = () => fail("hmr websocket errored");
  ws.onclose = event => fail(`hmr websocket closed with code ${event.code}`);
  ws.onmessage = event => {
    const id = String.fromCharCode(new Uint8Array(event.data as ArrayBuffer)[0]);
    if (id === "V") {
      opened.resolve();
    } else if (id === "n") {
      probeReplies.shift()!.resolve();
    } else {
      received.push(id);
      if (frameWaiter?.done()) {
        frameWaiter.resolve();
        frameWaiter = undefined;
      }
    }
  };
  await opened.promise;

  let probeRoute = "/a";
  return {
    received,
    send: (frame: string) => ws.send(frame),
    /** The dev server answers SetUrl ('n' + route) on this socket after every frame sent or published before it, but only when the route changes. */
    async roundTrip() {
      if (failure) throw failure;
      probeRoute = probeRoute === "/a" ? "/b" : "/a";
      const reply = Promise.withResolvers<void>();
      probeReplies.push(reply);
      ws.send("n" + probeRoute);
      await reply.promise;
    },
    /** Resolves once `count` frames with the given id have been received in total. */
    waitForFrames(id: string, count: number) {
      const done = () => received.filter(x => x === id).length >= count;
      return new Promise<void>((resolve, reject) => {
        if (failure) return reject(failure);
        if (done()) return resolve();
        const deadline = setTimeout(() => fail(`timed out waiting for ${id} frame #${count}`), 5_000 * WAIT_MULTIPLIER);
        frameWaiter = {
          done,
          resolve: () => {
            clearTimeout(deadline);
            resolve();
          },
          reject: err => {
            clearTimeout(deadline);
            reject(err);
          },
        };
      });
    },
    /** Closes the socket, which unsubscribes it on the server, and waits for the close handshake. */
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (failure) return reject(failure);
        ws.onerror = () => reject(new Error("hmr socket errored during the close handshake"));
        ws.onclose = () => resolve();
        ws.close();
      }),
    [Symbol.dispose]() {
      ws.onclose = null;
      ws.close();
    },
  };
}

devTest("re-subscribing the hmr socket with fewer topics stops delivery of the dropped topics", {
  files: hmrSubscriptionFiles,
  async test(dev) {
    // The harness's own hmr socket stays subscribed to 'r', so every rebuild publishes to that topic; whether this socket gets it depends only on its subscription.
    await dev.fetch("/a").expect.toInclude("<h1>A</h1>");
    using socket = await openHmrSocket(dev);

    let edit = 0;
    /** Subscribes to `topics`, rebuilds, and returns the message ids the socket was sent. */
    async function messagesDuringRebuild(topics: string) {
      socket.send("s" + topics);
      await socket.roundTrip();
      socket.received.length = 0;
      await dev.write("a.ts", `console.log(${++edit});`);
      await socket.roundTrip();
      return [...new Set(socket.received)].sort();
    }

    // 'h' delivers hot updates ('u'), 'r' delivers watch synchronization ('r').
    expect(await messagesDuringRebuild("hr")).toStrictEqual(["r", "u"]);
    expect(await messagesDuringRebuild("r")).toStrictEqual(["r"]);
    expect(await messagesDuringRebuild("")).toStrictEqual([]);
    expect(await messagesDuringRebuild("hr")).toStrictEqual(["r", "u"]);
  },
});

devTest("unsubscribing the last memory visualizer socket stops its timer", {
  files: hmrSubscriptionFiles,
  async test(dev) {
    // With BAKE_DEBUGGING_FEATURES, subscribing to 'M' arms a timer and re-subscribing while it is armed fails an assertion that closes the dev server; the 'v' subscriber must not keep it armed.
    using incremental = await openHmrSocket(dev);
    incremental.send("sv");
    await incremental.roundTrip();
    using memory = await openHmrSocket(dev);
    memory.send("sM");
    memory.send("s");
    memory.send("sM");
    await memory.roundTrip();
  },
});

// The `M` (memory visualizer) topic only emits frames in builds with `BAKE_DEBUGGING_FEATURES` (canary or debug).
const hasBakeDebuggingFeatures = isDebug || Bun.version_with_sha.includes("-canary.");

const memoryVisualizerApp = {
  "index.html": emptyHtmlFile({}),
  "bun.app.ts": `
    import html from "./index.html";
    // Always armed in the dev server's timer heap; /tick answers on its next fire.
    const waiters = [];
    setInterval(() => {
      for (const resolve of waiters.splice(0)) resolve();
    }, 20);
    export default {
      static: {
        "/": html,
      },
      async fetch(req) {
        if (new URL(req.url).pathname === "/tick") {
          await new Promise(resolve => waiters.push(resolve));
          return new Response("ticked");
        }
        return new Response("Not Found", { status: 404 });
      },
    };
  `,
};

/** Subscribes an extra hmr socket to `M`; the server answers with one frame immediately and then one per timer tick. */
async function subscribeMemoryVisualizer(dev: Dev) {
  const socket = await openHmrSocket(dev);
  socket.send("sM");
  await socket.waitForFrames("M", 1);
  return socket;
}

if (hasBakeDebuggingFeatures) {
  devTest("memory visualizer topic ticks while subscribed and unsubscribes without disturbing other timers", {
    files: memoryVisualizerApp,
    htmlFiles: [],
    async test(dev) {
      const start = performance.now();
      const subscriber = await subscribeMemoryVisualizer(dev);
      // Frame 3 only arrives if the tick handler re-armed the timer after firing.
      await subscriber.waitForFrames("M", 3);
      // Two real ticks take at least 2s; a re-insert without moving the deadline would deliver frame 3 at ~1s.
      expect(performance.now() - start).toBeGreaterThanOrEqual(1500);

      // Removing the visualizer timer used to discard whichever timer was at the heap root instead, so the fixture's interval never fired again.
      await dev.fetch("/tick").equals("ticked");
      await subscriber.close();
      await dev.fetch("/tick").equals("ticked");

      // Left open on purpose: the harness's graceful exit closes it while the timer is armed.
      await subscribeMemoryVisualizer(dev);
    },
  });

  devTest("memory visualizer timer stays armed while another subscriber remains", {
    files: memoryVisualizerApp,
    htmlFiles: [],
    async test(dev) {
      const first = await subscribeMemoryVisualizer(dev);
      const second = await subscribeMemoryVisualizer(dev);
      await first.close();
      // A frame from a tick just before the close can still be in flight, so only the second frame from here on proves the timer is still armed.
      await second.waitForFrames("M", second.received.filter(id => id === "M").length + 2);
    },
  });
}

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
    );
    // dev.write resolves on bun:afterUpdate, i.e. after replaceModules has
    // awaited the 500ms TLA. Acking on WS receipt would see "initial" here.
    expect(await c.js`globalThis.marker`).toBe("updated");
  },
});

devTest("dev.client rejects when the page has a build error the test did not expect", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `import "./missing";`,
  },
  async test(dev) {
    // Not expect().rejects: on Windows that matcher starves the client's IPC messages while it waits.
    const error = await runWithErrorPromise(() => dev.client("/"));
    expect(error?.message).toContain("index.ts:1:8: error: Could not resolve");
  },
});

devTest("dev.write rejects on an unexpected build error and resolves once the fix has been applied", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      globalThis.marker = "initial";
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    expect(await c.js`globalThis.marker`).toBe("initial");

    const error = await runWithErrorPromise(() => dev.write("index.ts", `import "./missing";`));
    expect(error?.message).toContain("index.ts:1:8: error: Could not resolve");

    // The fixing build sends "e" (overlay hidden) then "u"; dev.write must resolve on the update, after the 200ms TLA.
    await dev.write(
      "index.ts",
      `
        await new Promise(r => setTimeout(r, 200));
        globalThis.marker = "fixed";
        import.meta.hot.accept();
      `,
    );
    expect(await c.js`globalThis.marker`).toBe("fixed");
  },
});

devTest("dev.write resolves only after a reload it triggers has loaded the new page", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    // Not self-accepting, so updating it falls back to a full reload.
    "index.ts": `globalThis.marker = "v1";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    expect(await c.js`globalThis.marker`).toBe("v1");

    await c.expectReload(() => dev.write("index.ts", `globalThis.marker = "v2";`));
    // Acked by the reloaded page once connected; the abandoned page's bun:afterUpdate would see undefined here.
    expect(await c.js`globalThis.marker`).toBe("v2");
  },
});
