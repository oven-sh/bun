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
// `loader: "object"`: each own key of `exports` is one export of the module, so a `default` key
// is the default export. A key named `__proto__` stays an own key, in the data and in the exports.
const objectLoaderData = `{"default":"DEF","named":"NAMED","not-an-identifier":"X","__proto__":{"admin":true},"user":{"__proto__":{"admin":true},"name":"n"}}`;
devTest("onLoad with loader object", {
  framework: minimalFramework,
  pluginFile: `
    import { readFileSync } from 'fs';
    export default [
      {
        name: 'a',
        setup(build) {
          build.onLoad({ filter: /\\.data$/ }, (args) => {
            return { exports: JSON.parse(readFileSync(args.path, 'utf8')), loader: 'object' };
          });
        },
      }
    ];
  `,
  files: {
    "settings.data": objectLoaderData,
    "routes/index.ts": `
      import d, { named, "not-an-identifier" as notId, user } from '../settings.data';
      import * as ns from '../settings.data';

      export default function (req, meta) {
        return Response.json({
          d,
          named,
          notId,
          user: { keys: Object.keys(user), admin: user.admin === true },
          ns: { keys: Object.keys(ns).sort(), admin: ns.admin === true },
        });
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals({
      d: "DEF",
      named: "NAMED",
      notId: "X",
      user: { keys: ["__proto__", "name"], admin: false },
      ns: { keys: ["__proto__", "default", "named", "not-an-identifier", "user"], admin: false },
    });
    // Without a `default` key the whole object is the default export.
    await dev.write("settings.data", `{"named":"NAMED2","not-an-identifier":"X2","user":{"name":"n2"}}`);
    await dev.fetch("/").equals({
      d: { named: "NAMED2", "not-an-identifier": "X2", user: { name: "n2" } },
      named: "NAMED2",
      notId: "X2",
      user: { keys: ["name"], admin: false },
      ns: { keys: ["default", "named", "not-an-identifier", "user"], admin: false },
    });
    await dev.write("settings.data", objectLoaderData.replace("DEF", "DEF3"));
    await dev.fetch("/").equals({
      d: "DEF3",
      named: "NAMED",
      notId: "X",
      user: { keys: ["__proto__", "name"], admin: false },
      ns: { keys: ["__proto__", "default", "named", "not-an-identifier", "user"], admin: false },
    });
  },
});
devTest("onLoad with loader object in the browser", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      import { readFileSync } from 'fs';
      export default {
        name: 'a',
        setup(build) {
          build.onLoad({ filter: /\\.data$/ }, (args) => {
            return { exports: JSON.parse(readFileSync(args.path, 'utf8')), loader: 'object' };
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "settings.data": objectLoaderData,
    "index.ts": `
      import d, { named, "not-an-identifier" as notId, user } from './settings.data';
      import * as ns from './settings.data';

      console.log(JSON.stringify({
        d,
        named,
        notId,
        user: { keys: Object.keys(user), admin: user.admin === true },
        ns: { keys: Object.keys(ns).sort(), admin: ns.admin === true },
      }));
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    const expected = (d: string) =>
      JSON.stringify({
        d,
        named: "NAMED",
        notId: "X",
        user: { keys: ["__proto__", "name"], admin: false },
        ns: { keys: ["__proto__", "default", "named", "not-an-identifier", "user"], admin: false },
      });
    await c.expectMessage(expected("DEF"));
    // index.ts does not accept the update, so the page reloads with the new module.
    await c.expectReload(async () => {
      await dev.write("settings.data", objectLoaderData.replace("DEF", "DEF2"));
    });
    await c.expectMessage(expected("DEF2"));
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
