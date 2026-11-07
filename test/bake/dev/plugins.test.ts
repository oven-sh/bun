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
// The dev server cannot load an import that a plugin marks external. A result with
// `external: true` and no `path` does not resolve the import here, unlike in `Bun.build`.
devTest("onResolve external without path does not resolve the import", {
  framework: minimalFramework,
  pluginFile: `
    export default [
      {
        name: 'a',
        setup(build) {
          build.onResolve({ filter: /dep\\.ts$/ }, () => ({ external: true }));
        },
      }
    ];
  `,
  files: {
    "dep.ts": `
      export const value = 1;
    `,
    "routes/index.ts": `
      import { value } from '../dep.ts';

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
// The plugin marks the import in external.ts external, with the path that styles.css is
// bundled under for styled.ts. The dev server must not take that path for its own file.
devTest("a plugin-external import whose path is a file another route bundled adds no stylesheet", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./external-styles-plugin.ts"]
    `,
    "external-styles-plugin.ts": `
      import * as path from 'path';
      export default {
        name: 'external-styles',
        setup(build) {
          build.onResolve({ filter: /^external-styles$/ }, (args) => {
            return { path: path.join(args.resolveDir, 'styles.css'), external: true };
          });
        },
      };
    `,
    "styled.html": emptyHtmlFile({ scripts: ["styled.ts"] }),
    "styled.ts": `
      import './styles.css';
    `,
    "external.html": emptyHtmlFile({ scripts: ["external.ts"] }),
    "external.ts": `
      import 'external-styles';
    `,
    "styles.css": `
      .box { color: red; }
    `,
  },
  async test(dev) {
    // A fetch returns after its route is bundled, so styles.css is a file of the dev server
    // before the plugin answers the import in external.ts.
    expect(await fetchPage(dev, "/styled")).toEqual({
      status: 200,
      stylesheets: [expect.stringMatching(/\.css$/)],
    });
    expect(await fetchPage(dev, "/external")).toEqual({
      status: 200,
      stylesheets: [],
    });
  },
});
// The same for a script: the plugin marks the script of external.html external, with the
// path that page.ts is bundled under for page.html. The bundle of external.html has no page.ts.
devTest("a plugin-external script whose path is a file another route bundled is not in the bundle", {
  files: {
    "bunfig.toml": `
      [serve.static]
      plugins = ["./external-script-plugin.ts"]
    `,
    "external-script-plugin.ts": `
      import * as path from 'path';
      export default {
        name: 'external-script',
        setup(build) {
          build.onResolve({ filter: /^external-script$/ }, (args) => {
            return { path: path.join(args.resolveDir, 'page.ts'), external: true };
          });
        },
      };
    `,
    "page.html": emptyHtmlFile({ scripts: ["page.ts"] }),
    "page.ts": `
      console.log("PAGE_SCRIPT_RAN");
    `,
    "external.html": emptyHtmlFile({ scripts: ["external-script"] }),
  },
  async test(dev) {
    expect(await fetchClientBundle(dev, "/page")).toContain("PAGE_SCRIPT_RAN");
    const bundle = await fetchClientBundle(dev, "/external");
    expect(bundle).not.toContain("PAGE_SCRIPT_RAN");
    expect(bundle).not.toContain("page.ts");
  },
});

async function fetchPage(dev: Dev, url: string) {
  const response = await dev.fetch(url);
  const html = await response.text();
  return {
    status: response.status,
    stylesheets: [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map(match => match[1]),
  };
}

async function fetchClientBundle(dev: Dev, url: string) {
  const html = await (await dev.fetch(url)).text();
  const src = html.match(/src="(\/_bun\/client\/[^"]+)"/)![1];
  return await (await dev.fetch(src)).text();
}

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
