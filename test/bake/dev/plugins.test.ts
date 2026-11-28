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
    expect(decodeBuildFailedPage(await response.text())).toEqual([
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
    expect(decodeBuildFailedPage(await response.text())).toEqual([
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
          location: { line: 3, column: 0, length: 0, lineTextColumnOffset: 0, lineText: "const c = 3;" },
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
          location: { line: 1, column: 7, length: 1, lineTextColumnOffset: 0, lineText: "const a = 1;" },
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
          location: { line: 2, column: 0, length: 0, lineTextColumnOffset: 0, lineText: "const b = 2;" },
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
