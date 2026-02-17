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
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": hmrSelfAcceptingModule("render 1"),
  },
  async test(dev) {
    await using client = await dev.client("/");
    await client.expectMessage("render 1");

    // Regression coverage for https://github.com/oven-sh/bun/issues/19736.
    await client.js`
      const tracked = [];
      globalThis.__hmrErrors = tracked;

      const maybeRecord = value => {
        const message =
          typeof value === "string"
            ? value
            : value?.message ?? value?.reason ?? "";
        if (typeof message === "string" && message.includes("Unknown HMR script")) {
          console.log("HMR_ERROR: " + message);
          tracked.push(message);
          return true;
        }
        return false;
      };

      window.addEventListener("error", event => {
        if (maybeRecord(event.error ?? event.message)) {
          event.preventDefault();
        }
      });

      window.addEventListener("unhandledrejection", event => {
        if (maybeRecord(event.reason)) {
          event.preventDefault();
        }
      });

      const hmrSymbol = Symbol.for("bun:hmr");
      const originalHmr = globalThis[hmrSymbol];
      if (typeof originalHmr === "function") {
        globalThis[hmrSymbol] = function (...args) {
          try {
            return originalHmr.apply(this, args);
          } catch (error) {
            maybeRecord(error);
          }
        };
      }
    `;

    for (let i = 2; i <= 10; i++) {
      await Bun.write(dev.join("index.ts"), hmrSelfAcceptingModule(`render ${i}`));
      await Bun.sleep(1);
    }

    // Wait event-driven for "render 10" to appear. Intermediate renders may
    // be skipped (watcher coalescing) and the final render may fire multiple
    // times (duplicate reloads), so we just listen for any occurrence.
    const finalRender = "render 10";
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        for (const msg of client.messages) {
          if (typeof msg === "string" && msg.includes("HMR_ERROR")) {
            cleanup();
            reject(new Error("Unexpected HMR error message: " + msg));
            return;
          }
          if (msg === finalRender) {
            cleanup();
            resolve();
            return;
          }
        }
      };
      const cleanup = () => {
        client.off("message", check);
      };
      client.on("message", check);
      // Check messages already buffered.
      check();
    });
    // Drain all buffered messages — intermediate renders and possible
    // duplicates of the final render are expected and harmless.
    client.messages.length = 0;

    const hmrErrors = await client.js`return globalThis.__hmrErrors ? [...globalThis.__hmrErrors] : [];`;
    if (hmrErrors.length > 0) {
      throw new Error("Unexpected HMR errors: " + hmrErrors.join(", "));
    }
  },
});
