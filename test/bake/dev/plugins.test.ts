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
// fresh). When its output is the same, it is left out of the hot update,
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
async function expectOnlyFooInHotUpdate(dev: Dev, sharedKey: string) {
  await using c = await dev.client("/", { storeHotChunks: true });
  await c.expectMessage("shared evaluated", "foo loaded 1", "index loaded");
  await dev.patch("foo.ts", { find: "foo loaded 1", replace: "foo loaded 2" });
  await c.expectMessage("foo loaded 2", "accept foo.ts");
  // The update holds one module, `foo.ts`. The shared module appears only in
  // the dependency list of `foo.ts`, never as a module of its own.
  const chunk = await c.getMostRecentHmrChunk();
  expect(chunk).toContain('"foo.ts": [');
  expect(chunk).not.toContain(`${JSON.stringify(sharedKey)}: [`);
}
devTest("virtual module shared by two importers is not re-sent when one importer changes", {
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
    await expectOnlyFooInHotUpdate(dev, "virtual:__foo__");
  },
});
devTest("virtual json module shared by two importers is not re-sent when one importer changes", {
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
    // A JSON module prints as `"key"(hmr) {`, not as `"key": [`.
    const chunk = await c.getMostRecentHmrChunk();
    expect(chunk).toContain('"foo.ts": [');
    expect(chunk).not.toMatch(/"virtual:__foo__"\(hmr/);
  },
});
devTest("disk module matched by an onResolve filter that returns nothing is not re-sent when one importer changes", {
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
    await expectOnlyFooInHotUpdate(dev, "bar.ts");
  },
});

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
    expect(await c.getMostRecentHmrChunk()).not.toContain('"virtual:__foo__": [');
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

// The first bundle of a route goes to the open tabs of other routes too. A
// module that the new route shares with them is bundled again and has the
// same output: it does not run again in those tabs.
const sharedWithNewRoute = `console.log("shared evaluated"); export const s = "shared";`;
for (const [kind, specifier, key] of [
  ["virtual module", "virtual:shared", "virtual:shared"],
  ["disk module that an onResolve filter matches", "./matched.ts", "matched.ts"],
  ["barrel file", "barrel-lib", "node_modules/barrel-lib/index.js"],
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
      expect(firstBundle).not.toContain(`${JSON.stringify(key)}: [`);
      await a.expectMessage();
    },
  });
}

// A module that the hot update left out changes no route: another route that
// imports it keeps its page script.
devTest("route that shares a virtual module keeps its page script when another importer changes", {
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
    const pageScript = async (route: string) => /src="([^"]+\.js)"/.exec(await dev.fetch(route).text())![1];
    await using a = await dev.client("/a");
    await a.expectMessage("shared evaluated", "a 1 shared");
    await using b = await dev.client("/b");
    await b.expectMessage("shared evaluated", "b 1 shared");
    const before = await pageScript("/b");
    await dev.patch("a.ts", { find: "a 1", replace: "a 2" });
    await a.expectMessage("a 2 shared");
    // The tab of /b acks the update without running anything.
    await b.drainAcks();
    await b.expectMessage();
    expect(await pageScript("/b")).toBe(before);
  },
});

// A plugin that answers `onResolve` with a file path: the bundler bundles that
// file again with each importer too.
devTest("file that an onResolve plugin resolves to is not re-sent when one of two importers changes", {
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
    await expectOnlyFooInHotUpdate(dev, "bar.ts");
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
devTest("virtual module with imports, nested names and TypeScript syntax stays out of the hot update", {
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
      expect([...chunk.matchAll(/^  ("(?:[^"\\]|\\.)*")(?:: \[|\()/gm)].map(m => JSON.parse(m[1]))).toEqual([file]);
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
// before the changed module it re-exports, and still goes into the update.
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
    expect(await c.getMostRecentHmrChunk()).toContain('"virtual:barrel": [');
    expect(await c.js<string>`read()`).toBe("two");
  },
});

// An unchanged module that arrives after its changed import keeps its place in
// the update. A changed module that arrives later and reads it runs after it.
{
  const comp = (v: number) => `import "./matched.ts"; export const v = ${v};`;
  devTest("changed module received after the unchanged re-exporter that it reads runs after it", {
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
            build.onResolve({ filter: /matched\\.ts$/ }, () => undefined);
            build.onResolve({ filter: /^virtual:gen$/ }, () => ({ path: "gen", namespace: "virtual" }));
            build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
              contents: "export * from " + JSON.stringify(path.join(import.meta.dir, "matched.ts")) + "; export const generation = " + ++generation + ";",
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
      "comp.ts": comp(1),
      "matched.ts": `import "virtual:gen"; export * from "./comp.ts";`,
    },
    async test(dev) {
      await using c = await dev.client("/", { storeHotChunks: true });
      await c.expectMessage("main");
      expect(await c.js<string>`read()`).toBe("1 1");
      await dev.write("comp.ts", comp(2));
      await c.expectMessage("main");
      const chunk = await c.getMostRecentHmrChunk();
      expect(chunk.indexOf('"matched.ts": [')).toBeGreaterThan(-1);
      expect(chunk.indexOf('"matched.ts": [')).toBeLessThan(chunk.indexOf('"virtual:gen": ['));
      expect(await c.js<string>`read()`).toBe("2 2");
    },
  });
}
