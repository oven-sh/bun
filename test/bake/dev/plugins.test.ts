// Plugin tests concern plugins in development mode.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";
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
devTest("onResolve that declines an html page's script keeps the page loading", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "decline",
        setup(build) {
          build.onResolve({ filter: /script\\.ts$/ }, () => undefined);
        },
      };
    `,
    "index.html": emptyHtmlFile({
      scripts: ["./script.ts"],
      body: "<h1>Hello</h1>",
    }),
    "script.ts": `
      console.log("hello");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("hello");
  },
});
devTest("onResolve that declines the built-in react refresh runtime keeps the page building", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "decline-everything",
        setup(build) {
          build.onResolve({ filter: /.*/ }, () => undefined);
        },
      };
    `,
    // react resolves and react-refresh does not, so the dev server serves its embedded runtime.
    "node_modules/react/package.json": `{ "name": "react", "version": "19.0.0", "main": "index.js" }`,
    "node_modules/react/index.js": `export default {};`,
    "node_modules/react/jsx-dev-runtime.js": `
      export const Fragment = Symbol.for("react.fragment");
      export function jsxDEV(type, props) {
        return { type, props };
      }
    `,
    "index.html": emptyHtmlFile({
      scripts: ["./app.tsx"],
    }),
    "app.tsx": `
      function App() {
        return <h1>hello</h1>;
      }
      console.log(App().type);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("h1");
  },
});
// A module becomes a stylesheet when onLoad says so, which is after its import was resolved.
// The page still gets the styles, whether an onResolve plugin named the module or declined it.
for (const onResolve of ["onResolve declines", "onResolve names the module"] as const) {
  devTest(`onLoad that makes a module a stylesheet (${onResolve})`, {
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./plugin.ts"]
      `,
      "plugin.ts": `
        export default {
          name: "styles",
          setup(build) {
            ${
              onResolve === "onResolve declines"
                ? `build.onResolve({ filter: /\\.styles$/ }, () => undefined);
                   build.onLoad({ filter: /\\.styles$/ }, () => ({ contents: "body { color: red; }", loader: "css" }));`
                : `build.onResolve({ filter: /^styles:/ }, args => ({ path: args.path.slice(7), namespace: "styles" }));
                   build.onLoad({ filter: /.*/, namespace: "styles" }, () => ({ contents: "body { color: red; }", loader: "css" }));`
            }
          },
        };
      `,
      "index.html": emptyHtmlFile({
        scripts: ["./script.ts"],
      }),
      "page.styles": `not a stylesheet until onLoad`,
      "script.ts": `
        import "${onResolve === "onResolve declines" ? "./page.styles" : "styles:page"}";
        console.log("script ran");
      `,
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("script ran");
      await c.style("body").color.expect.toBe("red");
    },
  });
}
// An onLoad plugin can make an HTML file a module. An import of the file that went to the
// onResolve plugins gets that module, whether a callback named the file or declined.
for (const onResolve of ["onResolve declines", "onResolve names the file"] as const) {
  devTest(`onLoad that makes an html file a module (${onResolve})`, {
    htmlFiles: ["index.html"],
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./plugin.ts"]
      `,
      "plugin.ts": `
        import * as path from "path";
        export default {
          name: "template",
          setup(build) {
            ${
              onResolve === "onResolve declines"
                ? `build.onResolve({ filter: /template\\.html$/ }, () => undefined);`
                : `build.onResolve({ filter: /^the:template$/ }, () => ({ path: path.join(import.meta.dirname, "template.html") }));`
            }
            build.onLoad({ filter: /template\\.html$/ }, () => ({
              contents: "export default 'template of the plugin';",
              loader: "js",
            }));
          },
        };
      `,
      "index.html": emptyHtmlFile({
        scripts: ["./script.ts"],
      }),
      "template.html": `<p>template</p>`,
      "script.ts": `
        import template from "${onResolve === "onResolve names the file" ? "the:template" : "./template.html"}";
        console.log(template);
      `,
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("template of the plugin");
    },
  });
}
// When the file is still HTML after the plugins, its import is the error that it is without
// plugins. An import that no onResolve plugin saw does not wait for onLoad: it is that error.
for (const [name, plugins] of [
  ["onResolve declines", `build.onResolve({ filter: /template\\.html$/ }, () => undefined);`],
  [
    "onResolve declines, onLoad returns nothing",
    `build.onResolve({ filter: /template\\.html$/ }, () => undefined);
     build.onLoad({ filter: /template\\.html$/ }, () => undefined);`,
  ],
  [
    "no onResolve, onLoad returns JavaScript",
    `build.onLoad({ filter: /template\\.html$/ }, () => ({ contents: "export default 1;", loader: "js" }));`,
  ],
] as const) {
  devTest(`html file that the plugins leave an html file (${name})`, {
    htmlFiles: ["index.html"],
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./plugin.ts"]
      `,
      "plugin.ts": `
        export default {
          name: "template",
          setup(build) {
            ${plugins}
          },
        };
      `,
      "index.html": emptyHtmlFile({
        scripts: ["./script.ts"],
      }),
      "template.html": `<p>template</p>`,
      "script.ts": `
        import template from "./template.html";
        console.log(template);
      `,
    },
    async test(dev) {
      await using c = await dev.client("/", {
        errors: ["script.ts:1:22: error: Browser builds cannot import HTML files."],
      });
    },
  });
}
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
  "an html import that waits for an onLoad in a virtual module": {
    importer: "ts",
    text: `import "NAME.ts";`,
    onLoad: `() => ({ contents: 'import "./declined.html";', loader: "ts" })`,
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
// A request for a route that has build errors bundles the route again, or answers from the recorded errors.
for (const [assumePerfectIncremental, onRequest] of [
  ["0", "bundles the route again"],
  ["1", "answers from the recorded errors"],
]) {
  devTest(`a page keeps reporting the build error of a module that is not a file (a request ${onRequest})`, {
    env: { BUN_ASSUME_PERFECT_INCREMENTAL: assumePerfectIncremental },
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./virtual-modules.ts"]
      `,
      // "same.*" keeps the import as written as its path. "alias.*" gets the path "other.*".
      // The plugin declines "./declined.*", so the resolver gets it after the plugins. The import of
      // "./declined.html" then waits for the onLoad of that file, which leaves the file an html file.
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
            build.onLoad({ filter: /declined\\.html$/ }, () => undefined);
          },
        };
      `,
      "imported.html": emptyHtmlFile({}),
      "declined.html": emptyHtmlFile({}),
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
}
// A framework route gets the module from the server graph. A client component with a separate SSR graph gets
// it from the SSR graph, where the key of the module has the prefix "ssr:".
for (const importer of ["the route", "a client component with a separate SSR graph"] as const) {
  devTest(`a framework route keeps reporting the build error of a virtual module (${importer} imports it)`, {
    framework: {
      ...minimalFramework,
      serverComponents: {
        ...minimalFramework.serverComponents!,
        separateSSRGraph: importer !== "the route",
      },
    },
    pluginFile: `
      import path from "node:path";
      export default [
        {
          name: "virtual-module-from-a-file",
          setup(build) {
            build.onResolve({ filter: /^same\\./ }, args => ({ path: args.path, namespace: "virtual" }));
            build.onLoad({ filter: /.*/, namespace: "virtual" }, async () => ({
              contents: await Bun.file(path.join(import.meta.dir, "virtual-module.txt")).text(),
              loader: "ts",
            }));
          },
        },
      ];
    `,
    files: {
      "virtual-module.txt": `export const value = ;`,
      "routes/index.ts": `
        import { value } from "${importer === "the route" ? "same.ts" : "../components/Comp"}";
        export default function (req, meta) {
          return new Response("value: " + typeof value);
        }
      `,
      "components/Comp.ts": `
        "use client";
        export { value } from "same.ts";
      `,
    },
    async test(dev) {
      // The status of the page, and the title of the page.
      const load = async () => {
        const page = await dev.fetch("/");
        return { status: page.status, title: (await page.text()).match(/<title>([^<]*)<\/title>/)?.[1] };
      };
      // previously: the second page was "Internal Server Error", because the server runtime did not find the module
      expect([await load(), await load()]).toEqual([
        { status: 500, title: "Bun - Build Failed" },
        { status: 500, title: "Bun - Build Failed" },
      ]);
      // The dev server does not know that the plugin reads this file. The save of the importer bundles the module again.
      await Bun.write(dev.join("virtual-module.txt"), `export const value = 42;`);
      await dev.writeNoChanges(importer === "the route" ? "routes/index.ts" : "components/Comp.ts");
      await dev.fetch("/").expect.toStartWith("value: ");
    },
  });
}
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
devTest("an error of an onResolve plugin for a saved file is an error of that file", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      import fs from "node:fs";
      import path from "node:path";
      export default {
        name: "refuses-a-marked-file",
        setup(build) {
          build.onResolve({ filter: /entry\\.ts$/ }, () => {
            if (fs.readFileSync(path.join(import.meta.dir, "entry.ts"), "utf8").includes("refuse")) {
              throw new Error("the plugin refuses this file");
            }
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["./entry.ts"] }),
    "entry.ts": `console.log("v1");`,
  },
  // A request answers from the recorded errors, and does not bundle the route again.
  env: { BUN_ASSUME_PERFECT_INCREMENTAL: "1" },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("v1");
    // The dev server resolves a saved file as an entry point: the file has no importer.
    await dev.write("entry.ts", `console.log("v2"); // refuse`, {
      errors: ["entry.ts: error: the plugin refuses this file"],
    });
    expect([(await dev.fetch("/")).status, (await dev.fetch("/")).status]).toEqual([500, 500]);
    await c.expectReload(async () => {
      await dev.write("entry.ts", `console.log("v3");`);
    });
    await c.expectMessage("v3");
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
    // The error names the module by its graph key.
    await using c = await dev.client("/same", {
      errors: ["virtual:same.css:1:27: error: Unexpected end of input"],
    });
    expect((await dev.fetch("/same")).status).toBe(500);
    // The dev server does not know that the plugin reads this file. The save of the importer bundles the
    // virtual stylesheet again. The open page has no error then, so it loads again.
    await c.expectReload(async () => {
      await using batch = await dev.batchChanges();
      await Bun.write(dev.join("virtual-stylesheet.txt"), `.virtual { width: 2px; }`);
      await dev.write("same-entry.css", `@import "same.css"; body { color: blue; }`);
    });
    await dev.output.waitForLine(/Reloaded in .*same-entry\.css/);
    await c.style(".virtual").width.expect.toBe("2px");
    await c.style("body").color.expect.toBe("#00f");
  },
});
// A plugin can give a module the path of a file that is a module too: "wrapped:real.ts" has the path of "real.ts".
const wrappedFiles = (onLoad: string) => ({
  "bunfig.toml": `
    [serve.static]
    plugins = ["./plugin.ts"]
  `,
  "plugin.ts": `
    import path from "node:path";
    export default {
      name: "wrapped",
      setup(build) {
        build.onResolve({ filter: /^wrapped:/ }, args => ({
          path: path.join(import.meta.dir, args.path.slice("wrapped:".length)),
          namespace: "wrapped",
        }));
        build.onLoad({ filter: /.*/, namespace: "wrapped" }, ${onLoad});
      },
    };
  `,
});
devTest("the build error of a plugin module is not an error of the file that has the same path", {
  files: {
    ...wrappedFiles(`() => ({ contents: "export const value = ;", loader: "ts" })`),
    "healthy.html": emptyHtmlFile({ scripts: ["./real.ts"] }),
    "broken.html": emptyHtmlFile({ scripts: ["./uses-wrapped.ts"] }),
    "uses-wrapped.ts": `import "wrapped:real.ts";`,
    "real.ts": `console.log("real");`,
  },
  // A request answers from the recorded errors, and does not bundle the route again.
  env: { BUN_ASSUME_PERFECT_INCREMENTAL: "1" },
  async test(dev) {
    const statuses = async () => ({
      healthy: (await dev.fetch("/healthy")).status,
      broken: (await dev.fetch("/broken")).status,
    });
    expect(await statuses()).toEqual({ healthy: 200, broken: 500 });
    // previously: { healthy: 500, broken: 200 }, because the error was filed on "real.ts"
    expect(await statuses()).toEqual({ healthy: 200, broken: 500 });
  },
});
devTest("an asset of a plugin and the file that has the same path are two assets", {
  files: {
    ...wrappedFiles(`() => ({ contents: "WRAPPED-BYTES", loader: "file" })`),
    "index.html": emptyHtmlFile({ scripts: ["./entry.ts"] }),
    "entry.ts": `
      import real from "./logo.png";
      import wrapped from "wrapped:logo.png";
      console.log(real, wrapped);
    `,
    "logo.png": `REAL-BYTES`,
  },
  async test(dev) {
    const html = await dev.fetch("/").text();
    const script = await dev.fetch(html.match(/\/_bun\/client\/[^"]+\.js/)![0]).text();
    const urls = [...new Set(script.match(/\/_bun\/asset\/[0-9a-f]+\.png/g))];
    // previously: the second asset took the place of the first, whose URL then answered 404
    expect((await Promise.all(urls.map(url => dev.fetch(url).text()))).sort()).toEqual(["REAL-BYTES", "WRAPPED-BYTES"]);
  },
});
devTest("a stylesheet of a plugin is not a script of the page when a script has the same path", {
  files: {
    ...wrappedFiles(`async () => ({
      contents: await Bun.file(path.join(import.meta.dir, "stylesheet.txt")).text(),
      loader: "css",
    })`),
    "linked.html": emptyHtmlFile({ styles: ["wrapped:real.ts"], scripts: ["./real.ts"] }),
    "other.html": emptyHtmlFile({ scripts: ["./other.ts"] }),
    "other.ts": `import "wrapped:real.ts";`,
    "real.ts": `console.log("real");`,
    "stylesheet.txt": `body { color: red; }}`,
  },
  async test(dev) {
    expect((await dev.fetch("/linked")).status).toBe(500);
    // The dev server does not know that the plugin reads this file. The other page bundles the stylesheet again.
    await Bun.write(dev.join("stylesheet.txt"), `body { color: red; }`);
    expect((await dev.fetch("/other")).status).toBe(200);
    // This page still has the html that was bundled with the error.
    await using c = await dev.client("/linked");
    await c.expectMessage("real");
    await c.style("body").color.expect.toBe("red");
  },
});
devTest("a module of a plugin namespace that does not load is a build error of that module", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "virtual-modules",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path.slice("virtual:".length), namespace: "virtual" }));
          build.onLoad({ filter: /^declined\\./, namespace: "virtual" }, () => undefined);
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["./entry.ts"] }),
    "entry.ts": `
      import "virtual:declined.ts";
      import "virtual:no-onload.ts";
    `,
  },
  async test(dev) {
    // previously: no build error. The browser threw: Failed to load bundled module 'virtual:declined.ts'.
    await using c = await dev.client("/", {
      errors: [
        `virtual:declined.ts: error: Module not found "virtual:declined.ts" in namespace "virtual"`,
        `virtual:no-onload.ts: error: File not found "no-onload.ts"`,
      ],
    });
  },
});
// The bundler has one place for an onLoad that returns nothing. `Bun.build` reports that error in its build log.
test("Bun.build fails when onLoad returns nothing for a module of its namespace", async () => {
  using dir = tempDir("plugin-onload-declines-namespace-module", {
    "entry.ts": `import value from "virtual-dep"; console.log(value);`,
  });
  const loads: string[] = [];
  const result = await Bun.build({
    entrypoints: [path.join(String(dir), "entry.ts")],
    throw: false,
    plugins: [
      {
        name: "declines",
        setup(build) {
          build.onResolve({ filter: /^virtual-dep$/ }, args => ({ path: args.path, namespace: "virtual" }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, args => {
            loads.push(args.path);
            return undefined;
          });
        },
      },
    ],
  });
  expect({
    success: result.success,
    logs: result.logs.map(log => `${log.level}: ${log.message}`),
    loads,
  }).toEqual({
    success: false,
    logs: ['error: Module not found "virtual:virtual-dep" in namespace "virtual"'],
    loads: ["virtual-dep"],
  });
});
devTest("a stylesheet of a plugin that moves from a script to an @import clears its build error", {
  files: {
    ...wrappedFiles(`async () => ({
      contents: await Bun.file(path.join(import.meta.dir, "stylesheet.txt")).text(),
      loader: "css",
    })`),
    "index.html": emptyHtmlFile({ styles: ["./entry.css"], scripts: ["./entry.ts"] }),
    "entry.ts": `import "wrapped:styles.css";`,
    "entry.css": `.entry { width: 1px; }`,
    "stylesheet.txt": `.wrapped { width: 1px; }`,
  },
  async test(dev) {
    // The status of the page, and the width that its stylesheets give to ".wrapped".
    const load = async () => {
      const page = await dev.fetch("/");
      const hrefs = Array.from(
        (await page.text()).matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g),
        match => match[1],
      );
      const stylesheets = await Promise.all(hrefs.map(href => dev.fetch(href).text()));
      return { status: page.status, width: stylesheets.join("\n").match(/\.wrapped\s*\{\s*width:\s*(\w+)/)?.[1] };
    };
    expect(await load()).toEqual({ status: 200, width: "1px" });
    {
      // The stylesheet had a chunk of its own for the script. From here on it is a part of the chunk of "entry.css".
      await using batch = await dev.batchChanges();
      await dev.write("entry.ts", `console.log("no import");`);
      await dev.write("entry.css", `@import "wrapped:styles.css";\n.entry { width: 2px; }`);
    }
    expect(await load()).toEqual({ status: 200, width: "1px" });
    // The dev server does not know that the plugin reads this file. The save of the importer bundles the stylesheet again.
    await Bun.write(dev.join("stylesheet.txt"), `.wrapped { width: 3px; }}`);
    await dev.write("entry.css", `@import "wrapped:styles.css";\n.entry { width: 3px; }`, { errors: null });
    expect([await load(), await load()]).toEqual([
      { status: 500, width: undefined },
      { status: 500, width: undefined },
    ]);
    // No script imports the stylesheet now, so it needs no chunk of its own: the bundle of "entry.css" clears the error.
    await Bun.write(dev.join("stylesheet.txt"), `.wrapped { width: 4px; }`);
    await dev.write("entry.css", `@import "wrapped:styles.css";\n.entry { width: 4px; }`, { errors: null });
    expect(await load()).toEqual({ status: 200, width: "4px" });
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
