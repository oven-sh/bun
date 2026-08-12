// Plugin tests concern plugins in development mode.
import { DataViewReader } from "bake/data-view";
import { decodeSerializedError } from "bake/error-serialization";
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

/**
 * Decodes the bundling failures embedded in the dev server's "Build Failed"
 * page the same way the error overlay does (`decodeAndAppendServerError` in
 * `src/runtime/bake/client/overlay.ts`), so a payload the overlay would
 * misread (an extra failure, or garbage after the first message) fails here.
 * Failures are sorted by file since plugins finish in no particular order.
 */
function decodeBuildFailedPage(html: string) {
  const base64 = html.match(/atob\("([A-Za-z0-9+/=]*)"\)/)?.[1];
  expect(base64).toBeString();
  const bytes = Uint8Array.from(atob(base64!), c => c.charCodeAt(0));
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

// An exception thrown by a plugin becomes a bundler message whose location has
// no line (`line: 0`). The error payload has to encode that as "no location",
// otherwise the overlay reads the rest of the message as further failures.
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
// Every failure the client decodes has to be one the server knows about and
// can later remove, otherwise the error page never reloads once the real
// failure is gone.
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
