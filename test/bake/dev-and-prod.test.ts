// Tests which apply to both dev and prod. They are run twice.
import { devAndProductionTest, devTest, emptyHtmlFile } from "./bake-harness";

const hmrSelfAcceptingModule = (label: string) => `
  console.log(${JSON.stringify(label)});
  if (import.meta.hot) {
    import.meta.hot.accept();
  }
`;

devAndProductionTest("define config via bunfig.toml", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log("a=" + DEFINE);
    `,
    "bunfig.toml": `
      [serve.static]
      define = {
        "DEFINE" = "\\"HELLO\\""
      }
    `,
  },
  async test(dev) {
    const c = await dev.client("/");
    await c.expectMessage("a=HELLO");
  },
});
devAndProductionTest("invalid html does not crash 1", {
  files: {
    "public/index.html": `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Dashboard</title>
          <link rel="stylesheet" href="../src/app/styles.css" />
        </head>
        <body>
          <div id="root" />
          <script type="module" src="../src/app/index.tsx" />
        </body>
      </html>
    `,
    "src/app/index.tsx": `
      console.log("hello");
    `,
    "src/app/styles.css": `
      body {
        background-color: red;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("hello");
    await c.style("body").backgroundColor.expect.toBe("red");
  },
});
devAndProductionTest("missing head end tag works fine", {
  files: {
    "public/index.html": `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Dashboard</title>
          <link rel="stylesheet" href="../src/app/styles.css"></link>
        <body>
          <div id="root" />
          <script type="module" src="../src/app/index.tsx"></script>
        </body>
      </html>
    `,
    "src/app/index.tsx": `
      console.log("hello");
    `,
    "src/app/styles.css": `
      body {
        background-color: red;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("hello");
    await c.style("body").backgroundColor.expect.toBe("red");
  },
});
devAndProductionTest("missing all meta tags works fine", {
  files: {
    "public/index.html": `
      <title>Dashboard</title>
      <link rel="stylesheet" href="../src/app/styles.css"></link>

      <div id="root" />
      <script type="module" src="../src/app/index.tsx"></script>
    `,
    "src/app/index.tsx": `
      console.log("hello");
    `,
    "src/app/styles.css": `
      body {
        background-color: red;
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").expect.toInclude("root");
    await using c = await dev.client("/");
    await c.expectMessage("hello");
    await c.style("body").backgroundColor.expect.toBe("red");
  },
});
devAndProductionTest("inline script and styles appear", {
  files: {
    "public/index.html": `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Dashboard</title>
          <style> body { background-color: red; } </style>
        </head>
        <body>
          <script> console.log("hello " + (1 + 2)); </script>
        </body>
      </html>
    `,
  },
  async test(dev) {
    await dev.fetch("/").expect.toInclude("hello");
    await dev.fetch("/").expect.not.toInclude("hello 3"); // TODO:
    await using c = await dev.client("/");
    await c.expectMessage("hello 3");
    await c.style("body").backgroundColor.expect.toBe("red");
  },
});
// TODO: revive production
devTest("using runtime import", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      // __using
      {
        using a = { [Symbol.dispose]: () => console.log("a") };
        console.log("b");
      }

      // __legacyDecorateClassTS
      function undefinedDecorator(target) {
        console.log("decorator");
      }
      @undefinedDecorator
      class x {}

      // __require
      const A = () => require;
      const B = () => module.require;
      const C = () => import.meta.require;
      if (import.meta.hot) {
        console.log(A.toString().replaceAll(" ", "").replaceAll("\\n", ""));
        console.log(B.toString().replaceAll(" ", "").replaceAll("\\n", ""));
        console.log(C.toString().replaceAll(" ", "").replaceAll("\\n", ""));
        console.log(A() === eval("hmr.require"));
        console.log(B() === eval("hmr.require"));
        console.log(C() === eval("hmr.require"));
        if (typeof A() !== "function") throw new Error("A is not a function");
        if (typeof B() !== "function") throw new Error("B is not a function");
        if (typeof C() !== "function") throw new Error("C is not a function");
      }
    `,
    "tsconfig.json": `
      {
        "compilerOptions": {
          "experimentalDecorators": true
        }
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(
      "b",
      "a",
      "decorator",
      ...(dev.nodeEnv === "development"
        ? [
            // TODO: all of these should be `hmr.require`
            "()=>hmr.require",
            "()=>module.require", // not being visited
            "()=>hmr.importMeta.require", // not being visited
            true,
            false,
            false,
          ]
        : []),
    );
  },
});
devTest("hmr handles rapid consecutive edits", {
  // Regression coverage for https://github.com/oven-sh/bun/issues/19736.
  // Rapid unsynchronized writes can cause the HMR system to fall back to a
  // full page reload (the previous module's `import.meta.hot.accept()` may no
  // longer be valid). Allow unlimited reloads so the client doesn't die, and
  // bump the timeout for slow Windows CI runners. If the #19736 fix were
  // reverted, the "Unknown HMR script" error would fire console.error in the
  // HMR runtime, killing the client-fixture, so "render 10" would never arrive.
  timeoutMultiplier: 3,
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": hmrSelfAcceptingModule("render 1"),
  },
  async test(dev) {
    await using client = await dev.client("/", { allowUnlimitedReloads: true });
    await client.expectMessage("render 1");

    for (let i = 2; i <= 10; i++) {
      await Bun.write(dev.join("index.ts"), hmrSelfAcceptingModule(`render ${i}`));
      await Bun.sleep(1);
    }

    // Wait for "render 10" to appear. Intermediate renders may be skipped
    // (watcher coalescing) and the final render may fire multiple times
    // (duplicate reloads / full-page reloads), so we just check for any
    // occurrence.
    const finalRender = "render 10";
    const deadline = Date.now() + 10_000;
    while (!client.messages.includes(finalRender)) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for "${finalRender}". ` +
            `Messages received: [${client.messages.map((m) => JSON.stringify(m)).join(", ")}]`,
        );
      }
      await Bun.sleep(50);
    }
    // Drain all buffered messages — intermediate renders and possible
    // duplicates of the final render are expected and harmless.
    client.messages.length = 0;
  },
});
