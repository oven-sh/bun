// Plugin tests concern plugins in development mode.
import { expect } from "bun:test";
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
// An import with `bunBakeGraph: "ssr"` is for the SSR graph, also when an onResolve plugin sees it.
// `#both` resolves to both-rsc.ts in the server graph and to both-ssr.ts in the SSR graph.
for (const [answer, onResolve] of [
  ["declines", `() => undefined`],
  ["answers with a path", `() => ({ path: path.join(import.meta.dirname, "shared.ts") })`],
]) {
  devTest(`onResolve that ${answer} keeps the graph of an import`, {
    framework: {
      ...minimalFramework,
      serverComponents: { ...minimalFramework.serverComponents!, separateSSRGraph: true },
    },
    pluginFile: `
      import * as path from 'path';
      export default [
        {
          name: 'a',
          setup(build) {
            const onResolve = ${onResolve};
            globalThis.resolved = [];
            build.onResolve({ filter: /shared/ }, (args) => {
              globalThis.resolved.push(args.path);
              return onResolve(args);
            });
          },
        }
      ];
    `,
    files: {
      "package.json": JSON.stringify({
        imports: { "#both": { "react-server": "./both-rsc.ts", "default": "./both-ssr.ts" } },
      }),
      "both-rsc.ts": `export const which = "rsc";`,
      "both-ssr.ts": `export const which = "ssr";`,
      "shared.ts": `export { which } from "#both";`,
      "routes/index.ts": `
        import { which as plain } from '../shared';
        import { which as ssr } from '../shared' with { bunBakeGraph: "ssr" };

        export default function (req, meta) {
          return Response.json({ plain, ssr, resolved: globalThis.resolved });
        }
      `,
    },
    async test(dev) {
      expect(await dev.fetch("/").json()).toEqual({ plain: "rsc", ssr: "ssr", resolved: ["../shared", "../shared"] });
    },
  });
}
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
