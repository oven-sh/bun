// Plugin tests concern plugins in development mode.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { devTest, minimalFramework } from "../bake-harness";

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

// `app.plugins` and `framework.plugins` share one parser; a non-array used to be iterated or silently ignored.
test.concurrent("app.plugins and framework.plugins must be arrays", async () => {
  using dir = tempDir("bake-plugins-not-array", {
    "server.ts": `export function render() { return new Response("unused"); }`,
    "check.ts": `
      const framework = {
        fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" }],
      };
      let setupCalls = 0;
      const plugin = { name: "counted", setup() { setupCalls++; } };
      const values = {
        "string": "abc",
        "single plugin object": plugin,
        "number": 123,
        "array-like": { length: 0 },
        "array": [plugin],
        "empty array": [],
        "null": null,
      };
      const sites = {
        "app.plugins": plugins => ({ framework, plugins }),
        "framework.plugins": plugins => ({ framework: { ...framework, plugins } }),
      };

      const results = {};
      for (const [site, app] of Object.entries(sites)) {
        for (const [name, plugins] of Object.entries(values)) {
          try {
            const server = Bun.serve({
              port: 0,
              development: true,
              app: app(plugins),
              fetch: () => new Response(""),
            });
            server.stop(true);
            results[site + " = " + name] = "accepted";
          } catch (e) {
            results[site + " = " + name] = e.message;
          }
        }
      }
      results.setupCalls = setupCalls;
      console.log(JSON.stringify(results));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "check.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toStrictEqual({
    "app.plugins = string": "plugins must be an array",
    "app.plugins = single plugin object": "plugins must be an array",
    "app.plugins = number": "plugins must be an array",
    "app.plugins = array-like": "plugins must be an array",
    "app.plugins = array": "accepted",
    "app.plugins = empty array": "accepted",
    "app.plugins = null": "accepted",
    "framework.plugins = string": "plugins must be an array",
    "framework.plugins = single plugin object": "plugins must be an array",
    "framework.plugins = number": "plugins must be an array",
    "framework.plugins = array-like": "plugins must be an array",
    "framework.plugins = array": "accepted",
    "framework.plugins = empty array": "accepted",
    "framework.plugins = null": "accepted",
    // once per site, from the two "array" cases
    setupCalls: 2,
  });
  expect(exitCode).toBe(0);
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
