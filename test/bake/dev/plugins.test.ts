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
    const chunk = await c.getMostRecentHmrChunk();
    expect(chunk).toContain('"foo.ts": [');
    expect(chunk).not.toContain('"virtual:__foo__": [');
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

// A page that loads after an import was removed does not hold the module.
// When the import comes back, the hot update must carry the module again.
for (const [name, specifier, extraFiles] of [
  ["virtual module", "virtual:__foo__", {}],
  ["disk module", "./shared.ts", { "shared.ts": `console.log("shared evaluated"); export const s = "shared";` }],
] as const) {
  devTest(`${name} removed, page reloaded, then imported again is sent to the client`, {
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
        import { s } from "${specifier}";
        console.log("index " + s);
        import.meta.hot.accept();
      `,
      ...extraFiles,
    },
    async test(dev) {
      await using c = await dev.client("/");
      await c.expectMessage("shared evaluated", "index shared");
      await dev.write("index.ts", `console.log("index alone"); import.meta.hot.accept();`);
      await c.expectMessage("index alone");
      await c.hardReload();
      await c.expectMessage("index alone");
      await dev.write(
        "index.ts",
        `import { s } from "${specifier}"; console.log("index again " + s); import.meta.hot.accept();`,
      );
      await c.expectMessage("shared evaluated", "index again shared");
    },
  });
}

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
