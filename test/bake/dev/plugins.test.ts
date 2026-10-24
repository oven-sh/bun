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
// A hot update bundles a file by its path, and the resolver then gives it the module type of its package.json.
// A file that an `onResolve` plugin names has that type from its first bundle, so its default import does not change.
{
  const file = `
    import d from "babel-default";
    export const read = () => typeof d + " v1";
  `;
  devTest("a file that a plugin names keeps its default import of a CommonJS module across hot updates", {
    framework: minimalFramework,
    pluginFile: `
      import * as path from 'path';
      export default [
        {
          name: 'alias',
          setup(build) {
            build.onResolve({ filter: /^aliased:/ }, args => {
              return { path: path.join(import.meta.dirname, args.path.slice('aliased:'.length)) };
            });
          },
        }
      ];
    `,
    files: {
      "node_modules/babel-default/package.json": JSON.stringify({ name: "babel-default", main: "index.js" }),
      "node_modules/babel-default/index.js": `
        exports.__esModule = true;
        exports.default = function Modal() {};
      `,
      "type-module/package.json": `{ "type": "module" }`,
      "type-module/file.js": file,
      "untyped/file.js": file,
      "routes/index.ts": `
        import { read as typed } from 'aliased:type-module/file.js';
        import { read as untyped } from 'aliased:untyped/file.js';

        export default function (req, meta) {
          return Response.json({ typed: typed(), untyped: untyped(), route: 'r1' });
        }
      `,
    },
    async test(dev) {
      await dev.fetch("/").equals({ typed: "object v1", untyped: "function v1", route: "r1" });
      await dev.patch("type-module/file.js", { find: "v1", replace: "v2" });
      await dev.patch("untyped/file.js", { find: "v1", replace: "v2" });
      await dev.fetch("/").equals({ typed: "object v2", untyped: "function v2", route: "r1" });
      await dev.patch("routes/index.ts", { find: "r1", replace: "r2" });
      await dev.fetch("/").equals({ typed: "object v2", untyped: "function v2", route: "r2" });
    },
  });
}
