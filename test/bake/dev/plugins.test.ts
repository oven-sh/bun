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
// An onResolve answer puts a module in a plugin namespace, and the onLoad registered for that
// namespace answers nothing. Nothing else can load such a module, so this is the same kind of
// failure as an onLoad callback that throws: the routes importing the module must fail instead
// of being served with an import that has no module behind it.
const decliningOnLoadPlugin = /* ts */ `
  {
    name: "declining-onload",
    setup(build) {
      build.onResolve({ filter: /^virtual-config$/ }, () => ({ path: "config.ts", namespace: "virtual" }));
      build.onLoad({ filter: /.*/, namespace: "virtual" }, () => undefined);
    },
  }
`;
const decliningOnLoadError = 'virtual:config.ts: error: Module not found "virtual:config.ts" in namespace "virtual"';
devTest("onLoad that does not answer for a module outside the file namespace fails the html route", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `export default ${decliningOnLoadPlugin};`,
    "index.html": emptyHtmlFile({ scripts: ["entry.ts"] }),
    "entry.ts": `
      import "virtual-config";
      console.log("entry ran");
    `,
  },
  async test(dev) {
    {
      await using _ = await dev.client("/", { errors: [decliningOnLoadError] });
    }
    // The failure is recorded against the module itself, which the route imports, so the route
    // keeps failing when it is requested again rather than being served from the graph.
    expect((await dev.fetch("/")).status).toBe(500);
  },
});
devTest("onLoad that does not answer for a module outside the file namespace fails the server route", {
  framework: minimalFramework,
  pluginFile: `export default [${decliningOnLoadPlugin}];`,
  files: {
    "routes/index.ts": `
      import "virtual-config";

      export default function (req, meta) {
        return new Response("route ran");
      }
    `,
  },
  async test(dev) {
    for (let i = 0; i < 2; i++) {
      const res = await dev.fetch("/");
      expect(await res.text()).toContain("Build Failed");
      expect(res.status).toBe(500);
    }
    await dev.output.waitForLine(/Module not found "virtual:config.ts" in namespace "virtual"/);
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
