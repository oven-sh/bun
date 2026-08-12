// Plugin tests concern plugins in development mode.
import { DataViewReader } from "bake/data-view";
import { decodeSerializedError } from "bake/error-serialization";
import { describe, expect } from "bun:test";
import { compileFixture } from "harness";
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

/** Decodes the failures a "Build Failed" page embeds, with the client's own decoder. */
function decodeBuildFailedPage(html: string) {
  const base64 = html.match(/atob\("([^"]*)"\)/)?.[1];
  if (base64 === undefined) throw new Error("not a build failure page:\n" + html);
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const reader = new DataViewReader(new DataView(bytes.buffer), 0);
  const failures: { file: string; messages: unknown[] }[] = [];
  while (reader.hasMoreData()) {
    reader.u32(); // owner handle
    const file = reader.string32();
    const messages = Array.from({ length: reader.u32() }, () => decodeSerializedError(reader));
    failures.push({ file, messages });
  }
  return failures.sort((a, b) => a.file.localeCompare(b.file));
}

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

  // A native plugin fills in `BunLogOptions` by hand, so unlike the parser it
  // can log a location with a line but no (zero or negative) column. The dev
  // server used to panic serializing a negative column, and the overlay used to
  // throw out of `"_".repeat(column - 1)` for column 0, rendering no errors at
  // all. The harness formats a message as `file:line:column` only when it has an
  // underline, hence the two shapes in `errors`.
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
  // What the overlay renders for each message: the line number and line text
  // always, the underline (and where it starts) only when the column is known.
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
      expect(decodeBuildFailedPage(await response.text())).toEqual(decodedFailures);
      expect(response.status).toBe(500);

      // ...and pushes over the HMR socket to the page that was already open.
      await openPage.expectErrorOverlay(errors);
      expect(await readRenderedCodeLines(openPage)).toEqual(renderedCodeLines);

      // The error page renders the same thing from its embedded copy.
      await using errorPage = await dev.client("/errors", { errors });
      expect(await readRenderedCodeLines(errorPage)).toEqual(renderedCodeLines);
    },
  });
});
