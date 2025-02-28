// Tests which apply to both dev and prod. They are run twice.
import { devAndProductionTest, emptyHtmlFile } from "./bake-harness";

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
devAndProductionTest("using runtime import", {
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
      console.log(require === eval("module.require"));
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
    await c.expectMessage("b", "a", "decorator");
  },
});
