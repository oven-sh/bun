// Plugin tests concern plugins in development mode.
import { DataViewReader } from "bake/data-view";
import { decodeSerializedError } from "bake/error-serialization";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, compileFixture, tempDir } from "harness";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client, devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

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

/** Decodes the failures a "Build Failed" page embeds with the client's own decoder (`decodeAndAppendServerError` in overlay.ts), sorted by file. */
function decodeBuildFailedPage(html: string) {
  const base64 = html.match(/atob\("([A-Za-z0-9+/=]*)"\)/)?.[1];
  if (base64 === undefined) throw new Error("not a build failure page:\n" + html);
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const reader = new DataViewReader(new DataView(bytes.buffer), 0);
  const failures = [];
  while (reader.hasMoreData()) {
    reader.u32(); // owner, an incremental graph index
    const file = reader.string32() || null;
    const messageCount = reader.u32();
    const messages = [];
    for (let i = 0; i < messageCount; i++) {
      messages.push(decodeSerializedError(reader));
    }
    failures.push({ file, messages });
  }
  return failures.sort((a, b) => (a.file ?? "").localeCompare(b.file ?? ""));
}

function bundlerError(message: string) {
  return { kind: "bundler", level: 0, message, location: null, notes: [] };
}

// A plugin exception becomes a bundler message with `line: 0`; the payload must encode that as "no location" or the overlay reads the rest as further failures.
devTest("exceptions thrown from onLoad are reported without a location", {
  framework: minimalFramework,
  pluginFile: `
    import * as path from 'path';
    export default [
      {
        name: 'a',
        setup(build) {
          build.onLoad({ filter: /trigger/ }, (args) => {
            throw new Error('cannot load ' + path.basename(args.path));
          });
        },
      }
    ];
  `,
  files: {
    "first.trigger.ts": `
      export const first = 1;
    `,
    "second.trigger.ts": `
      export const second = 2;
    `,
    "routes/index.ts": `
      import { first } from '../first.trigger.ts';
      import { second } from '../second.trigger.ts';

      export default function (req, meta) {
        return new Response('value: ' + (first + second));
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    expect(response.status).toBe(500);
    expect(decodeBuildFailedPage(await response.text())).toStrictEqual([
      { file: "first.trigger.ts", messages: [bundlerError("cannot load first.trigger.ts")] },
      { file: "second.trigger.ts", messages: [bundlerError("cannot load second.trigger.ts")] },
    ]);
  },
});
devTest("exception thrown from onResolve is reported without a location", {
  framework: minimalFramework,
  pluginFile: `
    export default [
      {
        name: 'a',
        setup(build) {
          build.onResolve({ filter: /^trigger$/ }, () => {
            throw new Error('onResolve boom');
          });
        },
      }
    ];
  `,
  files: {
    "routes/index.ts": `
      import { value } from 'trigger';

      export default function (req, meta) {
        return new Response('value: ' + value);
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    expect(response.status).toBe(500);
    expect(decodeBuildFailedPage(await response.text())).toStrictEqual([
      { file: "routes/index.ts", messages: [bundlerError("onResolve boom")] },
    ]);
  },
});
// Every failure the client decodes has to be one the server can later remove, otherwise the error page never reloads.
devTest("error page reloads once a plugin exception is fixed", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./plugin.ts"]
    `,
    "plugin.ts": `
      export default {
        name: "a",
        setup(build) {
          build.onResolve({ filter: /^trigger$/ }, () => {
            throw new Error("onResolve boom");
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { value } from "trigger";
      console.log("value: " + value);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["index.ts: error: onResolve boom"],
    });
    await c.expectReload(async () => {
      await dev.write("index.ts", `console.log("fixed");`);
    });
    await c.expectMessage("fixed");
  },
});

let nativeLogPlugin: string | null = null;
try {
  nativeLogPlugin = compileFixture(path.join(import.meta.dir, "native-plugin-log-location.c"), {
    flags: ["-I" + path.join(import.meta.dir, "../../../packages")],
  });
} catch (e) {
  if (!(e instanceof Error) || !e.message.includes("no C compiler")) throw e;
  console.warn(`[plugins.test] native plugin tests skipped: ${e.message}`);
}

describe.skipIf(!nativeLogPlugin)("native plugin log locations", () => {
  if (!nativeLogPlugin) return;

  // A native plugin can log a line with a zero or negative column; the server used to panic on negative and the overlay threw on zero.
  const errors = [
    "with-column.ts:1:7: error: with column",
    "zero-column.ts: error: zero column",
    "negative-column.ts: error: negative column",
  ];
  const decodedFailures = [
    {
      file: "negative-column.ts",
      messages: [
        {
          kind: "bundler",
          level: 0,
          message: "negative column",
          location: { line: 3, column: 0, length: 0, lineText: "const c = 3;" },
          notes: [],
        },
      ],
    },
    {
      file: "with-column.ts",
      messages: [
        {
          kind: "bundler",
          level: 0,
          message: "with column",
          location: { line: 1, column: 7, length: 1, lineText: "const a = 1;" },
          notes: [],
        },
      ],
    },
    {
      file: "zero-column.ts",
      messages: [
        {
          kind: "bundler",
          level: 0,
          message: "zero column",
          location: { line: 2, column: 0, length: 0, lineText: "const b = 2;" },
          notes: [],
        },
      ],
    },
  ];
  // The overlay always renders the line number and text, the underline only when the column is known.
  const renderedCodeLines = [
    { file: "negative-column.ts", line: "3", lineText: "const c = 3;", underline: null },
    { file: "with-column.ts", line: "1", lineText: "const a = 1;", underline: { start: 6, length: 1 } },
    { file: "zero-column.ts", line: "2", lineText: "const b = 2;", underline: null },
  ];
  function readRenderedCodeLines(client: Client): Promise<typeof renderedCodeLines> {
    return client.js`{
      const overlay = document.querySelector("bun-hmr").shadowRoot;
      return [...overlay.querySelectorAll(".b-msg")]
        .map(msg => {
          const underline = msg.querySelector(".highlight-wrap");
          return {
            file: msg.closest(".b-group").querySelector(".file-name").textContent,
            line: msg.querySelector(".gutter").textContent,
            lineText: msg.querySelector(".view > pre").textContent,
            underline: underline && {
              start: underline.querySelector(".space").textContent.length,
              length: underline.querySelector(".line").textContent.length,
            },
          };
        })
        .sort((a, b) => a.file.localeCompare(b.file));
    }`;
  }

  devTest("messages with a line but no column reach the overlay", {
    files: {
      "bunfig.toml": `
        [serve.static]
        plugins = ["./log-location-plugin.ts"]
      `,
      "log-location-plugin.ts": `
        const napiModule = require("./log-location.node");
        export default {
          name: "log-location",
          setup(build) {
            build.onBeforeParse({ filter: /with-column\\.ts$/ }, { napiModule, symbol: "log_with_column" });
            build.onBeforeParse({ filter: /zero-column\\.ts$/ }, { napiModule, symbol: "log_zero_column" });
            build.onBeforeParse({ filter: /negative-column\\.ts$/ }, { napiModule, symbol: "log_negative_column" });
          },
        };
      `,
      "log-location.node": readFileSync(nativeLogPlugin),
      "ok.html": emptyHtmlFile({ scripts: ["ok.ts"] }),
      "ok.ts": `export const ok = true;`,
      "errors.html": emptyHtmlFile({ scripts: ["errors.ts"] }),
      "errors.ts": `
        import "./with-column.ts";
        import "./zero-column.ts";
        import "./negative-column.ts";
      `,
      "with-column.ts": `export const a = 1;`,
      "zero-column.ts": `export const b = 2;`,
      "negative-column.ts": `export const c = 3;`,
    },
    async test(dev) {
      await using openPage = await dev.client("/ok");

      // What the dev server serializes into the error page...
      const response = await dev.fetch("/errors");
      expect(decodeBuildFailedPage(await response.text())).toStrictEqual(decodedFailures);
      expect(response.status).toBe(500);

      // ...and pushes over the HMR socket to the page that was already open.
      await openPage.expectErrorOverlay(errors);
      expect(await readRenderedCodeLines(openPage)).toStrictEqual(renderedCodeLines);

      // The error page renders the same thing from its embedded copy.
      await using errorPage = await dev.client("/errors", { errors });
      expect(await readRenderedCodeLines(errorPage)).toStrictEqual(renderedCodeLines);
    },
  });
});
