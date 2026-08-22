// Plugin tests concern plugins in development mode.
import { devTest, minimalFramework } from "../bake-harness";

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

// The paths `Path::dupe_alloc` hands the bundle may live in the bundle's arena
// (here: the path a plugin returned, and an import from outside the project
// root), and the dev server frees that arena after every build. The watcher
// keeps every watched file's path for the rest of the process, so it has to
// copy them; when it borrowed them, the watch event for such a file read freed
// memory. The rebuilds of the route free a few more arenas first, and the
// mimalloc settings make freed pages go straight back to the OS, so a borrowed
// path crashes the dev server instead of happening to still read the old bytes.
devTest("files whose paths came from a plugin or from outside the root stay hot-reloadable", {
  framework: minimalFramework,
  // The Windows watcher only covers the project root, so the outside-root
  // file cannot be watched there at all.
  skip: ["win32"],
  env: { MIMALLOC_PURGE_DELAY: "0", MIMALLOC_ABANDONED_PAGE_PURGE: "1" },
  pluginFile: `
    import * as path from 'path';
    export default [
      {
        name: 'from-plugin',
        setup(build) {
          build.onResolve({ filter: /^from-plugin$/ }, () => {
            return { path: path.join(import.meta.dirname, 'from-plugin.ts') };
          });
        },
      },
    ];
  `,
  files: {
    "from-plugin.ts": `export const fromPlugin = "plugin 1";`,
    "../plugins-outside-root/outside.ts": `export const outside = "outside 1";`,
    "routes/index.ts": `
      import { fromPlugin } from 'from-plugin';
      import { outside } from '../../plugins-outside-root/outside';
      export default function (req, meta) {
        return new Response(fromPlugin + ", " + outside);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("plugin 1, outside 1");
    for (let i = 1; i <= 4; i++) {
      await dev.write(
        "routes/index.ts",
        `
          import { fromPlugin } from 'from-plugin';
          import { outside } from '../../plugins-outside-root/outside';
          export default function (req, meta) {
            return new Response("v${i}: " + fromPlugin + ", " + outside);
          }
        `,
      );
      await dev.fetch("/").equals(`v${i}: plugin 1, outside 1`);
    }
    await dev.write("from-plugin.ts", `export const fromPlugin = "plugin 2";`);
    await dev.fetch("/").equals("v4: plugin 2, outside 1");
    await dev.write("../plugins-outside-root/outside.ts", `export const outside = "outside 2";`);
    await dev.fetch("/").equals("v4: plugin 2, outside 2");
  },
});
