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
  // No import is new, so the update names no module either.
  expect(chunk).toMatch(/\n\}, "[0-9a-f]{16}"\)\n/);
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
    // The update names the module that the new import needs. It carries no code for it.
    const chunk = await c.getMostRecentHmrChunk();
    expect(chunk).not.toContain('"virtual:__foo__": [');
    expect(chunk).toMatch(/\n\}, "[0-9a-f]{16}", \["virtual:__foo__", \d+\]\)\n/);
  },
});

// A hot update names the modules that a new import needs and that the update
// does not carry. The server does not know which tabs hold them. A tab that
// lacks one asks for it before the update runs, and a tab that holds it does
// not run it again. Three kinds of module differ in what the bundler does:
// it bundles a virtual module and a disk file that an `onResolve` filter
// matches again with each importer, and it never bundles a plain file again.
const lackedModule = `console.log("shared evaluated"); export const s = "shared";`;
const lackedModuleFiles = {
  "bunfig.toml": `
    [serve.static]
    plugins = ["./plugin.ts"]
  `,
  "plugin.ts": `
    export default {
      name: "lacked",
      setup(build) {
        build.onResolve({ filter: /^virtual:/ }, args => {
          return { path: args.path.slice("virtual:".length), namespace: "virtual" };
        });
        build.onLoad({ filter: /.*/, namespace: "virtual" }, () => {
          return { contents: ${JSON.stringify(lackedModule)}, loader: "js" };
        });
        build.onResolve({ filter: /matched\\.ts$/ }, () => undefined);
      },
    };
  `,
  "matched.ts": lackedModule,
  "plain.ts": lackedModule,
};
const lackedModuleKinds = [
  ["virtual module", "virtual:shared"],
  ["plugin-matched disk module", "./matched.ts"],
  ["plain disk module", "./plain.ts"],
] as const;
for (const [kind, specifier] of lackedModuleKinds) {
  const importer = (n: number) =>
    `import { s } from "${specifier}"; console.log("index ${n} " + s); import.meta.hot.accept();`;
  devTest(
    `${kind} that a file imports again reaches the tab that lacks it and does not run again in the tab that holds it`,
    {
      files: {
        ...lackedModuleFiles,
        "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
        "index.ts": importer(1),
      },
      async test(dev) {
        await using holder = await dev.client("/");
        await holder.expectMessage("shared evaluated", "index 1 shared");
        await dev.write("index.ts", importer(2));
        await holder.expectMessage("index 2 shared");
        await dev.write("index.ts", `console.log("index alone"); import.meta.hot.accept();`);
        await holder.expectMessage("index alone");
        // This page loads without the module.
        await using lacker = await dev.client("/");
        await lacker.expectMessage("index alone");
        await dev.write("index.ts", importer(3));
        await holder.expectMessage("index 3 shared");
        await lacker.expectMessage("shared evaluated", "index 3 shared");
        // Both tabs hold it now.
        await dev.write("index.ts", importer(4));
        await holder.expectMessage("index 4 shared");
        await lacker.expectMessage("index 4 shared");
      },
    },
  );
  devTest(`${kind} that only another route loaded reaches the tab that starts to import it`, {
    files: {
      ...lackedModuleFiles,
      "a.html": emptyHtmlFile({ scripts: ["a.ts"] }),
      "b.html": emptyHtmlFile({ scripts: ["b.ts"] }),
      "a.ts": `console.log("a 1"); import.meta.hot.accept();`,
      "b.ts": `import { s } from "${specifier}"; console.log("b 1 " + s); import.meta.hot.accept();`,
    },
    async test(dev) {
      await using b = await dev.client("/b");
      await b.expectMessage("shared evaluated", "b 1 shared");
      await using a = await dev.client("/a");
      await a.expectMessage("a 1");
      await dev.write("a.ts", `import { s } from "${specifier}"; console.log("a 2 " + s); import.meta.hot.accept();`);
      await a.expectMessage("shared evaluated", "a 2 shared");
      await dev.patch("b.ts", { find: "b 1", replace: "b 2" });
      await b.expectMessage("b 2 shared");
      await a.expectMessage();
    },
  });
}
for (const [form, importer] of [
  ["require()", (n: number) => `const { s } = require("virtual:shared"); console.log("index ${n} " + s);`],
  ["import()", (n: number) => `import("virtual:shared").then(({ s }) => console.log("index ${n} " + s));`],
] as const) {
  devTest(`virtual module that ${form} loads again reaches the tab that lacks it`, {
    files: {
      ...lackedModuleFiles,
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      "index.ts": importer(1) + " import.meta.hot.accept();",
    },
    async test(dev) {
      await using holder = await dev.client("/");
      await holder.expectMessage("shared evaluated", "index 1 shared");
      await dev.write("index.ts", `console.log("index alone"); import.meta.hot.accept();`);
      await holder.expectMessage("index alone");
      await using lacker = await dev.client("/");
      await lacker.expectMessage("index alone");
      await dev.write("index.ts", importer(2) + " import.meta.hot.accept();");
      await holder.expectMessage("index 2 shared");
      await lacker.expectMessage("shared evaluated", "index 2 shared");
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
