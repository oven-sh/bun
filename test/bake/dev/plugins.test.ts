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
// Each failing onLoad below awaits `defer()` so its answer finishes the bundle; MIMALLOC_PURGE_DELAY=0 makes a touch of the torn-down arena fault.
devTest("onLoad callback that throws fails the route and leaves the dev server usable", {
  env: { MIMALLOC_PURGE_DELAY: "0" },
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "throwing-onload",
        setup(build) {
          build.onLoad({ filter: /entry\\.ts$/ }, async ({ defer }) => {
            await defer();
            throw new Error("onLoad failed on purpose");
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["entry.ts"] }),
    "entry.ts": `console.log("never bundled");`,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.output.waitForLine(/onLoad failed on purpose/);
    // Bundles the route again, so the dev server has to be intact after the failed bundle.
    expect((await dev.fetch("/")).status).toBe(500);
  },
});
// Nothing else can load a plugin-namespace module whose onLoad answers nothing, so the routes importing it must fail.
const decliningOnLoadPlugin = /* ts */ `
  {
    name: "declining-onload",
    setup(build) {
      build.onResolve({ filter: /^virtual-config$/ }, () => ({ path: "config.ts", namespace: "virtual" }));
      build.onLoad({ filter: /.*/, namespace: "virtual" }, async ({ defer }) => {
        await defer();
        return undefined;
      });
    },
  }
`;
const decliningOnLoadError = 'virtual:config.ts: error: Module not found "virtual:config.ts" in namespace "virtual"';
devTest("onLoad that does not answer for a module outside the file namespace fails the html route", {
  env: { MIMALLOC_PURGE_DELAY: "0" },
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
    // The failure is recorded against the module itself, so the route keeps failing when requested again.
    expect((await dev.fetch("/")).status).toBe(500);
  },
});
devTest("onLoad that does not answer for a module outside the file namespace fails the server route", {
  env: { MIMALLOC_PURGE_DELAY: "0" },
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

// An onResolve fall-through resolution failure the importer handles itself (require in try/catch) is not an error.
const onResolveFallThroughPlugin = {
  "bunfig.toml": `
    [serve.static]
    plugins = ["./plugin.ts"]
  `,
  "plugin.ts": `
    export default {
      name: "fall-through",
      setup(build) {
        build.onResolve({ filter: /optional-dep|missing/ }, () => undefined);
      },
    };
  `,
};
devTest("onResolve fall-through keeps a module whose missing require is in try/catch", {
  files: {
    ...onResolveFallThroughPlugin,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      let value = "fallback";
      try {
        value = require("./optional-dep").value;
      } catch {}
      console.log("v1 " + value);
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("v1 fallback");

    // The module is in the incremental graph, so editing it is a hot update.
    await dev.patch("index.ts", { find: "v1", replace: "v2" });
    await c.expectMessage("v2 fallback");

    // The failed resolution is still tracked: creating the file re-bundles the importer.
    await dev.write("optional-dep.ts", `export const value = "dep";`);
    await c.expectMessage("v2 dep");
  },
});
devTest("onResolve fall-through still reports an unresolvable import", {
  files: {
    ...onResolveFallThroughPlugin,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { value } from "./missing";
      console.log(value);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: [`index.ts:1:23: error: Could not resolve: "./missing"`],
    });
    await c.expectReload(async () => {
      await dev.write("missing.ts", `export const value = "found";`);
    });
    await c.expectMessage("found");
  },
});
