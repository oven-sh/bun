// Plugin tests concern plugins in development mode.
import { expect } from "bun:test";
import { Dev, devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

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

// A module that the incremental graph already holds is bundled again when an
// importer changes (the bundler cannot tell that a plugin-loaded module is
// fresh). When its output is the same, a page that has it leaves it as it is,
// whether the resolver or a plugin resolved it.
// https://github.com/oven-sh/bun/issues/47398
const sharedModuleFiles = {
  "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
  // `someGlobalName` is a global here and a local in the shared module. A
  // module's names must not change with the other modules in the bundle.
  "index.ts": `
    import "./foo.ts";
    import { registerComponent } from "SHARED";
    registerComponent();
    void typeof someGlobalName;
    console.log("index loaded");
    import.meta.hot.accept(() => { console.log("accept index.ts"); });
  `,
  "foo.ts": `
    import { registerComponent } from "SHARED";
    registerComponent();
    console.log("foo loaded 1");
    import.meta.hot.accept(() => { console.log("accept foo.ts"); });
  `,
};
function withShared(specifier: string) {
  return Object.fromEntries(Object.entries(sharedModuleFiles).map(([k, v]) => [k, v.replaceAll("SHARED", specifier)]));
}
/** The modules that a hot update holds. */
const hmrChunkKeys = (chunk: string) =>
  [...chunk.matchAll(/^  ("(?:[^"\\]|\\.)*")(?:: \[|\()/gm)].map(m => JSON.parse(m[1]) as string);
/** Those that were not saved: a page that has the same code of one leaves it as it is. */
const bundledAgain = (chunk: string): string[] => JSON.parse(chunk.match(/^\}, (\[.*\]), "[0-9a-f]{16}"\)$/m)![1]);
const savedKeys = (chunk: string) => {
  const again = bundledAgain(chunk);
  return hmrChunkKeys(chunk).filter(key => !again.includes(key));
};
async function expectOnlyFooInHotUpdate(dev: Dev, again: string[]) {
  await using c = await dev.client("/", { storeHotChunks: true });
  await c.expectMessage("shared evaluated", "foo loaded 1", "index loaded");
  await dev.patch("foo.ts", { find: "foo loaded 1", replace: "foo loaded 2" });
  await c.expectMessage("foo loaded 2", "accept foo.ts");
  const chunk = await c.getMostRecentHmrChunk();
  expect({ saved: savedKeys(chunk), again: bundledAgain(chunk) }).toEqual({ saved: ["foo.ts"], again });
}
devTest("virtual module shared by two importers does not run again when one importer changes", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "virtual",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => {
            return { path: args.path.slice("virtual:".length), namespace: "virtual" };
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => {
            return {
              contents: "const someGlobalName = 1; console.log('shared evaluated'); export function registerComponent() { return someGlobalName; }",
              loader: "js",
            };
          });
        },
      };
    `,
    ...withShared("virtual:__foo__"),
  },
  async test(dev) {
    await expectOnlyFooInHotUpdate(dev, ["virtual:__foo__"]);
  },
});
// The module and what it imports have the same output, but the page never loaded them.
devTest("virtual module that a page imports for the first time is in the hot update", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "virtual",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => {
            return { path: args.path.slice("virtual:".length), namespace: "virtual" };
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, args => {
            return {
              contents:
                args.path === "one"
                  ? 'import { two } from "virtual:two"; export const one = "one " + two;'
                  : 'export const two = "two";',
              loader: "js",
            };
          });
        },
      };
    `,
    "a.html": emptyHtmlFile({ scripts: ["a.ts"] }),
    "a.ts": `
      console.log("a");
      import.meta.hot.accept();
    `,
    "b.html": emptyHtmlFile({ scripts: ["b.ts"] }),
    "b.ts": `
      import { one } from "virtual:one";
      console.log("b " + one);
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await dev.fetch("/a").expect.toInclude("script");
    {
      await using b = await dev.client("/b");
      await b.expectMessage("b one two");
    }
    await using a = await dev.client("/a");
    await a.expectMessage("a");
    // dev.write() throws when the page reloads.
    await dev.write(
      "a.ts",
      `
        import { one } from "virtual:one";
        console.log("a " + one);
        import.meta.hot.accept();
      `,
    );
    await a.expectMessage("a one two");
  },
});
// The same, through a file that is new to the dev server.
devTest("virtual module that a new file imports is in the hot update", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "virtual",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => {
            return { path: args.path.slice("virtual:".length), namespace: "virtual" };
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, args => {
            return { contents: "export const name = " + JSON.stringify(args.path) + ";", loader: "js" };
          });
        },
      };
    `,
    "a.html": emptyHtmlFile({ scripts: ["a.ts"] }),
    "a.ts": `
      console.log("a");
      import.meta.hot.accept();
    `,
    "b.html": emptyHtmlFile({ scripts: ["b.ts"] }),
    "b.ts": `
      import { name } from "virtual:only-b";
      console.log("b " + name);
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await dev.fetch("/a").expect.toInclude("script");
    {
      await using b = await dev.client("/b");
      await b.expectMessage("b only-b");
    }
    await using a = await dev.client("/a");
    await a.expectMessage("a");
    // The batch throws when the page reloads.
    {
      await using _batch = await dev.batchChanges();
      await dev.write("fresh.ts", `import { name } from "virtual:only-b"; export const fresh = "fresh " + name;`);
      await dev.write(
        "a.ts",
        `
          import { fresh } from "./fresh.ts";
          console.log("a " + fresh);
          import.meta.hot.accept();
        `,
      );
    }
    await a.expectMessage("a fresh only-b");
  },
});
devTest("virtual json module shared by two importers does not run again when one importer changes", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "virtual-json",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => {
            return { path: args.path.slice("virtual:".length), namespace: "virtual" };
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => {
            return { contents: '{ "name": "shared" }', loader: "json" };
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./foo.ts";
      import data from "virtual:__foo__";
      console.log("index " + data.name);
      import.meta.hot.accept(() => { console.log("accept index.ts"); });
    `,
    "foo.ts": `
      import data from "virtual:__foo__";
      console.log("foo 1 " + data.name);
      import.meta.hot.accept(() => { console.log("accept foo.ts"); });
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("foo 1 shared", "index shared");
    await dev.patch("foo.ts", { find: "foo 1", replace: "foo 2" });
    await c.expectMessage("foo 2 shared", "accept foo.ts");
    const chunk = await c.getMostRecentHmrChunk();
    expect(savedKeys(chunk)).toEqual(["foo.ts"]);
    expect(bundledAgain(chunk)).toEqual(["virtual:__foo__"]);
  },
});
devTest(
  "disk module matched by an onResolve filter that returns nothing does not run again when one importer changes",
  {
    files: {
      "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
      "plugin.ts": `
      export default {
        name: "noop",
        setup(build) {
          build.onResolve({ filter: /bar/ }, () => undefined);
        },
      };
    `,
      "bar.ts": `
      console.log("shared evaluated");
      export function registerComponent() {}
    `,
      ...withShared("./bar.ts"),
    },
    async test(dev) {
      // As with no plugin, it is not bundled again.
      await expectOnlyFooInHotUpdate(dev, []);
    },
  },
);

// A package behind an onResolve filter is bundled again with each importer.
// When it ran again, the page had two copies of its runtime.
for (const [kind, packageFiles] of [
  [
    "CommonJS",
    {
      "node_modules/fakeui/package.json": `{"name":"fakeui","version":"1.0.0","main":"index.js"}`,
      "node_modules/fakeui/index.js": `const inner = require("./inner.js"); globalThis.uiRuns = (globalThis.uiRuns ?? 0) + 1; exports.createElement = function createElement() { return inner.tag; };`,
      "node_modules/fakeui/inner.js": `exports.tag = "x";`,
    },
  ],
  [
    "ES module",
    {
      "node_modules/fakeui/package.json": `{"name":"fakeui","version":"1.0.0","type":"module","main":"index.js"}`,
      "node_modules/fakeui/index.js": `import { tag } from "./inner.js"; globalThis.uiRuns = (globalThis.uiRuns ?? 0) + 1; export function createElement() { return tag; }`,
      "node_modules/fakeui/inner.js": `export const tag = "x";`,
    },
  ],
] as const) {
  devTest(`${kind} package matched by an onResolve filter does not run again when one importer changes`, {
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./plugin.ts"]
      `,
      "plugin.ts": `
        export default {
          name: "bare",
          setup(build) {
            build.onResolve({ filter: /^fakeui$/ }, () => undefined);
          },
        };
      `,
      "index.html": emptyHtmlFile({ scripts: ["main.ts"] }),
      "main.ts": `
        import { createElement } from "fakeui";
        import { a } from "./a.ts";
        (globalThis.uis ??= new Set()).add(createElement);
        globalThis.read = () => a + " copies=" + globalThis.uis.size + " runs=" + globalThis.uiRuns;
        console.log("main");
        import.meta.hot.accept();
      `,
      "a.ts": `
        import { createElement } from "fakeui";
        (globalThis.uis ??= new Set()).add(createElement);
        export const a = "a1";
        import.meta.hot.accept();
      `,
      ...packageFiles,
    },
    async test(dev) {
      await using c = await dev.client("/", { storeHotChunks: true });
      await c.expectMessage("main");
      expect(await c.js<string>`read()`).toBe("a1 copies=1 runs=1");
      await dev.patch("a.ts", { find: "a1", replace: "a2" });
      const chunk = await c.getMostRecentHmrChunk();
      expect(savedKeys(chunk)).toEqual(["a.ts"]);
      expect(await c.js<string>`read()`).toBe("a2 copies=1 runs=1");
    },
  });
}

// bun-plugin-svelte regenerates a path-stable virtual module from the
// importer's onLoad. A change in that module must still reach the client.
devTest("virtual module regenerated by the importer's onLoad is sent when its content changes", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      let generated = "";
      export default {
        name: "regen",
        setup(build) {
          build.onLoad({ filter: /comp\\.txt$/ }, async args => {
            generated = (await Bun.file(args.path).text()).trim();
            return { contents: 'import "virtual:gen"; import.meta.hot.accept();', loader: "js" };
          });
          build.onResolve({ filter: /^virtual:gen$/ }, () => ({ path: "gen", namespace: "virtual" }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
            contents: "console.log('gen=" + generated + "');",
            loader: "js",
          }));
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./comp.txt";
    `,
    "comp.txt": "one",
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("gen=one");
    await dev.write("comp.txt", "two");
    await c.expectMessage("gen=two");
  },
});
devTest("virtual css regenerated by the importer's onLoad is applied when its content changes", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      let color = "";
      export default {
        name: "regen-css",
        setup(build) {
          build.onLoad({ filter: /comp\\.txt$/ }, async args => {
            color = (await Bun.file(args.path).text()).trim();
            return { contents: 'import "vcss:comp.css"; import.meta.hot.accept();', loader: "js" };
          });
          build.onResolve({ filter: /^vcss:/ }, args => ({ path: args.path, namespace: "vcss" }));
          build.onLoad({ filter: /\\.css$/, namespace: "vcss" }, () => ({
            contents: "h1 { color: " + color + "; }",
            loader: "css",
          }));
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"], body: "<h1>hello</h1>" }),
    "index.ts": `
      import "./comp.txt";
    `,
    "comp.txt": "red",
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style("h1").color.expect.toBe("red");
    await dev.write("comp.txt", "blue");
    await c.style("h1").color.expect.toBe("#00f");
  },
});

// A client root has no importer in the browser graph, and this one had no imports either.
devTest("virtual module that a client component without imports starts to import is in the hot update", {
  framework: {
    fileSystemRouterTypes: [{ ...minimalFramework.fileSystemRouterTypes![0], clientEntryPoint: "./client.ts" }],
    serverComponents: { ...minimalFramework.serverComponents!, separateSSRGraph: false },
  },
  pluginFile: `
    export default [
      {
        name: "virtual",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => {
            return { path: args.path.slice("virtual:".length), namespace: "virtual" };
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => {
            return { contents: "export const one = 1;", loader: "js" };
          });
        },
      },
    ];
  `,
  files: {
    "client.ts": `import "bun:bake/client";`,
    "A.ts": `"use client"; export const v = 0;`,
    "B.ts": `"use client"; import { one } from "virtual:one"; export const v = one;`,
    "routes/a.ts": `
      import * as A from "../A";
      export default () => new Response(Object.keys(A).join());
    `,
    "routes/b.ts": `
      import * as B from "../B";
      export default () => new Response(Object.keys(B).join());
    `,
  },
  async test(dev) {
    await dev.fetch("/a").equals("v");
    await dev.fetch("/b").equals("v");
    const { promise: update, resolve, reject } = Promise.withResolvers<string>();
    dev.on("hmr", (data: Uint8Array) => {
      const message = Buffer.from(data).toString("latin1");
      if (message[0] === "u") resolve(message);
      if (message[0] === "e") reject(new Error("the edit does not bundle: " + message));
    });
    dev.socket!.addEventListener("close", () => reject(new Error("the dev server closed the socket")));
    // Subscribes the socket of the harness to hot updates ("h") and errors ("e") too.
    dev.socket!.send("sher");
    await dev.write("A.ts", `"use client"; import { one } from "virtual:one"; export const v = one;`);
    const modules = [...(await update).matchAll(/^  "([^"\n]+)": \[/gm)].map(match => match[1]);
    expect(modules.sort()).toEqual(["A.ts", "virtual:one"]);
  },
});

// A page of a `clientPages` router starts its own tab, also where another page imports it.
devTest("virtual module that a page which another page imports starts to import is in the hot update", {
  framework: {
    fileSystemRouterTypes: [
      { ...minimalFramework.fileSystemRouterTypes![0], clientEntryPoint: "./client.ts", clientPages: true },
    ],
  },
  pluginFile: `
    export default [
      {
        name: "virtual",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => {
            return { path: args.path.slice("virtual:".length), namespace: "virtual" };
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => {
            return { contents: "export const one = 1;", loader: "js" };
          });
        },
      },
    ];
  `,
  files: {
    "client.ts": `import "bun:bake/client";`,
    "routes/index.ts": `
      export const name = "index";
      export default () => new Response(name);
    `,
    "routes/about.ts": `
      import { one } from "virtual:one";
      import { name } from "./index";
      export default () => new Response(name + one);
    `,
  },
  async test(dev) {
    await dev.fetch("/about").equals("index1");
    await dev.fetch("/").equals("index");
    const { promise: update, resolve, reject } = Promise.withResolvers<string>();
    dev.on("hmr", (data: Uint8Array) => {
      const message = Buffer.from(data).toString("latin1");
      if (message[0] === "u") resolve(message);
      if (message[0] === "e") reject(new Error("the edit does not bundle: " + message));
    });
    dev.socket!.addEventListener("close", () => reject(new Error("the dev server closed the socket")));
    dev.socket!.send("sher");
    await dev.write(
      "routes/index.ts",
      `
        import { one } from "virtual:one";
        export const name = "index" + one;
        export default () => new Response(name);
      `,
    );
    const modules = [...(await update).matchAll(/^  "([^"\n]+)": \[/gm)].map(match => match[1]);
    expect(modules.sort()).toEqual(["routes/index.ts", "virtual:one"]);
  },
});

// A file that starts to import a module the page already holds must not make
// the client run that module again.
devTest("adding an import of a module the page already holds does not re-run it", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "virtual",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => {
            return { path: args.path.slice("virtual:".length), namespace: "virtual" };
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => {
            return { contents: 'console.log("shared evaluated"); export const s = "shared";', loader: "js" };
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./foo.ts";
      import { s } from "virtual:__foo__";
      console.log("index " + s);
    `,
    "foo.ts": `
      console.log("foo 1");
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("foo 1", "shared evaluated", "index shared");
    await dev.write(
      "foo.ts",
      `import { s } from "virtual:__foo__"; console.log("foo 2 " + s); import.meta.hot.accept();`,
    );
    await c.expectMessage("foo 2 shared");
    expect(bundledAgain(await c.getMostRecentHmrChunk())).toEqual(["virtual:__foo__"]);
  },
});

// A module copies what it reads from an import when it runs: `export *` is a
// spread. An unchanged module that imports a module of the same update still
// goes in, after that import, so that the copy is new.
for (const [kind, specifier, plugin, reExporter] of [
  [
    "virtual module",
    "virtual:reg",
    `
      build.onResolve({ filter: /^virtual:/ }, args => {
        return { path: args.path.slice("virtual:".length), namespace: "virtual" };
      });
      build.onLoad({ filter: /.*/, namespace: "virtual" }, () => {
        return {
          contents: "export * from " + JSON.stringify(path.join(import.meta.dir, "comp.ts")) + "; export const helper = () => 1;",
          loader: "js",
        };
      });
    `,
    {},
  ],
  [
    "disk module that an onResolve filter matches",
    "./matched.ts",
    `build.onResolve({ filter: /matched\\.ts$/ }, () => undefined);`,
    { "matched.ts": `export * from "./comp.ts"; export const helper = () => 1;` },
  ],
] as const) {
  const comp = (v: number) =>
    `import { helper } from "${specifier}"; export const v = ${v}; export const use = () => helper();`;
  devTest(`saved module read through a ${kind} that re-exports it and that it imports`, {
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./plugin.ts"]
      `,
      "plugin.ts": `
        import path from "node:path";
        export default {
          name: "re-export",
          setup(build) {
            ${plugin}
          },
        };
      `,
      "index.html": emptyHtmlFile({ scripts: ["main.ts"] }),
      "main.ts": `
        import { v } from "${specifier}";
        globalThis.read = () => v;
        console.log("main");
        import.meta.hot.accept();
      `,
      "comp.ts": comp(1),
      ...reExporter,
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("main");
      expect(await c.js<number>`read()`).toBe(1);
      await dev.write("comp.ts", comp(2));
      await c.expectMessage("main");
      expect(await c.js<number>`read()`).toBe(2);
    },
  });
}

// The importer asks the barrel for a name only after the slow answer, when the barrel is parsed.
devTest("barrel that re-exports twice from one file, with a slow onResolve answer in its importer", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      const parsed = Promise.withResolvers();
      export default {
        name: "slow",
        setup(build) {
          build.onResolve({ filter: /^(dup|slow)$/ }, async args => {
            if (args.path === "slow") await parsed.promise;
            return undefined;
          });
          // Asked for when the barrel is parsed.
          build.onLoad({ filter: /star\\.js$/ }, () => {
            parsed.resolve();
            return undefined;
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { Beta } from "dup";
      import slow from "slow";
      console.log(Beta + " " + slow);
    `,
    "node_modules/dup/package.json": JSON.stringify({
      name: "dup",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/dup/index.js": `
      export { Alpha } from "./utils.js";
      export { Beta } from "./utils.js";
      export { Gamma } from "./gamma.js";
      export * from "./star.js";
    `,
    "node_modules/dup/star.js": `export const Star = "STAR";`,
    "node_modules/dup/utils.js": `export const Alpha = "ALPHA"; export const Beta = "BETA";`,
    "node_modules/dup/gamma.js": `export const Gamma = "GAMMA";`,
    "node_modules/slow/package.json": JSON.stringify({ name: "slow", version: "1.0.0", main: "./index.js" }),
    "node_modules/slow/index.js": `export default "slow";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("BETA slow");
  },
});

// The first bundle of a route goes to the open tabs of other routes too. A
// module that the new route shares with them is bundled again and has the
// same output: it does not run again in those tabs.
const sharedWithNewRoute = `console.log("shared evaluated"); export const s = "shared";`;
for (const [kind, specifier, again] of [
  ["virtual module", "virtual:shared", ["virtual:shared"]],
  // As with no plugin, it is not bundled again.
  ["disk module that an onResolve filter matches", "./matched.ts", []],
  ["barrel file", "barrel-lib", ["node_modules/barrel-lib/index.js"]],
] as const) {
  devTest(`${kind} shared with a route that loads for the first time does not run again in the open tab`, {
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./plugin.ts"]
      `,
      "plugin.ts": `
        export default {
          name: "shared",
          setup(build) {
            build.onResolve({ filter: /^virtual:/ }, args => {
              return { path: args.path.slice("virtual:".length), namespace: "virtual" };
            });
            build.onLoad({ filter: /.*/, namespace: "virtual" }, () => {
              return { contents: ${JSON.stringify(sharedWithNewRoute)}, loader: "js" };
            });
            build.onResolve({ filter: /matched\\.ts$/ }, () => undefined);
          },
        };
      `,
      "matched.ts": sharedWithNewRoute,
      "node_modules/barrel-lib/package.json": JSON.stringify({
        name: "barrel-lib",
        version: "1.0.0",
        main: "./index.js",
        sideEffects: false,
      }),
      "node_modules/barrel-lib/index.js": `
        export { s } from './alpha.js';
        export { Beta } from './beta.js';
      `,
      "node_modules/barrel-lib/alpha.js": sharedWithNewRoute,
      "node_modules/barrel-lib/beta.js": `export const Beta = "BETA";`,
      "a.html": emptyHtmlFile({ scripts: ["a.ts"] }),
      "b.html": emptyHtmlFile({ scripts: ["b.ts"] }),
      "a.ts": `import { s } from "${specifier}"; console.log("a 1 " + s); import.meta.hot.accept(() => console.log("accept a.ts"));`,
      "b.ts": `import { s } from "${specifier}"; console.log("b 1 " + s);`,
    },
    async test(dev) {
      await using a = await dev.client("/a", { storeHotChunks: true });
      await a.expectMessage("shared evaluated", "a 1 shared");
      await using b = await dev.client("/b");
      await b.expectMessage("shared evaluated", "b 1 shared");
      // The tab of /a acks the update after it ran.
      const firstBundle = await a.getMostRecentHmrChunk();
      await a.drainAcks();
      expect(firstBundle).toContain('"b.ts": [');
      expect(hmrChunkKeys(firstBundle)).not.toContain("matched.ts");
      expect(bundledAgain(firstBundle)).toEqual(expect.arrayContaining([...again]));
      await a.expectMessage();
    },
  });
}

// Another route that imports a module which was only bundled again runs nothing.
devTest("route that shares a virtual module runs nothing when another importer changes", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "shared",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => {
            return { path: args.path.slice("virtual:".length), namespace: "virtual" };
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => {
            return { contents: ${JSON.stringify(sharedWithNewRoute)}, loader: "js" };
          });
        },
      };
    `,
    "a.html": emptyHtmlFile({ scripts: ["a.ts"] }),
    "b.html": emptyHtmlFile({ scripts: ["b.ts"] }),
    "a.ts": `import { s } from "virtual:shared"; console.log("a 1 " + s); import.meta.hot.accept();`,
    "b.ts": `import { s } from "virtual:shared"; console.log("b 1 " + s);`,
  },
  async test(dev) {
    await using a = await dev.client("/a");
    await a.expectMessage("shared evaluated", "a 1 shared");
    await using b = await dev.client("/b");
    await b.expectMessage("shared evaluated", "b 1 shared");
    await dev.patch("a.ts", { find: "a 1", replace: "a 2" });
    await a.expectMessage("a 2 shared");
    // The tab of /b acks the update without running anything.
    await b.drainAcks();
    await b.expectMessage();
  },
});

// A plugin that answers `onResolve` with a file path: the bundler bundles that
// file again with each importer too.
devTest("file that an onResolve plugin resolves to does not run again when one of two importers changes", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      import * as path from "node:path";
      export default {
        name: "alias",
        setup(build) {
          build.onResolve({ filter: /^@alias\\// }, args => {
            return { path: path.join(import.meta.dir, args.path.slice("@alias/".length) + ".ts") };
          });
        },
      };
    `,
    "bar.ts": `
      console.log("shared evaluated");
      export function registerComponent() {}
    `,
    ...withShared("@alias/bar"),
  },
  async test(dev) {
    await expectOnlyFooInHotUpdate(dev, ["bar.ts"]);
  },
});

// The output of a module must not depend on the other modules of the bundle,
// or the comparison never matches. This module has imports of every kind,
// nested names that other modules declare at the top level, and TypeScript
// syntax that makes the printer declare names of its own.
const richImporter = (name: string, n: number) => `
  import { v, Foo, f } from "virtual:rich.ts";
  const helper = 1, w = 2, plain = 3, E = 4, NS = 5, Runtime = 6, outer = 7, inner = 8, r = 9, x = 10, import_enums = 11, import_plain = 12, hmr2 = 13;
  void typeof someGlobalName; void typeof foo; void typeof bar; void typeof clash1;
  console.log("${name} ${n} " + v + " " + [helper, w, plain, E, NS, Runtime, outer, inner, r, x, import_enums, import_plain, hmr2].length + typeof Foo + typeof f);
  import.meta.hot.accept(() => {});
`;
devTest("virtual module with imports, nested names and TypeScript syntax does not run again", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "virtual",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path.slice("virtual:".length), namespace: "virtual" }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, async args => ({
            contents: await Bun.file(process.cwd() + "/virt-" + args.path).text(),
            loader: "ts",
            resolveDir: process.cwd(),
          }));
        },
      };
    `,
    "enums.ts": `export enum E { A = 1, B = 2 } export const K = 42;`,
    "cjs.cjs": `module.exports = { x: "cjs" };`,
    "data.json": `{ "n": 1 }`,
    "plain.ts": `export const plain = 1; export function helper() { return 2; }`,
    "virt-leaf.ts": `export const w = "W"; export function helper() { return w; }`,
    "virt-rich.ts": `
      import { E, K } from "./enums.ts";
      import cjs from "./cjs.cjs";
      import data from "./data.json";
      import { w, helper } from "virtual:leaf.ts";
      import * as ns from "./plain.ts";
      import { plain, helper as helper2 } from "./plain.ts";
      enum Runtime { P, Q }
      namespace NS { export const z = 1; export function helper() { return z; } }
      export class Foo { #priv = 1; static s = 2; get p() { return this.#priv; } }
      function outer(hmr: any, module: any, exports: any) {
        let import_enums = 1; let foo = 2; let bar = 3;
        { let foo = 4; let someGlobalName = 9; return foo + import_enums + bar + someGlobalName; }
      }
      function inner() { const helper = 1; const w = 2; const plain = 3; const E = 4; return helper + w + plain + E; }
      export async function f() { return [await import("./plain.ts"), await import("virtual:leaf.ts")]; }
      const r = require("./cjs.cjs");
      let x = (data as any)?.n ?? 0; x ||= 1;
      console.log("rich evaluated");
      export const v = [E.A, K, Runtime.P, NS.z, cjs.x, data.n, w, helper(), helper2(), plain, ns.plain, r.x, x, new Foo().p, outer(0, 0, 0), inner()].join(",");
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts", "foo.ts", "bar.ts"] }),
    "index.ts": richImporter("index", 1),
    "foo.ts": richImporter("foo", 1),
    "bar.ts": `import("virtual:rich.ts"); const q = require("virtual:rich.ts"); console.log("bar 1 " + q.v); import.meta.hot.accept(() => {});`,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    const v = "1,42,0,1,cjs,1,W,W,2,1,1,cjs,1,1,17,10";
    await c.expectMessage(
      "rich evaluated",
      `index 1 ${v} 13functionfunction`,
      `foo 1 ${v} 13functionfunction`,
      `bar 1 ${v}`,
    );
    const expectOnly = async (file: string) => {
      const chunk = await c.getMostRecentHmrChunk();
      expect(savedKeys(chunk)).toEqual([file]);
    };
    // Each save bundles the two virtual modules again with another set of modules.
    await dev.patch("foo.ts", { find: "foo 1", replace: "foo 2" });
    await c.expectMessage(`foo 2 ${v} 13functionfunction`);
    await expectOnly("foo.ts");
    await dev.patch("index.ts", { find: "index 1", replace: "index 2" });
    await c.expectMessage(`index 2 ${v} 13functionfunction`);
    await expectOnly("index.ts");
    await dev.patch("bar.ts", { find: "bar 1", replace: "bar 2" });
    await c.expectMessage(`bar 2 ${v}`);
    await expectOnly("bar.ts");
  },
});

// Trailing whitespace changes neither the code nor the mappings, only the
// source text in the source map. The module is still sent.
devTest("virtual module whose source changes only in whitespace is still sent", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      let loads = 0;
      export default {
        name: "regen-ws",
        setup(build) {
          build.onResolve({ filter: /^virtual:gen$/ }, () => ({ path: "gen", namespace: "virtual" }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
            contents: "export const s = 'shared';" + " ".repeat(loads++),
            loader: "js",
          }));
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { s } from "virtual:gen";
      console.log("index 1 " + s);
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("index 1 shared");
    await dev.patch("index.ts", { find: "index 1", replace: "index 2" });
    await c.expectMessage("index 2 shared");
    expect(await c.getMostRecentHmrChunk()).toContain('"virtual:gen": [');
  },
});

// The chunks of a bundle arrive importer first. An unchanged barrel arrives
// before the changed module it re-exports, and still goes into the update,
// at the place where it arrived.
devTest("unchanged barrel received before the changed module it re-exports is still sent", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      let generated = "";
      export default {
        name: "barrel-regen",
        setup(build) {
          build.onLoad({ filter: /comp\\.txt$/ }, async args => {
            generated = (await Bun.file(args.path).text()).trim();
            return {
              contents: 'import { v } from "virtual:barrel"; globalThis.read = () => v; console.log("comp"); import.meta.hot.accept();',
              loader: "js",
            };
          });
          build.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path.slice("virtual:".length), namespace: "virtual" }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, args => ({
            contents: args.path === "barrel" ? 'export * from "virtual:gen";' : "export const v = " + JSON.stringify(generated) + ";",
            loader: "js",
          }));
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./comp.txt";
    `,
    "comp.txt": "one",
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("comp");
    expect(await c.js<string>`read()`).toBe("one");
    await dev.write("comp.txt", "two");
    await c.expectMessage("comp");
    expect(hmrChunkKeys(await c.getMostRecentHmrChunk())).toEqual(["comp.txt", "virtual:barrel", "virtual:gen"]);
  },
});

// The update keeps the order in which the chunks arrive. An unchanged module
// that stays in it runs before a changed module that arrives later and copies
// from it. The unchanged module reads the saved file directly, or through a
// plain module that accepts the update and runs again.
for (const [name, reExported, extra, first, second] of [
  ["the saved file", "saved.ts", {}, "1 1", "2 2"],
  [
    "a plain module that accepts the update",
    "accepting.ts",
    {
      "accepting.ts": `import { v as saved } from "./saved.ts"; export const v = saved * 10; import.meta.hot.accept();`,
    },
    "10 1",
    "20 2",
  ],
] as const) {
  const saved = (v: number) => `import "virtual:barrel"; export const v = ${v};`;
  devTest(`changed module runs after the unchanged module that it copies from, which re-exports ${name}`, {
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./plugin.ts"]
      `,
      "plugin.ts": `
        import path from "node:path";
        let generation = 0;
        export default {
          name: "regen-after",
          setup(build) {
            build.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path.slice("virtual:".length), namespace: "virtual" }));
            build.onLoad({ filter: /.*/, namespace: "virtual" }, args => ({
              contents:
                args.path === "barrel"
                  ? 'import "virtual:gen"; export * from ' + JSON.stringify(path.join(import.meta.dir, ${JSON.stringify(reExported)})) + ";"
                  : 'export * from "virtual:barrel"; export const generation = ' + ++generation + ";",
              loader: "js",
            }));
          },
        };
      `,
      "index.html": emptyHtmlFile({ scripts: ["main.ts"] }),
      "main.ts": `
        import { v, generation } from "virtual:gen";
        globalThis.read = () => v + " " + generation;
        console.log("main");
        import.meta.hot.accept();
      `,
      "saved.ts": saved(1),
      ...extra,
    },
    async test(dev) {
      await using c = await dev.client("/", { storeHotChunks: true });
      await c.expectMessage("main");
      expect(await c.js<string>`read()`).toBe(first);
      await dev.write("saved.ts", saved(2));
      await c.expectMessage("main");
      expect(hmrChunkKeys(await c.getMostRecentHmrChunk())).toEqual(["saved.ts", "virtual:barrel", "virtual:gen"]);
      expect(await c.js<string>`read()`).toBe(second);
    },
  });
}

// Two unchanged modules stay in the update. The one that copies from the
// other arrives after it and runs after it.
{
  const saved = (v: number) => `import "virtual:inner"; export const v = ${v};`;
  devTest("unchanged module runs after the unchanged module that it copies from", {
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./plugin.ts"]
      `,
      "plugin.ts": `
        import path from "node:path";
        export default {
          name: "two-unchanged",
          setup(build) {
            build.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path.slice("virtual:".length), namespace: "virtual" }));
            build.onLoad({ filter: /.*/, namespace: "virtual" }, args => ({
              contents:
                args.path === "inner"
                  ? 'import "virtual:outer"; export * from ' + JSON.stringify(path.join(import.meta.dir, "accepting.ts")) + ";"
                  : 'export * from "virtual:inner"; import ' + JSON.stringify(path.join(import.meta.dir, "saved.ts")) + ";",
              loader: "js",
            }));
          },
        };
      `,
      "index.html": emptyHtmlFile({ scripts: ["main.ts"] }),
      "main.ts": `
        import { doubled } from "virtual:outer";
        globalThis.read = () => doubled;
        console.log("main");
        import.meta.hot.accept();
      `,
      "accepting.ts": `import { v } from "./saved.ts"; export const doubled = v * 2; import.meta.hot.accept();`,
      "saved.ts": saved(1),
    },
    async test(dev) {
      await using c = await dev.client("/", { storeHotChunks: true });
      await c.expectMessage("main");
      expect(await c.js<number>`read()`).toBe(2);
      await dev.write("saved.ts", saved(2));
      await c.expectMessage("main");
      expect(hmrChunkKeys(await c.getMostRecentHmrChunk())).toEqual(["saved.ts", "virtual:inner", "virtual:outer"]);
      expect(await c.js<number>`read()`).toBe(4);
    },
  });
}

// An unchanged module can read the saved file through a plain module that
// accepts the update and runs again. It stays in the update, also on the
// saves that follow. An unchanged module that imports nothing of the update
// leaves it.
{
  const saved = (v: number) =>
    `import { helper } from "virtual:reexport"; import "virtual:leaf"; export const v = ${v}; export const use = () => helper;`;
  devTest("virtual module that reads the saved file through a plain accepting module is still sent", {
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./plugin.ts"]
      `,
      "plugin.ts": `
        import path from "node:path";
        export default {
          name: "through-accepting",
          setup(build) {
            build.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path.slice("virtual:".length), namespace: "virtual" }));
            build.onLoad({ filter: /.*/, namespace: "virtual" }, args => ({
              contents:
                args.path === "leaf"
                  ? 'console.log("leaf evaluated");'
                  : "export * from " + JSON.stringify(path.join(import.meta.dir, "accepting.ts")) + "; export const helper = 1;",
              loader: "js",
            }));
          },
        };
      `,
      "index.html": emptyHtmlFile({ scripts: ["main.ts"] }),
      "main.ts": `
        import { doubled } from "virtual:reexport";
        globalThis.read = () => doubled;
        console.log("main");
        import.meta.hot.accept();
      `,
      "accepting.ts": `
        import { v } from "./saved.ts";
        export const doubled = v * 2;
        import.meta.hot.accept();
      `,
      "saved.ts": saved(1),
    },
    async test(dev) {
      await using c = await dev.client("/", { storeHotChunks: true });
      await c.expectMessage("leaf evaluated", "main");
      expect(await c.js<number>`read()`).toBe(2);
      for (const v of [2, 3, 4]) {
        await dev.write("saved.ts", saved(v));
        await c.expectMessage("main");
        expect(hmrChunkKeys(await c.getMostRecentHmrChunk()).sort()).toEqual([
          "saved.ts",
          "virtual:leaf",
          "virtual:reexport",
        ]);
        expect(await c.js<number>`read()`).toBe(v * 2);
      }
    },
  });
}
