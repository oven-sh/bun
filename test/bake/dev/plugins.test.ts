// Plugin tests concern plugins in development mode.
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
