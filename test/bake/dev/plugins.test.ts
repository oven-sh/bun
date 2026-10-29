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

// A module that the incremental graph already holds is not bundled again when
// an importer changes, whether the resolver or a plugin resolved it.
// https://github.com/oven-sh/bun/issues/47398
const sharedModuleFiles = {
  "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
  "index.ts": `
    import "./foo.ts";
    import { registerComponent } from "SHARED";
    registerComponent();
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
            return { contents: "console.log('shared evaluated'); export function registerComponent() {}", loader: "js" };
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
