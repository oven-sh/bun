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
// A module in a plugin namespace is not a file. Each case has a build error in such a module: the entry file
// of the page that imports it (NAME is "same" or "alias"), the `onLoad` of the module, and the error.
const virtualModuleErrors = {
  "a syntax error in a virtual module": {
    extension: "ts",
    entry: `import "NAME.ts";`,
    onLoad: `() => ({ contents: "export const value = ;", loader: "ts" })`,
    message: /Unexpected ;/,
  },
  "an import that does not resolve in a virtual module": {
    extension: "ts",
    entry: `import "NAME.ts";`,
    onLoad: `() => ({ contents: 'import "./missing.ts";', loader: "ts" })`,
    message: /Could not resolve: "\.\/missing\.ts"/,
  },
  "a plugin error for an import in a virtual module": {
    extension: "ts",
    entry: `import "NAME.ts";`,
    onLoad: `() => ({ contents: 'import "./throws.ts";', loader: "ts" })`,
    message: /the plugin throws for this import/,
  },
  "a syntax error in a virtual stylesheet": {
    extension: "css",
    entry: `@import "NAME.css";`,
    onLoad: `() => ({ contents: ".virtual { width: 1px; }}}", loader: "css" })`,
    message: /Unexpected end of input/,
  },
  "a url() that does not resolve in a virtual stylesheet": {
    extension: "css",
    entry: `@import "NAME.css";`,
    onLoad: `() => ({ contents: '.virtual { background: url("./missing.png"); }', loader: "css" })`,
    message: /Could not resolve: "\.\/missing\.png"/,
  },
  "a declined url() that does not resolve in a virtual stylesheet": {
    extension: "css",
    entry: `@import "NAME.css";`,
    onLoad: `() => ({ contents: '.virtual { background: url("./declined.png"); }', loader: "css" })`,
    message: /Could not resolve: "\.\/declined\.png"/,
  },
  "a script import in a virtual stylesheet": {
    extension: "css",
    entry: `@import "NAME.css";`,
    onLoad: `args => args.path.endsWith(".ts") ? { contents: "export {};", loader: "ts" } : { contents: '@import "same.ts";', loader: "css" }`,
    message: /Cannot import a "\.ts" file into a CSS file/,
  },
  "a syntax error in a virtual file that a stylesheet uses": {
    extension: "css",
    entry: `.entry { background: url("NAME.toml"); }`,
    onLoad: `() => ({ contents: "key = ", loader: "toml" })`,
    message: /Missing value after '='/,
  },
};
for (const [error, { extension, entry, onLoad, message }] of Object.entries(virtualModuleErrors)) {
  const page = (name: string) => ({
    [`${name}.html`]: emptyHtmlFile(
      extension === "css" ? { styles: [`${name}-entry.css`] } : { scripts: [`${name}-entry.ts`] },
    ),
    [`${name}-entry.${extension}`]: entry.replace("NAME", name),
  });
  devTest(`a page keeps reporting ${error}`, {
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./virtual-modules.ts"]
      `,
      // "same.*" keeps the import as written as its path. "alias.*" gets the path "other.*".
      // The plugin declines "./declined.*", so the resolver gets it after the plugins.
      "virtual-modules.ts": `
        export default {
          name: "virtual-modules",
          setup(build) {
            build.onResolve({ filter: /^same\\./ }, args => ({ path: args.path, namespace: "virtual" }));
            build.onResolve({ filter: /^alias\\./ }, args => ({ path: args.path.replace("alias", "other"), namespace: "virtual" }));
            build.onResolve({ filter: /^\\.\\/declined\\./ }, () => undefined);
            build.onResolve({ filter: /^\\.\\/throws\\./ }, () => {
              throw new Error("the plugin throws for this import");
            });
            build.onLoad({ filter: /.*/, namespace: "virtual" }, ${onLoad});
          },
        };
      `,
      ...page("same"),
      ...page("alias"),
    },
    async test(dev) {
      // The first response reports the errors of its own build. The second one has to find them from the page.
      const statusOfTwoLoads = async (url: string) => [(await dev.fetch(url)).status, (await dev.fetch(url)).status];
      expect({
        same: await statusOfTwoLoads("/same"),
        alias: await statusOfTwoLoads("/alias"),
      }).toEqual({ same: [500, 500], alias: [500, 500] });
      await dev.output.waitForLine(message);
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
