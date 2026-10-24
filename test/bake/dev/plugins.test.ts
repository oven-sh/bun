// Plugin tests concern plugins in development mode.
import { devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";
import { expect } from "bun:test";
import { renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";

devTest("incremental onStart is awaited before loading watched virtual modules", {
  framework: minimalFramework,
  pluginFile: `
    import { join } from 'node:path';
    export default [{
      name: 'watched-virtual',
      setup(build) {
        const dependency = join(import.meta.dirname, 'value.txt');
        let value;
        build.onStart(async () => {
          value = await Bun.file(dependency).text();
          if (value === 'reject') throw new Error('incremental preparation failed');
        });
        build.onResolve({ filter: /^watched-value$/ }, () => ({ path: 'value', namespace: 'watched' }));
        build.onLoad({ filter: /.*/, namespace: 'watched' }, () => ({
          contents: 'export default ' + JSON.stringify(value),
          loader: 'js',
          watchFiles: [dependency],
        }));
      },
    }];
  `,
  files: {
    "value.txt": "first",
    "routes/index.ts": `import value from 'watched-value'; export default () => new Response(value);`,
  },
  async test(dev) {
    await dev.fetch("/").equals("first");
    await dev.write("value.txt", "second");
    await dev.fetch("/").equals("second");
    await dev.write("value.txt", "third");
    await dev.fetch("/").equals("third");
    await dev.write("value.txt", "reject", { errors: null });
    const failure = await dev.fetch("/");
    expect(failure.status).toBe(500);
    await dev.write("value.txt", "recovered");
    await dev.fetch("/").equals("recovered");
  },
});

devTest("watch paths normalize absolute separators and dot segments", {
  framework: minimalFramework,
  pluginFile: `
    import { join } from 'node:path';
    import { readdir } from 'node:fs/promises';
    export default [{
      name: 'normalized-watch-paths',
      setup(build) {
        const root = import.meta.dirname.replaceAll('\\\\', '/');
        const valueFile = join(import.meta.dirname, 'value.txt');
        const data = join(import.meta.dirname, 'data');
        build.onResolve({ filter: /^watched-manifest$/ }, () => ({ path: 'manifest', namespace: 'manifest' }));
        build.onLoad({ filter: /.*/, namespace: 'manifest' }, async () => ({
          contents: 'export default ' + JSON.stringify(await Bun.file(valueFile).text() + ':' + (await readdir(data)).sort().join(',')),
          loader: 'js',
          watchFiles: [root + '/data/.././value.txt'],
          watchDirs: [root + '/data/../data/./'],
        }));
      },
    }];
  `,
  files: {
    "value.txt": "first",
    "data/a.txt": "a",
    "routes/index.ts": `import manifest from 'watched-manifest'; export default () => new Response(manifest);`,
  },
  async test(dev) {
    await dev.fetch("/").equals("first:a.txt");
    await dev.write("value.txt", "second");
    await dev.fetch("/").equals("second:a.txt");
    await dev.write("data/b.txt", "b");
    await dev.fetch("/").equals("second:a.txt,b.txt");
    await dev.delete("data/a.txt");
    await dev.fetch("/").equals("second:b.txt");
  },
});

devTest("watchDirs preserves browser state when only a child file's contents change", {
  files: {
    "bunfig.toml": '[serve.static]\nplugins = ["./plugin.ts"]\n',
    "plugin.ts": `
    import { join } from 'node:path';
    import { readdir } from 'node:fs/promises';
    export default {
      name: 'route-names',
      setup(build) {
        const directory = join(import.meta.dirname, 'data');
        build.onResolve({ filter: /^route-names$/ }, () => ({ path: 'names', namespace: 'route-names' }));
        build.onLoad({ filter: /.*/, namespace: 'route-names' }, async () => ({
          contents: 'export default ' + JSON.stringify((await readdir(directory)).sort().join(',')),
          loader: 'js',
          watchDirs: [directory],
        }));
      },
    };
  `,
    "index.html": emptyHtmlFile({ scripts: ["client.ts"], body: "<h1></h1><button>Count 0</button>" }),
    "data/a.ts": `export default "first";`,
    "client.ts": `
      import names from 'route-names';
      document.querySelector('h1').textContent = names;
      let count = 0;
      document.querySelector('button').onclick = event => {
        event.currentTarget.textContent = 'Count ' + ++count;
      };
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { allowUnlimitedReloads: true });
    await c.expectElemText("h1", "a.ts");
    await c.click("button");
    await c.expectElemText("button", "Count 1");
    await dev.write("unrelated.txt", "first");
    await c.expectElemText("button", "Count 1");
    await dev.write("unrelated.txt", "second");
    await c.expectElemText("button", "Count 1");
    await dev.write("data/a.ts", `export default "second";`);
    await c.expectElemText("button", "Count 1");
    await dev.write("data/b.ts", `export default "new route";`);
    await c.expectElemText("h1", "a.ts,b.ts");
  },
});

devTest("watchDirs follows an empty directory after removal and recreation", {
  framework: minimalFramework,
  pluginFile: `
    import { join } from 'node:path';
    import { readdir } from 'node:fs/promises';
    export default [{
      name: 'empty-directory-manifest',
      setup(build) {
        const directory = join(import.meta.dirname, 'data');
        build.onResolve({ filter: /^empty-manifest$/ }, () => ({ path: 'manifest', namespace: 'empty-manifest' }));
        build.onLoad({ filter: /.*/, namespace: 'empty-manifest' }, async () => {
          let value;
          try {
            value = (await readdir(directory)).sort().join(',') || '(empty)';
          } catch (error) {
            if (error.code !== 'ENOENT') {
              throw error;
            }
            value = '(missing)';
          }
          return { contents: 'export default ' + JSON.stringify(value), loader: 'js', watchDirs: [directory] };
        });
      },
    }];
  `,
  files: {
    "routes/index.ts": `import manifest from 'empty-manifest'; export default () => new Response(manifest);`,
  },
  async test(dev) {
    const expectManifest = async (expected: string) => {
      const deadline = Date.now() + 2_000;
      let actual: string;
      do {
        actual = await dev.fetch("/").text();
        if (actual === expected) {
          break;
        }
        await new Promise(setImmediate);
      } while (Date.now() < deadline);
      expect(actual).toBe(expected);
    };
    dev.mkdir("data");
    await expectManifest("(empty)");
    rmdirSync(dev.join("data"));
    await expectManifest("(missing)");
    dev.mkdir("data");
    await expectManifest("(empty)");
    writeFileSync(dev.join("data/a.txt"), "a");
    await expectManifest("a.txt");
  },
});

devTest("watchDirs shares directory events with imported files and trailing-slash aliases", {
  framework: minimalFramework,
  pluginFile: `
    import { join } from 'node:path';
    import { readdir } from 'node:fs/promises';
    export default [{
      name: 'shared-directory-manifests',
      setup(build) {
        const directory = join(import.meta.dirname, 'data');
        build.onResolve({ filter: /^shared-manifest-(bare|slash)$/ }, args => ({ path: args.path, namespace: 'shared-manifest' }));
        build.onLoad({ filter: /.*/, namespace: 'shared-manifest' }, async args => ({
          contents: 'export default ' + JSON.stringify((await readdir(directory)).sort().join(',')),
          loader: 'js',
          watchDirs: [directory + (args.path.endsWith('-slash') ? '/' : '')],
        }));
      },
    }];
  `,
  files: {
    "data/imported.ts": `export default "first";`,
    "routes/warm.ts": `import value from '../data/imported'; export default () => new Response('warm:' + value);`,
    "routes/index.ts": `
      import bare from 'shared-manifest-bare';
      import slash from 'shared-manifest-slash';
      export default () => new Response(bare + '|' + slash);
    `,
  },
  async test(dev) {
    await dev.fetch("/warm").equals("warm:first");
    await dev.fetch("/").equals("imported.ts|imported.ts");
    await dev.write("data/added.txt", "added");
    await dev.fetch("/").equals("added.txt,imported.ts|added.txt,imported.ts");
    await dev.delete("data/added.txt");
    await dev.fetch("/").equals("imported.ts|imported.ts");
  },
});

devTest("watchDirs discovers nested additions and deletions", {
  framework: minimalFramework,
  pluginFile: `
    import { join } from 'node:path';
    import { readdir } from 'node:fs/promises';
    export default [{
      name: 'directory-manifest',
      setup(build) {
        const root = join(import.meta.dirname, 'data');
        build.onResolve({ filter: /^manifest$/ }, () => ({ path: 'manifest', namespace: 'manifest' }));
        build.onLoad({ filter: /.*/, namespace: 'manifest' }, async () => {
          const directories = [root];
          const files = [];
          for (const directory of directories) {
            for (const entry of await readdir(directory, { withFileTypes: true })) {
              const path = join(directory, entry.name);
              if (entry.isDirectory()) directories.push(path);
              else files.push(path.slice(root.length + 1).replaceAll('\\\\', '/'));
            }
          }
          return { contents: 'export default ' + JSON.stringify(files.sort().join(',')), loader: 'js', watchDirs: directories };
        });
      },
    }];
  `,
  files: {
    "data/a.txt": "a",
    "routes/index.ts": `import manifest from 'manifest'; export default () => new Response(manifest);`,
  },
  async test(dev) {
    await dev.fetch("/").equals("a.txt");
    await dev.write("data/b.txt", "b");
    await dev.fetch("/").equals("a.txt,b.txt");
    {
      await using batch = await dev.batchChanges();
      dev.mkdir("data/nested");
      await dev.write("data/nested/c.txt", "c");
    }
    await dev.fetch("/").equals("a.txt,b.txt,nested/c.txt");
    await dev.delete("data/nested/c.txt");
    await dev.fetch("/").equals("a.txt,b.txt");
  },
});

devTest("watchDirs follows a deleted or renamed directory when its path is recreated", {
  // Windows rejects renaming ancestors of directories with open watch handles.
  skip: ["win32"],
  framework: minimalFramework,
  pluginFile: `
    import { join } from 'node:path';
    import { readdir } from 'node:fs/promises';
    export default [{
      name: 'recover-directory-manifest',
      setup(build) {
        const root = join(import.meta.dirname, 'data');
        build.onResolve({ filter: /^manifest$/ }, () => ({ path: 'manifest', namespace: 'manifest' }));
        build.onLoad({ filter: /.*/, namespace: 'manifest' }, async () => {
          const directories = [root];
          const files = [];
          for (const directory of directories) {
            let entries;
            try {
              entries = await readdir(directory, { withFileTypes: true });
            } catch (error) {
              if (error.code !== 'ENOENT') {
                throw error;
              }
              continue;
            }
            for (const entry of entries) {
              const path = join(directory, entry.name);
              if (entry.isDirectory()) {
                directories.push(path);
              } else {
                files.push(path.slice(root.length + 1).replaceAll('\\\\', '/'));
              }
            }
          }
          return { contents: 'export default ' + JSON.stringify(files.sort().join(',') || '(missing)'), loader: 'js', watchDirs: directories };
        });
      },
    }];
  `,
  files: {
    "data/old/a.txt": "a",
    "routes/index.ts": `import manifest from 'manifest'; export default () => new Response(manifest);`,
  },
  async test(dev) {
    await dev.fetch("/").equals("old/a.txt");
    {
      await using batch = await dev.batchChanges();
      rmSync(dev.join("data"), { recursive: true });
    }
    await dev.fetch("/").equals("(missing)");
    {
      await using batch = await dev.batchChanges();
      dev.mkdir("data/new/nested");
      await dev.write("data/new/nested/b.txt", "b");
    }
    await dev.fetch("/").equals("new/nested/b.txt");
    await dev.write("data/new/nested/c.txt", "c");
    await dev.fetch("/").equals("new/nested/b.txt,new/nested/c.txt");
    {
      await using batch = await dev.batchChanges();
      renameSync(dev.join("data"), dev.join("moved-data"));
    }
    await dev.fetch("/").equals("(missing)");
    {
      await using batch = await dev.batchChanges();
      dev.mkdir("data/replacement");
      await dev.write("data/replacement/d.txt", "d");
    }
    await dev.fetch("/").equals("replacement/d.txt");
    await dev.delete("data/replacement/d.txt");
    await dev.fetch("/").equals("(missing)");
    await dev.write("data/replacement/e.txt", "e");
    await dev.fetch("/").equals("replacement/e.txt");
  },
});

devTest("watchDirs follows a renamed leaf directory when its path is recreated", {
  framework: minimalFramework,
  pluginFile: `
    import { join } from 'node:path';
    import { readdir } from 'node:fs/promises';
    const root = join(import.meta.dirname, 'data');
    export default [{
      name: 'leaf-manifest',
      setup(build) {
        build.onResolve({ filter: /^leaf-manifest$/ }, () => ({ path: 'manifest', namespace: 'leaf-manifest' }));
        build.onLoad({ filter: /.*/, namespace: 'leaf-manifest' }, async () => {
          let files = [];
          try {
            files = await readdir(root);
          } catch (error) {
            if (error.code !== 'ENOENT') {
              throw error;
            }
          }
          return { contents: 'export default ' + JSON.stringify(files.sort().join(',') || '(missing)'), loader: 'js', watchDirs: [root] };
        });
      },
    }];
  `,
  files: {
    "data/a.txt": "a",
    "routes/index.ts": `import manifest from 'leaf-manifest'; export default () => new Response(manifest);`,
  },
  async test(dev) {
    await dev.fetch("/").equals("a.txt");
    {
      await using batch = await dev.batchChanges();
      renameSync(dev.join("data"), dev.join("moved-data"));
    }
    await dev.fetch("/").equals("(missing)");
    {
      await using batch = await dev.batchChanges();
      dev.mkdir("data");
      await dev.write("data/b.txt", "b");
    }
    await dev.fetch("/").equals("b.txt");
    await dev.write("data/c.txt", "c");
    await dev.fetch("/").equals("b.txt,c.txt");
    await dev.delete("data/b.txt");
    await dev.fetch("/").equals("c.txt");
  },
});

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
