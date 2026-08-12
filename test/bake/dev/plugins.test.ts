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
// The dev server runs the bundle on the JS thread itself (the other arm of the
// plugin hops exercised by test/bundler/bundler_defer.test.ts). A `defer()` issued
// after the callback already answered must not count against the scan: y's pending
// unit already belongs to the parse of its answer, and parking it again made the
// scan look finished before z (imported by that answer) was loaded, so x's
// `defer()` resolved early.
devTest("onLoad defer() after answering does not resolve other loads' defer() early", {
  framework: minimalFramework,
  pluginFile: `
    let zLoaded = false;
    export default [
      {
        name: 'late-defer',
        setup(build) {
          build.onLoad({ filter: /[\\\\/]x\\.ts$/ }, async ({ defer }) => {
            await defer();
            return { contents: 'export const zLoadedBeforeXResumed = ' + zLoaded + ';', loader: 'ts' };
          });
          build.onLoad({ filter: /[\\\\/]y\\.ts$/ }, ({ defer }) => {
            queueMicrotask(() => void defer());
            return { contents: 'import "./z.ts";', loader: 'ts' };
          });
          build.onLoad({ filter: /[\\\\/]z\\.ts$/ }, () => {
            zLoaded = true;
            return { contents: 'export const z = 1;', loader: 'ts' };
          });
        },
      },
    ];
  `,
  files: {
    "x.ts": `throw new Error('disk contents of x were bundled');`,
    "y.ts": `throw new Error('disk contents of y were bundled');`,
    "z.ts": `throw new Error('disk contents of z were bundled');`,
    "routes/index.ts": `
      import { zLoadedBeforeXResumed } from '../x.ts';
      import '../y.ts';

      export default function (req, meta) {
        return new Response('z loaded before x resumed: ' + zLoadedBeforeXResumed);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("z loaded before x resumed: true");
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
