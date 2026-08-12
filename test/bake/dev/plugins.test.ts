// Plugin tests concern plugins in development mode.
import { expect } from "bun:test";
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
// The two ways an onLoad answer fails its file: the callback threw, or nothing answered
// for a module outside the file namespace. Each plugin below awaits `defer()` first, which
// resolves once nothing else in the bundle is pending, so its answer is what finishes the
// bundle: the dev server then tears the bundle down (including the arena that the request
// being answered lives in) while that answer is still being handled. MIMALLOC_PURGE_DELAY=0
// makes a touch of the torn-down arena fault instead of reading memory that still happens
// to look intact.
function failingOnLoadFiles(plugin: string, entry: string) {
  return {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": plugin,
    "index.html": emptyHtmlFile({ scripts: ["entry.ts"] }),
    "entry.ts": entry,
  };
}
devTest("onLoad callback that throws fails the route and leaves the dev server usable", {
  env: { MIMALLOC_PURGE_DELAY: "0" },
  files: failingOnLoadFiles(
    `
      export default {
        name: "throwing-onload",
        setup(build) {
          build.onLoad({ filter: /entry\\.ts$/ }, async ({ defer }) => {
            await defer();
            throw new Error("onLoad failed on purpose");
          });
        },
      };
    `,
    `console.log("never bundled");`,
  ),
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.output.waitForLine(/onLoad failed on purpose/);
    // Bundles the route again, so the dev server has to be intact after the failed bundle.
    expect((await dev.fetch("/")).status).toBe(500);
  },
});
devTest("onLoad that does not answer for a module outside the file namespace leaves the dev server usable", {
  env: { MIMALLOC_PURGE_DELAY: "0" },
  files: failingOnLoadFiles(
    `
      export default {
        name: "declining-onload",
        setup(build) {
          build.onResolve({ filter: /^virtual:config$/ }, () => ({ path: "config", namespace: "virtual" }));
          // Registered so that the bundler asks this plugin to load the module; answering
          // nothing leaves a module outside the file namespace with nothing to load it from.
          build.onLoad({ filter: /.*/, namespace: "virtual" }, async ({ defer }) => {
            await defer();
            return undefined;
          });
        },
      };
    `,
    `import "virtual:config";`,
  ),
  async test(dev) {
    // Only the error being reported is asserted here: this failure is logged against the
    // bundle rather than the file, so unlike a thrown callback it does not fail the route.
    await dev.fetch("/");
    await dev.output.waitForLine(/Module not found "virtual:config" in namespace "virtual"/);
    await dev.fetch("/");
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
