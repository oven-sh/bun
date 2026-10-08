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

devTest("a file a plugin resolves to is not sent again when its importer changes", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["item.ts"],
    }),
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      import * as path from "node:path";
      export default {
        name: "shared",
        setup(build) {
          // Spelled with forward slashes, as a plugin building paths from a template does.
          build.onResolve({ filter: /^shared$/ }, () => ({
            path: path.join(import.meta.dir, "shared.ts").replaceAll("\\\\", "/"),
          }));
        },
      };
    `,
    "shared.ts": `
      console.log("shared");
      export default "s";
    `,
    "item.ts": `
      import s from "shared";
      console.log("item " + s + " 1");
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("shared", "item s 1");
    // Only item.ts changed: shared.ts must not run again (its state kept).
    await dev.patch("item.ts", { find: " 1", replace: " 2" });
    await c.expectMessage("item s 2");
    await dev.patch("item.ts", { find: " 2", replace: " 3" });
    await c.expectMessage("item s 3");
  },
});
devTest("a file a plugin resolves to with forward slashes is watched", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["item.ts"],
    }),
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      import * as path from "node:path";
      export default {
        name: "shared",
        setup(build) {
          // Spelled with forward slashes, as a plugin building paths from a template does.
          build.onResolve({ filter: /^shared$/ }, () => ({
            path: path.join(import.meta.dir, "shared.ts").replaceAll("\\\\", "/"),
          }));
        },
      };
    `,
    "shared.ts": `
      export default "s1";
    `,
    "item.ts": `
      import s from "shared";
      console.log("item " + s);
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("item s1");
    await dev.patch("shared.ts", { find: "s1", replace: "s2" });
    await c.expectMessage("item s2");
    await dev.patch("shared.ts", { find: "s2", replace: "s3" });
    await c.expectMessage("item s3");
  },
});
