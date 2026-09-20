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

// The router gives the bundler the real path of a route file, so that is the
// path an onResolve or onLoad filter sees for a route behind a symlink.
devTest("onResolve that returns args.path for a route below a symlinked directory", {
  files: {
    "bun.app.ts": `
      import { symlinkSync } from "node:fs";
      import { join } from "node:path";
      const root = import.meta.dir;
      symlinkSync(join(root, "routes/real"), join(root, "routes/linked"), "junction");
      const plugin = {
        name: "identity",
        setup(build) {
          build.onResolve({ filter: /routes[\\\\/].*\\.ts$/ }, args => ({ path: args.path }));
        },
      };
      export default { app: { framework: ${JSON.stringify(minimalFramework)}, plugins: [plugin] } };
    `,
    "routes/real/a.ts": `export default () => new Response("a");`,
  },
  async test(dev) {
    await dev.fetch("/real/a").equals("a");
    await dev.fetch("/linked/a").equals("a");
  },
});
devTest("plugin filters match the real path of a symlinked route file", {
  files: {
    "bun.app.ts": `
      import { symlinkSync } from "node:fs";
      import { join } from "node:path";
      const root = import.meta.dir;
      symlinkSync(join(root, "content/hello.md"), join(root, "routes/hello.page"));
      const plugin = {
        name: "markdown pages",
        setup(build) {
          build.onResolve({ filter: /\\.md$/ }, args => ({ path: args.path }));
          build.onLoad({ filter: /\\.md$/ }, async args => ({
            contents: "export default () => new Response(" + JSON.stringify(await Bun.file(args.path).text()) + ");",
            loader: "ts",
          }));
        },
      };
      const framework = ${JSON.stringify({
        ...minimalFramework,
        fileSystemRouterTypes: [{ ...minimalFramework.fileSystemRouterTypes![0], extensions: [".page"] }],
      })};
      export default { app: { framework, plugins: [plugin] } };
    `,
    "routes/keep.txt": "the routes directory has to exist before the link is made",
    "content/hello.md": "# hello",
  },
  async test(dev) {
    await dev.fetch("/hello").equals("# hello");
  },
});
