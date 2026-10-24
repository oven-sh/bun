// Plugin tests concern plugins in development mode.
import { devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

// Note: more in depth testing of plugins is done in test/bundler/bundler_plugin.test.ts
devTest("onResolve", {
  framework: minimalFramework,
  pluginFile: `
    import * as path from 'path';
    export default [
      {
        name: 'a',
        setup(build) {
          build.onResolve({ filter: /trigger/ }, (args) => {
            return { path: path.join(import.meta.dirname, '/file.ts') };
          });
        },
      }
    ];
  `,
  files: {
    "file.ts": `
      export const value = 1;
    `,
    "routes/index.ts": `
      import { value } from 'trigger';

      export default function (req, meta) {
        return new Response('value: ' + value);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("value: 1");
  },
});
devTest("onLoad", {
  framework: minimalFramework,
  pluginFile: `
    import * as path from 'path';
    export default [
      {
        name: 'a',
        setup(build) {
          build.onLoad({ filter: /trigger/ }, (args) => {
            return { contents: 'export const value = 1;', loader: 'ts' };
          });
        },
      }
    ];
  `,
  files: {
    "trigger.ts": `
      throw new Error('should not be loaded');
    `,
    "routes/index.ts": `
      import { value } from '../trigger.ts';

      export default function (req, meta) {
        return new Response('value: ' + value);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("value: 1");
    await dev.fetch("/").equals("value: 1");
    await dev.fetch("/").equals("value: 1");
  },
});
devTest("onResolve + onLoad virtual file", {
  framework: minimalFramework,
  pluginFile: `
    import * as path from 'path';
    export default [
      {
        name: 'a',
        setup(build) {
          build.onResolve({ filter: /^trigger$/ }, (args) => {
            return { path: "hello.ts", namespace: "virtual" };
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
            return { contents: 'export default ' + JSON.stringify(args) + ';', loader: 'ts' };
          });
        },
      }
    ];
  `,
  files: {
    // this file must not collide with the virtual file
    "hello.ts": `
      export default "file-on-disk";
    `,
    "routes/index.ts": `
      import disk from '../hello';
      import virtual from 'trigger';

      export default function (req, meta) {
        return Response.json([virtual, disk]);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals([
      {
        path: "hello.ts",
        namespace: "virtual",
        loader: "ts",
        side: "server",
      },
      "file-on-disk",
    ]);
  },
});
// A file is one module for each loader it is imported with. onLoad runs for each module, and
// `args.loader` is the loader that the import asks for.
devTest("onLoad sees the loader of each module of a file", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./css-plugin.ts"]
    `,
    "css-plugin.ts": `
      export default {
        name: "css-plugin",
        setup(build) {
          build.onLoad({ filter: /\\.css$/ }, args =>
            args.loader === "text"
              ? { contents: "text from the plugin" }
              : { contents: ".plugin-" + args.loader + " { color: blue; }", loader: "css" },
          );
        },
      };
    `,
    "index.html": emptyHtmlFile({ styles: ["x.css"], scripts: ["app.ts"] }),
    "x.css": `.box { color: red; }`,
    "app.ts": `
      import text from "./x.css" with { type: "text" };
      let value;
      try {
        value = text;
      } catch (e) {
        value = "throws " + e.name;
      }
      console.log(value);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    // The result for the text module has no loader, so it is text.
    await c.expectMessage("text from the plugin");
    await c.style(".plugin-css").color.expect.toBe("#00f");
    await c.style(".box").notFound();
  },
});
// An import keeps its `with { type }` when an onResolve plugin resolves it.
devTest("onResolve keeps the type of the import", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./alias-plugin.ts"]
    `,
    "alias-plugin.ts": `
      import { join } from "node:path";
      export default {
        name: "alias-plugin",
        setup(build) {
          build.onResolve({ filter: /^alias:data$/ }, () => ({ path: join(import.meta.dirname, "data.json") }));
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["app.ts"] }),
    "data.json": `{"version":1}`,
    "app.ts": `
      import data from "alias:data";
      import text from "alias:data" with { type: "text" };
      let value;
      try {
        value = typeof data + " " + data.version + ", " + typeof text + " " + text;
      } catch (e) {
        value = "throws " + e.name;
      }
      console.log(value);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(`object 1, string {"version":1}`);

    await c.expectReload(async () => {
      await dev.write("data.json", `{"version":2}`);
    });
    await c.expectMessage(`object 2, string {"version":2}`);
  },
});
// devTest("onLoad with watchFile", {
//   framework: minimalFramework,
//   pluginFile: `
//     import * as path from 'path';
//     export default [
//       {
//         name: 'a',
//         setup(build) {
//           let a = 0;
//           build.onLoad({ filter: /trigger/ }, (args) => {
//             a += 1;
//             return { contents: 'export const value = ' + a + ';', loader: 'ts' };
//           });
//         },
//       }
//     ];
//   `,
//   files: {
//     "trigger.ts": `
//       throw new Error('should not be loaded');
//     `,
//     "routes/index.ts": `
//       import { value } from '../trigger.ts';

//       export default function (req, meta) {
//         return new Response('value: ' + value);
//       }
//     `,
//   },
//   async test(dev) {
//     await dev.fetch("/").expect('value: 1');
//     await dev.fetch("/").expect('value: 1');
//     await dev.write("trigger.ts", "throw new Error('should not be loaded 2');");
//     await dev.fetch("/").expect('value: 2');
//     await dev.fetch("/").expect('value: 2');
//   },
// });
