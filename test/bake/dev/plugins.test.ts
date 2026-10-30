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
// A module in a plugin namespace, or a `data:` import, is not a file. Each case has a build error in such a
// module: the importer that the page uses, the `onLoad` of the module, and the error. In the importer, NAME is
// "same.N" or "alias.N" for case N. The `onLoad` gets the module path, which starts with "same.N." or "other.N.".
const notAFileErrors: Record<
  string,
  { importer: "ts" | "css" | "html"; text: string; onLoad?: string; error: RegExp }
> = {
  "a syntax error in a virtual module": {
    importer: "ts",
    text: `import "NAME.ts";`,
    onLoad: `() => ({ contents: "export const value = ;", loader: "ts" })`,
    error: /Unexpected ;/,
  },
  "an import that does not resolve in a virtual module": {
    importer: "ts",
    text: `import "NAME.ts";`,
    onLoad: `() => ({ contents: 'import "./missing.ts";', loader: "ts" })`,
    error: /Could not resolve: "\.\/missing\.ts"/,
  },
  "a plugin error for an import in a virtual module": {
    importer: "ts",
    text: `import "NAME.ts";`,
    onLoad: `() => ({ contents: 'import "./throws.ts";', loader: "ts" })`,
    error: /the plugin throws for this import/,
  },
  "an html import in a virtual module": {
    importer: "ts",
    text: `import "NAME.ts";`,
    onLoad: `() => ({ contents: 'import "./imported.html";', loader: "ts" })`,
    error: /Browser builds cannot import HTML files/,
  },
  "a bunBakeGraph import in a virtual module": {
    importer: "ts",
    text: `import "NAME.ts";`,
    onLoad: `() => ({ contents: 'import value from "./dep.ts" with { bunBakeGraph: "ssr" }; console.log(value);', loader: "ts" })`,
    error: /Framework does not have a separate SSR graph/,
  },
  "a syntax error in a virtual stylesheet": {
    importer: "css",
    text: `@import "NAME.css";`,
    onLoad: `() => ({ contents: ".virtual { width: 1px; }}}", loader: "css" })`,
    error: /Unexpected end of input/,
  },
  "a syntax error in a virtual stylesheet that a script imports": {
    importer: "ts",
    text: `import "NAME.css";`,
    onLoad: `() => ({ contents: ".virtual { width: 1px; }}}", loader: "css" })`,
    error: /Unexpected end of input/,
  },
  "a syntax error in a virtual stylesheet that the html file links": {
    importer: "html",
    text: emptyHtmlFile({ styles: ["NAME.css"] }),
    onLoad: `() => ({ contents: ".virtual { width: 1px; }}}", loader: "css" })`,
    error: /Unexpected end of input/,
  },
  "a url() that does not resolve in a virtual stylesheet": {
    importer: "css",
    text: `@import "NAME.css";`,
    onLoad: `() => ({ contents: '.virtual { background: url("./missing.png"); }', loader: "css" })`,
    error: /Could not resolve: "\.\/missing\.png"/,
  },
  "a declined url() that does not resolve in a virtual stylesheet": {
    importer: "css",
    text: `@import "NAME.css";`,
    onLoad: `() => ({ contents: '.virtual { background: url("./declined.png"); }', loader: "css" })`,
    error: /Could not resolve: "\.\/declined\.png"/,
  },
  "a script import in a virtual stylesheet": {
    importer: "css",
    text: `@import "NAME.css";`,
    onLoad: `args => args.path.endsWith(".ts") ? { contents: "export {};", loader: "ts" } : { contents: '@import "' + args.path.replace(/^other/, "alias").replace(/css$/, "ts") + '";', loader: "css" }`,
    error: /Cannot import a "\.ts" file into a CSS file/,
  },
  "a syntax error in a virtual file that a stylesheet uses": {
    importer: "css",
    text: `.entry { background: url("NAME.toml"); }`,
    onLoad: `() => ({ contents: "key = ", loader: "toml" })`,
    error: /Missing value after '='/,
  },
  "an onLoad that throws for a virtual stylesheet": {
    importer: "css",
    text: `@import "NAME.css";`,
    onLoad: `() => { throw new Error("onLoad throws for this module"); }`,
    error: /onLoad throws for this module/,
  },
  "an onLoad that declines a virtual stylesheet": {
    importer: "css",
    text: `@import "NAME.css";`,
    onLoad: `() => undefined`,
    error: /Module not found "virtual:same\.\d+\.css" in namespace "virtual"/,
  },
  "a virtual stylesheet that no onLoad takes": {
    importer: "css",
    text: `@import "NAME.unloaded.css";`,
    error: /File not found "same\.\d+\.unloaded\.css"/,
  },
  "a syntax error in a data: stylesheet": {
    importer: "css",
    text: `@import "data:text/css,.data { width: 1px; }}}";`,
    error: /Unexpected end of input/,
  },
  "a syntax error in a data: script": {
    importer: "ts",
    text: `import "data:text/javascript,export const value = ;";`,
    error: /Unexpected ;/,
  },
};
devTest("a page keeps reporting the build error of a module that is not a file", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./virtual-modules.ts"]
    `,
    // "same.*" keeps the import as written as its path. "alias.*" gets the path "other.*".
    // The plugin declines "./declined.*", so the resolver gets it after the plugins.
    "virtual-modules.ts": `
      const onLoad = [${Object.values(notAFileErrors)
        .map(({ onLoad }) => onLoad ?? "undefined")
        .join(", ")}];
      export default {
        name: "virtual-modules",
        setup(build) {
          build.onResolve({ filter: /^same\\./ }, args => ({ path: args.path, namespace: "virtual" }));
          build.onResolve({ filter: /^alias\\./ }, args => ({ path: args.path.replace("alias", "other"), namespace: "virtual" }));
          build.onResolve({ filter: /^\\.\\/declined\\./ }, () => undefined);
          build.onResolve({ filter: /^\\.\\/throws\\./ }, () => {
            throw new Error("the plugin throws for this import");
          });
          build.onLoad({ filter: /^(same|other)\\.\\d+\\.[a-z]+$/, namespace: "virtual" }, args => onLoad[args.path.split(".")[1]](args));
        },
      };
    `,
    "imported.html": emptyHtmlFile({}),
    "dep.ts": `export default "dep";`,
    ...Object.fromEntries(
      Object.values(notAFileErrors).flatMap(({ importer, text }, n) =>
        ["same", "alias"].flatMap(name => {
          const importerText = text.replace("NAME", `${name}.${n}`);
          if (importer === "html") return [[`${name}-${n}.html`, importerText]];
          return [
            [
              `${name}-${n}.html`,
              emptyHtmlFile({ [importer === "css" ? "styles" : "scripts"]: [`${name}-${n}.${importer}`] }),
            ],
            [`${name}-${n}.${importer}`, importerText],
          ];
        }),
      ),
    ),
  },
  async test(dev) {
    // The first response reports the errors of its own build. The second one has to find them from the page.
    const statusOfTwoLoads = async (url: string) => [(await dev.fetch(url)).status, (await dev.fetch(url)).status];
    const statuses: Record<string, { same: number[]; alias: number[] }> = {};
    for (const [n, name] of Object.keys(notAFileErrors).entries()) {
      statuses[name] = { same: await statusOfTwoLoads(`/same-${n}`), alias: await statusOfTwoLoads(`/alias-${n}`) };
    }
    expect(statuses).toEqual(
      Object.fromEntries(Object.keys(notAFileErrors).map(name => [name, { same: [500, 500], alias: [500, 500] }])),
    );
    for (const { error } of Object.values(notAFileErrors)) {
      await dev.output.waitForLine(error);
    }
  },
});
devTest("an error of an onResolve plugin for the html file of a route is an error of that file", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "throws-for-entry-point",
        setup(build) {
          build.onResolve({ filter: /guarded\\.html$/ }, () => {
            throw new Error("the plugin throws for this entry point");
          });
        },
      };
    `,
    "guarded.html": emptyHtmlFile({}),
  },
  async test(dev) {
    // previously: the error had no file, and the page had a second error: "did not produce an html page"
    await using c = await dev.client("/guarded", {
      errors: ["guarded.html: error: the plugin throws for this entry point"],
    });
  },
});
devTest("a page loads again after the build error of a virtual stylesheet is fixed", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      import path from "node:path";
      export default {
        name: "virtual-stylesheet-from-a-file",
        setup(build) {
          build.onResolve({ filter: /^same\\./ }, args => ({ path: args.path, namespace: "virtual" }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, async () => ({
            contents: await Bun.file(path.join(import.meta.dir, "virtual-stylesheet.txt")).text(),
            loader: "css",
          }));
        },
      };
    `,
    "same.html": emptyHtmlFile({ styles: ["same-entry.css"] }),
    "same-entry.css": `
      @import "same.css";
    `,
    "virtual-stylesheet.txt": `.virtual { width: 1px; }}}`,
  },
  async test(dev) {
    {
      // The error names the module by its graph key.
      await using c = await dev.client("/same", {
        errors: ["virtual:same.css:1:27: error: Unexpected end of input"],
      });
    }
    expect((await dev.fetch("/same")).status).toBe(500);
    // No watcher reports this file. The save of the importer bundles the virtual stylesheet again.
    await Bun.write(dev.join("virtual-stylesheet.txt"), `.virtual { width: 2px; }`);
    await dev.write("same-entry.css", `@import "same.css"; body { color: blue; }`);
    await dev.output.waitForLine(/Reloaded in .*same-entry\.css/);
    const response = await dev.fetch("/same");
    expect(response.status).toBe(200);
    const href = (await response.text()).match(/<link rel="stylesheet"[^>]*href="([^"]+)"/)![1];
    expect(await dev.fetch(href).text()).toContain(".virtual");
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
