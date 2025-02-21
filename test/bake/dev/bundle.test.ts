// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
import { Client, Dev, devTest, emptyHtmlFile, minimalFramework, reactRefreshStub } from "../dev-server-harness";

devTest("import identifier doesnt get renamed", {
  framework: minimalFramework,
  files: {
    "db.ts": `export const abc = "123";`,
    "routes/index.ts": `
      import { abc } from '../db';
      export default function (req, meta) {
        let v1 = "";
        const v2 = v1
          ? abc.toFixed(2)
          : abc.toString();
        return new Response('Hello, ' + v2 + '!');
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Hello, 123!");
    await dev.write("db.ts", `export const abc = "456";`);
    await dev.fetch("/").equals("Hello, 456!");
    await dev.patch("routes/index.ts", {
      find: "Hello",
      replace: "Bun",
    });
    await dev.fetch("/").equals("Bun, 456!");
  },
});
devTest("symbol collision with import identifier", {
  framework: minimalFramework,
  files: {
    "db.ts": `export const abc = "123";`,
    "routes/index.ts": `
      let import_db = 987;
      import { abc } from '../db';
      export default function (req, meta) {
        let v1 = "";
        const v2 = v1
          ? abc.toFixed(2)
          : abc.toString();
        return new Response('Hello, ' + v2 + ', ' + import_db + '!');
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Hello, 123, 987!");
    await dev.write("db.ts", `export const abc = "456";`);
    await dev.fetch("/").equals("Hello, 456, 987!");
  },
});
devTest('uses "development" condition', {
  framework: minimalFramework,
  files: {
    "node_modules/example/package.json": JSON.stringify({
      name: "example",
      version: "1.0.0",
      exports: {
        ".": {
          development: "./development.js",
          default: "./production.js",
        },
      },
    }),
    "node_modules/example/development.js": `export default "development";`,
    "node_modules/example/production.js": `export default "production";`,
    "routes/index.ts": `
      import environment from 'example';
      export default function (req, meta) {
        return new Response('Environment: ' + environment);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Environment: development");
  },
});
devTest("importing a file before it is created", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { abc } from './second';
      console.log('value: ' + abc);
    `,
  },
  async test(dev) {
    const c = await dev.client("/", {
      errors: [`index.ts:1:21: error: Could not resolve: "./second"`],
    });

    await c.expectReload(async () => {
      await dev.write("second.ts", `export const abc = "456";`);
    });

    await c.expectMessage("value: 456");
  },
});
devTest("barrel file optimization (lucide-react)", {
  files: {
    ...reactRefreshStub,
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts", "react-refresh/runtime"],
    }),
    "index.ts": `
      import { Icon1 } from 'lucide-react';
      import { Icon2 } from 'lucide-react';
      console.log(Icon1(), Icon2());
    `,
    // Current BFO only handles some well-known package names, and only when the
    // file is just re-exporting the icons.
    "node_modules/lucide-react/index.js": `
      export { default as Icon1 } from './icons/icon1';
      export { default as Icon2 } from './icons/icon2';
      export { default as Icon3 } from './icons/icon3';
      export { default as Icon4 } from './icons/icon4';
    `,
    ...Object.fromEntries(
      [1, 2, 3, 4].map(i => [
        `node_modules/lucide-react/icons/icon${i}.ts`,
        `export default function Icon${i}() { return "CAPTURE(${i})"; }`,
      ]),
    ),
  },
  async test(dev) {
    function captureIconRefs(text: string) {
      const refs = text.matchAll(/CAPTURE\((\d+)\)/g);
      return Array.from(refs).map(ref => ref[1]);
    }
    async function fetchScriptSrc(c: Client) {
      const srcUrl = await c.js`document.querySelector("script").src`;
      return await dev.fetch(srcUrl).text();
    }

    // Should only serve icons 1 and 2 since those were the only ones referenced.
    const c = await dev.client("/", {});
    await c.expectMessage("CAPTURE(1)", "CAPTURE(2)");
    {
      const src = await fetchScriptSrc(c);
      const refs = captureIconRefs(src);
      expect(refs).toEqual(["1", "2"]);
    }

    // Saving index.ts should re-run itself but only serve 'index.ts'
    {
      await dev.writeNoChanges("index.ts");
      await c.expectMessage("CAPTURE(1)", "CAPTURE(2)");
      const chunk = await c.getMostRecentHmrChunk();
      const keys = eval(chunk);
      expect(captureIconRefs(chunk)).toEqual([]);
      expect(keys).toEqual(["index.ts"]);

      const src = await fetchScriptSrc(c);
      expect(captureIconRefs(src)).toEqual(["1", "2"]);
    }

    // Changing the list of icons should
    // 1. reload with the one new icon
    // 2. rebuild will omit icon 2 (not really special DevServer behavior)
    {
      await dev.write(
        "index.ts",
        `
        import { Icon1 } from 'lucide-react';
        import { Icon3 } from 'lucide-react';
        console.log(Icon1(), Icon3());
      `,
      );
      // 1.
      await c.expectMessage("CAPTURE(1)", "CAPTURE(3)");
      const chunk = await c.getMostRecentHmrChunk();
      expect(captureIconRefs(chunk)).toEqual(["3"]);

      // 2.
      const src = await fetchScriptSrc(c);
      expect(captureIconRefs(src)).toEqual(["1", "3"]);
    }

    // Saving index.ts should re-run itself but only serve 'index.ts'
    {
      await dev.writeNoChanges("index.ts");
      await c.expectMessage("CAPTURE(1)", "CAPTURE(2)");
      const chunk = await c.getMostRecentHmrChunk();
      const keys = eval(chunk);
      expect(captureIconRefs(chunk)).toEqual([]);
      expect(keys).toEqual(["index.ts"]);

      const src = await fetchScriptSrc(c);
      expect(captureIconRefs(src)).toEqual(["1", "2"]);
    }
  },
});
