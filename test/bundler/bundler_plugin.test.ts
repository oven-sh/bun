import { describe, expect } from "bun:test";
import path, { dirname, join, resolve } from "node:path";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  const loadFixture = {
    "index.ts": /* ts */ `
      import { foo } from "./foo.magic";
      console.log(foo);
    `,
    "foo.magic": `
      hello world
    `,
    "another_file.ts": `
      export const foo = "foo";
    `,
  };
  const resolveFixture = {
    "index.ts": /* ts */ `
      import { foo } from "./foo.magic";
      console.log(foo);
    `,
    "foo.ts": /* ts */ `
      export const foo = "foo";
    `,
  };

  itBundled("plugin/Resolve", {
    files: resolveFixture,
    // The bundler testing api has a shorthand where the plugins array can be
    // the `setup` function of one plugin.
    plugins(builder) {
      builder.onResolve({ filter: /\.magic$/ }, args => {
        return {
          path: resolve(dirname(args.importer), args.path.replace(/\.magic$/, ".ts")),
        };
      });
    },
    run: {
      stdout: "foo",
    },
  });
  itBundled("plugin/Load", {
    files: loadFixture,
    plugins(builder) {
      builder.onLoad({ filter: /\.magic$/ }, async args => {
        const text = await Bun.file(args.path).text();
        return {
          contents: `export const foo = ${JSON.stringify(text.toUpperCase())};`,
          loader: "ts",
        };
      });
    },
    run: {
      stdout: "HELLO WORLD",
    },
  });
  itBundled("plugin/LoadImplicitLoader", {
    files: loadFixture,
    plugins(builder) {
      builder.onLoad({ filter: /\.magic$/ }, async args => {
        const text = await Bun.file(args.path).text();
        return {
          contents: `export const foo = ${JSON.stringify(text.toUpperCase())};`,
        };
      });
    },
    run: {
      stdout: "HELLO WORLD",
    },
  });

  // Load Plugin Errors
  itBundled("plugin/LoadThrow", {
    files: loadFixture,
    plugins(builder) {
      builder.onLoad({ filter: /\.magic$/ }, args => {
        throw new Error("error here");
      });
    },
    bundleErrors: {
      "/foo.magic": [`error here`],
    },
  });
  itBundled("plugin/LoadThrowPrimative", {
    files: loadFixture,
    plugins(builder) {
      builder.onLoad({ filter: /\.magic$/ }, args => {
        throw "123";
      });
    },
    bundleErrors: {
      "/foo.magic": [`123`],
    },
  });
  itBundled("plugin/LoadThrowAsync", {
    files: loadFixture,
    plugins(builder) {
      builder.onLoad({ filter: /\.magic$/ }, async args => {
        throw new Error("error here");
      });
    },
    bundleErrors: {
      "/foo.magic": [`error here`],
    },
  });
  itBundled("plugin/LoadThrowPrimativeAsync", {
    files: loadFixture,
    plugins(builder) {
      builder.onLoad({ filter: /\.magic$/ }, async args => {
        throw 123;
      });
    },
    bundleErrors: {
      "/foo.magic": [`123`],
    },
  });
  itBundled("plugin/ResolveAndLoadDefaultExport", {
    files: {
      "index.ts": /* ts */ `
      import foo from "./foo.magic";
      console.log(foo);
    `,
      "foo.magic": `
      hello world
    `,
    },
    plugins(builder) {
      builder.onResolve({ filter: /\.magic$/ }, async args => {
        return {
          path: path.resolve(args.importer, args.path),
        };
      });
      builder.onLoad({ filter: /\.magic$/ }, async args => {
        return {
          contents: `export default "foo";`,
          loader: "js",
        };
      });
    },
    run: {
      stdout: "foo",
    },
  });

  for (const value of [null, undefined, true, 1, "string", {} as never]) {
    const str = JSON.stringify(value) ?? "undefined";
    itBundled(`plugin/ResolveEntryPointReturns${str.charAt(0).toUpperCase() + str.slice(1)}`, {
      files: {
        "index.ts": /* ts */ `
          console.log("hello world");
        `,
      },
      plugins(builder) {
        builder.onResolve({ filter: /.*/ }, () => {
          return value as never;
        });
      },
      run: {
        stdout: "hello world",
      },
    });
  }

  // Load Plugin Errors
  itBundled("plugin/ResolveThrow", {
    files: resolveFixture,
    plugins(builder) {
      builder.onResolve({ filter: /\.magic$/ }, args => {
        throw new Error("error here");
      });
    },
    bundleErrors: {
      "/index.ts": [`error here`],
    },
  });
  itBundled("plugin/ResolveThrowPrimative", {
    files: resolveFixture,
    plugins(builder) {
      builder.onResolve({ filter: /\.magic$/ }, args => {
        throw "123";
      });
    },
    bundleErrors: {
      "/index.ts": [`123`],
    },
  });
  itBundled("plugin/ResolveThrowAsync", {
    files: resolveFixture,
    plugins(builder) {
      builder.onResolve({ filter: /\.magic$/ }, async args => {
        throw new Error("error here");
      });
    },
    bundleErrors: {
      "/index.ts": [`error here`],
    },
  });
  itBundled("plugin/ResolveThrowPrimativeAsync", {
    files: resolveFixture,
    plugins(builder) {
      builder.onResolve({ filter: /\.magic$/ }, async args => {
        throw 123;
      });
    },
    bundleErrors: {
      "/index.ts": [`123`],
    },
  });

  //
  itBundled("plugin/ResolvePrefix", ({ root }) => {
    let onResolveCount = 0;

    return {
      files: {
        "index.ts": /* ts */ `
        import * as foo from "magic:some_string";
        import * as bar from "./other_file.ts";
        console.log(foo.foo, bar.bar);
      `,
        "foo.ts": /* ts */ `
        export const foo = "foo";
      `,
        "other_file.ts": /* ts */ `
        export const bar = "bar";
      `,
      },
      plugins(builder) {
        builder.onResolve({ filter: /.*/, namespace: "magic" }, args => {
          throw new Error("should not be called. magic: does not make this a namespace");
        });
        builder.onResolve({ filter: /^magic:.*/ }, args => {
          expect(args.path).toBe("magic:some_string");
          expect(args.importer).toBe(root + "/index.ts");
          expect(args.namespace).toBe("file");
          expect(args.kind).toBe("import-statement");
          onResolveCount++;

          return {
            path: path.resolve(path.dirname(args.importer), "foo.ts"),
          };
        });
      },
      run: {
        stdout: "foo bar",
      },
      onAfterBundle(api) {
        expect(onResolveCount).toBe(1);
      },
    };
  });
  itBundled("plugin/ResolveNamespaceFilterIgnored", ({ root }) => {
    let onResolveCountBad = 0;

    return {
      files: {
        "index.ts": /* ts */ `
          import * as foo from "magic:some_string";
          import * as bar from "./other_file.ts";
          console.log(foo.foo, bar.bar);
        `,
        "foo.ts": /* ts */ `
          export const foo = "foo";
        `,
        "other_file.ts": /* ts */ `
          export const bar = "bar";
        `,
      },
      plugins(builder) {
        // this was being called when it shouldnt
        builder.onResolve({ filter: /.*/, namespace: "magic" }, () => {
          onResolveCountBad++;
          return null as never;
        });
        builder.onResolve({ filter: /magic:some_string/, namespace: "magic" }, () => {
          onResolveCountBad++;
          return null as never;
        });
        builder.onResolve({ filter: /magic:some_string/ }, args => {
          return {
            path: path.resolve(path.dirname(args.importer), "foo.ts"),
          };
        });
      },
      run: {
        stdout: "foo bar",
      },
      onAfterBundle(api) {
        try {
          expect(onResolveCountBad).toBe(0);
        } catch (error) {
          console.error(
            "resolve plugins with namespace constraint should not be called when the namespace is not matched, even if prefix like `magic:`",
          );
          throw error;
        }
      },
    };
  });
  itBundled("plugin/ResolveAndLoadNamespace", ({ root }) => {
    return {
      files: {
        "index.ts": /* ts */ `
          import * as foo from "magic:some_string";
          console.log(foo.foo);
        `,
      },
      plugins(builder) {
        builder.onResolve({ filter: /magic:some_string/ }, args => {
          return {
            path: "namespace_path",
            namespace: "my_namespace",
          };
        });
        // the path given is already resolved, so it should not re-resolve
        builder.onResolve({ filter: /namespace_path/, namespace: "my_namespace" }, args => {
          throw new Error("SHOULD NOT BE CALLED");
        });
        builder.onResolve({ filter: /namespace_path/ }, args => {
          throw new Error("SHOULD NOT BE CALLED");
        });
        builder.onLoad({ filter: /namespace_path/, namespace: "my_namespace" }, args => {
          expect(args.path).toBe("namespace_path");
          expect(args.namespace).toBe("my_namespace");

          return {
            contents: "export const foo = 'foo';",
            loader: "js",
          };
        });
        builder.onLoad({ filter: /.*/, namespace: "my_namespace" }, args => {
          throw new Error("SHOULD NOT BE CALLED");
        });
      },
      run: {
        stdout: "foo",
      },
    };
  });
  itBundled("plugin/ResolveAndLoadNamespaceNested", ({ root }) => {
    let counter1 = 0;
    let counter2 = 0;
    return {
      todo: true,
      files: {
        "index.ts": /* ts */ `
          import * as foo from "magic:some_string";
          console.log(foo.foo);
        `,
        "foo.ts": /* ts */ `
          export const foo = "foo";
        `,
      },
      plugins(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          counter1++;
        });
        builder.onResolve({ filter: /magic:some_string/ }, args => {
          return {
            path: "namespace_path",
            namespace: "my_namespace",
          };
        });
        // the path given is already resolved, so it should not re-resolve
        builder.onResolve({ filter: /namespace_path/, namespace: "my_namespace" }, args => {
          throw new Error("SHOULD NOT BE CALLED 1, " + JSON.stringify(args));
        });
        builder.onResolve({ filter: /namespace_path/ }, args => {
          throw new Error("SHOULD NOT BE CALLED 2, " + JSON.stringify(args));
        });
        // load
        builder.onLoad({ filter: /.*/, namespace: "my_namespace" }, args => {
          expect(args.path).toBe("namespace_path");
          expect(args.namespace).toBe("my_namespace");

          return {
            contents: "import 'nested_import';export const foo = 'foo';",
            loader: "js",
          };
        });
        // nested_import should not be resolved as a file namespace
        builder.onResolve({ filter: /nested_import/, namespace: "file" }, args => {
          throw new Error("SHOULD NOT BE CALLED 3, " + JSON.stringify(args));
        });
        builder.onResolve({ filter: /nested_import/, namespace: "my_namespace" }, args => {
          expect(args.path).toBe("nested_import");
          expect(args.namespace).toBe("my_namespace");
          // gonna let this passthrough
          counter2 += 1;
        });
        // but it can be resolved with no namespace filter
        builder.onResolve({ filter: /nested_import/ }, args => {
          expect(args.path).toBe("nested_import");
          expect(args.namespace).toBe("my_namespace");
          return {
            path: root + "/foo.ts",
            namespace: "file",
          };
        });
        builder.onResolve({ filter: /.*/ }, args => {
          // entrypoint should hit this but this is a catch all
          if (args.kind === "import-statement") {
            throw new Error("SHOULD NOT BE CALLED 4, " + JSON.stringify(args));
          }
        });
      },
      run: {
        stdout: "foo",
      },
      onAfterBundle(api) {
        expect(counter1).toBe(3);
        expect(counter2).toBe(1);
      },
    };
  });
  itBundled("plugin/ResolveOverrideFile", ({ root }) => {
    return {
      files: {
        "index.ts": /* ts */ `
          import * as foo from "./foo.ts";
          console.log(foo.foo);
        `,
        "foo.ts": /* ts */ `
          export const foo = "FAILED";
        `,
        "bar.ts": /* ts */ `
          export const foo = "foo";
        `,
      },
      plugins(builder) {
        builder.onResolve({ filter: /foo.ts$/ }, args => {
          return {
            path: root + "/bar.ts",
          };
        });
      },
      run: {
        stdout: "foo",
      },
    };
  });
  itBundled("plugin/ResolveOnceWhenSameFile", ({ root }) => {
    let onResolveCount = 0;
    return {
      todo: true,
      files: {
        "index.ts": /* ts */ `
          import * as foo from "./foo.ts";
          import * as foo2 from "./foo.ts";
          console.log(foo.foo, foo2.foo);
        `,
        "foo.ts": /* ts */ `
          export const foo = "FAILED";
        `,
        "bar.ts": /* ts */ `
          export const foo = "this string should exist once";
        `,
      },
      plugins(builder) {
        builder.onResolve({ filter: /foo.ts$/ }, args => {
          onResolveCount++;
          return {
            path: root + "/bar.ts",
          };
        });
      },
      run: {
        stdout: "this string should exist once this string should exist once",
      },
      onAfterBundle(api) {
        expect(onResolveCount).toBe(1);
        const contents = api.readFile("/out.js");
        expect([...contents.matchAll(/this string should exist once/g)].length).toBe(1);
      },
    };
  });
  itBundled("plugin/ResolveTwoImportsSeparateFiles", ({ root }) => {
    let onResolveCount = 0;
    let importers: string[] = [];
    return {
      files: {
        "index.ts": /* ts */ `
          import * as foo from "./one.ts";
          import * as bar from "./two.ts";
          console.log(foo.foo, bar.bar);
        `,
        "one.ts": /* ts */ `
          import * as imported from "./foo.ts";
          export const foo = imported.foo;
        `,
        "two.ts": /* ts */ `
          import * as imported from "./foo.ts";
          export const bar = imported.foo;
        `,
        "bar.ts": /* ts */ `
          export const foo = "this string should exist once";
        `,
      },
      plugins(builder) {
        builder.onResolve({ filter: /foo.ts$/ }, args => {
          importers.push(args.importer);
          onResolveCount++;
          return {
            path: root + "/bar.ts",
          };
        });
      },
      run: {
        stdout: "this string should exist once this string should exist once",
      },
      onAfterBundle(api) {
        expect(importers.sort()).toEqual([root + "/one.ts", root + "/two.ts"].sort());
        expect(onResolveCount).toBe(2);
        const contents = api.readFile("/out.js");
        expect([...contents.matchAll(/this string should exist once/g)].length).toBe(1);
      },
    };
  });
  itBundled("plugin/ManyFiles", ({ root }) => {
    const FILES = process.platform === "win32" ? 50 : 200; // windows is slower at this
    const create = (fn: (i: number) => string) => new Array(FILES).fill(0).map((_, i) => fn(i));

    let onResolveCount = 0;
    let importers: string[] = [];
    return {
      files: {
        "index.ts": /* ts */ `
          ${create(i => `import * as foo${i} from "./${i}.magic";`).join("\n")}
          ${create(i => `console.log(foo${i}.foo);`).join("\n")}
        `,
      },
      plugins(builder) {
        builder.onResolve({ filter: /\.magic$/ }, async args => {
          importers.push(args.importer);
          onResolveCount++;
          return {
            path: args.path,
            namespace: "magic",
          };
        });
        builder.onLoad({ filter: /\.magic$/, namespace: "magic" }, async args => {
          return {
            contents: `export const foo = "${args.path}";`,
            loader: "js",
          };
        });
      },
      run: {
        stdout: create(i => `./${i}.magic`).join("\n"),
      },
      onAfterBundle(api) {},
    };
  });
  itBundled("plugin/TwoPluginBug", ({ root }) => {
    return {
      files: {
        "index.ts": /* ts */ `
          import { foo } from "plugin1";
          console.log(foo);
        `,
      },
      plugins: [
        {
          name: "1",
          setup(builder) {
            builder.onResolve({ filter: /plugin1/ }, args => {
              return {
                path: "plugin1",
                namespace: "plugin1",
              };
            });
            builder.onLoad({ filter: /plugin1/, namespace: "plugin1" }, args => {
              return {
                contents: "export * from 'plugin2';",
                loader: "js",
              };
            });
          },
        },
        {
          name: "2",
          setup(builder) {
            builder.onResolve({ filter: /plugin2/ }, args => {
              return {
                path: "plugin2",
                namespace: "plugin2",
              };
            });
            builder.onLoad({ filter: /plugin2/, namespace: "plugin2" }, args => {
              return {
                contents: "export const foo = 'foo';",
                loader: "js",
              };
            });
          },
        },
      ],
      run: {
        stdout: "foo",
      },
    };
  });
  itBundled("plugin/LoadCalledOnce", ({ root }) => {
    let resolveCount = 0;
    let loadCount = 0;
    return {
      files: {
        "index.ts": /* ts */ `
          import { foo } from "plugin:first";
          import { foo as foo2 } from "plugin:second";
          import { foo as foo3 } from "plugin:third";
          console.log(foo === foo2, foo === foo3);
        `,
      },
      plugins: [
        {
          name: "1",
          setup(builder) {
            builder.onResolve({ filter: /^plugin:/ }, args => {
              resolveCount++;
              return {
                path: "plugin",
                namespace: "plugin",
              };
            });
            builder.onLoad({ filter: /^plugin$/, namespace: "plugin" }, args => {
              loadCount++;
              return {
                contents: "export const foo = { };",
                loader: "js",
              };
            });
          },
        },
      ],
      run: {
        stdout: "true true",
      },
      onAfterBundle(api) {
        expect(resolveCount).toBe(3);
        expect(loadCount).toBe(1);
      },
    };
  });
  itBundled("plugin/ResolveManySegfault", ({ root }) => {
    let resolveCount = 0;
    let loadCount = 0;
    return {
      files: {
        "index.ts": /* ts */ `
          import { foo as foo1 } from "plugin:100";
          console.log(foo1);
        `,
      },
      plugins: [
        {
          name: "1",
          setup(builder) {
            builder.onResolve({ filter: /^plugin:/ }, args => {
              resolveCount++;
              return {
                path: args.path,
                namespace: "plugin",
              };
            });
            builder.onLoad({ filter: /^plugin:/, namespace: "plugin" }, args => {
              loadCount++;
              const number = parseInt(args.path.replace("plugin:", ""));
              if (number > 1) {
                const numberOfImports = number > 100 ? 100 : number;
                const imports = Array.from({ length: numberOfImports })
                  .map((_, i) => `import { foo as foo${i} } from "plugin:${number - i - 1}";`)
                  .join("\n");
                const exports = `export const foo = ${Array.from({ length: numberOfImports })
                  .map((_, i) => `foo${i}`)
                  .join(" + ")};`;
                return {
                  contents: `${imports}\n${exports}`,
                  loader: "js",
                };
              } else {
                return {
                  contents: `export const foo = 1;`,
                  loader: "js",
                };
              }
            });
          },
        },
      ],
      run: true,
      onAfterBundle(api) {
        expect(resolveCount).toBe(5050);
        expect(loadCount).toBe(101);
      },
      timeoutScale: 3,
    };
  });
  // itBundled("plugin/ManyPlugins", ({ root }) => {
  //   const pluginCount = 4000;
  //   let resolveCount = 0;
  //   let loadCount = 0;
  //   return {
  //     files: {
  //       "index.ts": /* ts */ `
  //         import { foo as foo1 } from "plugin1:file";
  //         import { foo as foo2 } from "plugin4000:file";
  //         console.log(foo1, foo2);
  //       `,
  //     },
  //     plugins: Array.from({ length: pluginCount }).map((_, i) => ({
  //       name: `${i}`,
  //       setup(builder) {
  //         builder.onResolve({ filter: new RegExp(`^plugin${i}:file$`) }, args => {
  //           resolveCount++;
  //           return {
  //             path: `plugin${i}:file`,
  //             namespace: `plugin${i}`,
  //           };
  //         });
  //         builder.onLoad({ filter: new RegExp(`^plugin${i}:file$`), namespace: `plugin${i}` }, args => {
  //           loadCount++;
  //           return {
  //             contents: `export const foo = ${i};`,
  //             loader: "js",
  //           };
  //         });
  //       },
  //     })),
  //     run: {
  //       stdout: `${pluginCount - 1} ${pluginCount - 1}`,
  //     },
  //     onAfterBundle(api) {
  //       expect(resolveCount).toBe(pluginCount * 2);
  //       expect(loadCount).toBe(pluginCount);
  //     },
  //   };
  // });
  itBundled("plugin/NamespaceOnLoadBug", () => {
    return {
      files: {
        "index.ts": /* ts */ `
          import { foo } from "plugin:file";
          console.log(foo);
        `,
      },
      plugins(build) {
        build.onResolve({ filter: /^plugin:/ }, args => {
          return {
            path: args.path,
            namespace: "this",
          };
        });
        build.onLoad({ filter: /.*/, namespace: "that" }, args => {
          return {
            contents: "export const foo = 'FAILED';",
            loader: "js",
          };
        });
        build.onLoad({ filter: /.*/, namespace: "this" }, args => {
          return {
            contents: `export const foo = '${args.namespace}';`,
            loader: "js",
          };
        });
      },
    };
  });
  itBundled("plugin/EntrypointResolve", ({ root }) => {
    return {
      todo: true,
      files: {},
      entryPointsRaw: ["plugin"],
      plugins(build) {
        build.onResolve({ filter: /^plugin$/ }, args => {
          expect(args.path).toBe("plugin");
          expect(args.importer).toBe("");
          expect(args.kind).toBe("entry-point-build");
          expect(args.namespace).toBe("");
          // expect(args.pluginData).toEqual(undefined);
          // expect(args.resolveDir).toEqual(root);
          return {
            path: args.path,
            namespace: "plugin",
          };
        });
        build.onLoad({ filter: /.*/, namespace: "plugin" }, args => {
          console.log(args);
          return {
            contents: `console.log("it works")`,
          };
        });
      },
      run: {
        file: "./out/plugin.js",
        stdout: "it works",
      },
    };
  });
  itBundled("plugin/Options", ({ getConfigRef }) => {
    return {
      files: {
        "index.ts": /* ts */ `
          console.log("it works");
        `,
      },
      entryPoints: ["./index.ts"],
      plugins(build) {
        expect(build.config).toBe(getConfigRef());
      },
    };
  });
  itBundled("plugin/ESBuildInitialOptions", ({ root }) => {
    return {
      files: {
        "index.ts": /* ts */ `
          console.log("it works");
        `,
      },
      external: ["esbuild"],
      entryPoints: ["./index.ts"],
      backend: "api",
      plugins(build) {
        const opts = (build as any).initialOptions;
        expect(opts.bundle).toEqual(true);
        expect(opts.entryPoints).toEqual([join(root, "index.ts")]);
        expect(opts.external).toEqual(["esbuild"]);
        expect(opts.format).toEqual("esm");
        expect(opts.minify).toEqual(false);
        expect(opts.minifyIdentifiers).toEqual(undefined);
        expect(opts.minifySyntax).toEqual(undefined);
        expect(opts.minifyWhitespace).toEqual(undefined);
        expect(opts.outdir).toEqual(root);
        expect(opts.platform).toEqual("browser");
        expect(opts.sourcemap).toEqual(undefined);
      },
    };
  });

  itBundled("plugin/FileLoaderWithCustomContents", {
    files: {
      "index.html": /* html */ `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>
            <img src="./image.jpeg" />
            <script src="./script.js"></script>
          </body>
        </html>
      `,
      "script.js": /* js */ `
        console.log("Script loaded");
      `,
      "image.jpeg": "actual image data would be here",
    },
    entryPoints: ["./index.html"],
    outdir: "/out",
    plugins(build) {
      // This plugin intercepts .jpeg files and returns them with custom contents
      // This previously caused a crash because additional_files wasn't populated
      build.onLoad({ filter: /\.jpe?g$/ }, async args => {
        return {
          loader: "file",
          contents: "custom image contents",
        };
      });
    },
    onAfterBundle(api) {
      // Verify the build succeeded and files were created
      api.assertFileExists("index.html");
      // The image should be copied with a hashed name
      const html = api.readFile("index.html");
      expect(html).toContain('src="');
      expect(html).toContain('.jpeg"');
    },
  });

  itBundled("plugin/FileLoaderMultipleAssets", {
    files: {
      "index.js": /* js */ `
        import imgUrl from "./image.png";
        import wasmUrl from "./module.wasm";
        console.log(imgUrl, wasmUrl);
      `,
      "image.png": "png data",
      "module.wasm": "wasm data",
    },
    entryPoints: ["./index.js"],
    outdir: "/out",
    plugins(build) {
      // Test multiple file types with custom contents
      build.onLoad({ filter: /\.(png|wasm)$/ }, async args => {
        const ext = args.path.split(".").pop();
        return {
          loader: "file",
          contents: `custom ${ext} contents`,
        };
      });
    },
    run: {
      stdout: /\.(png|wasm)/,
    },
    onAfterBundle(api) {
      // Verify the build succeeded and files were created
      api.assertFileExists("index.js");
      const js = api.readFile("index.js");
      // Should contain references to the copied files
      expect(js).toContain('.png"');
      expect(js).toContain('.wasm"');
    },
  });

  itBundled("plugin/OnEndBasic", ({ root }) => {
    let onEndCalled = false;

    return {
      files: {
        "index.ts": `
          console.log("Hello from main");
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(() => {
          onEndCalled = true;
        });
      },
      onAfterBundle(api) {
        expect(onEndCalled).toBe(true);
        expect(api.readFile("out/index.js")).toContain("Hello from main");
      },
    };
  });

  itBundled("plugin/OnEndMultipleCallbacks", ({ root }) => {
    const callOrder: string[] = [];

    return {
      files: {
        "index.ts": /* ts */ `
          export const value = 42;
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(() => {
          callOrder.push("first");
        });

        builder.onEnd(() => {
          callOrder.push("second");
        });

        builder.onEnd(() => {
          callOrder.push("third");
        });
      },
      onAfterBundle(api) {
        expect(callOrder).toEqual(["first", "second", "third"]);
        expect(api.readFile("out/index.js")).toContain("42");
      },
    };
  });

  itBundled("plugin/OnEndWithAsyncCallback", ({ root }) => {
    let asyncCompleted = false;

    return {
      files: {
        "index.ts": /* ts */ `
          export default "async test";
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          asyncCompleted = true;
        });
      },
      onAfterBundle(api) {
        expect(asyncCompleted).toBe(true);
        expect(api.readFile("out/index.js")).toContain("async test");
      },
    };
  });

  itBundled("plugin/OnEndWithMultiplePlugins", ({ root }) => {
    const events: string[] = [];

    return {
      files: {
        "index.ts": /* ts */ `
          import "./module.js";
          console.log("main");
        `,
        "module.js": /* js */ `
          console.log("module");
        `,
      },
      outdir: "/out",
      plugins: [
        {
          name: "plugin1",
          setup(builder) {
            builder.onEnd(() => {
              events.push("plugin1-end");
            });
          },
        },
        {
          name: "plugin2",
          setup(builder) {
            builder.onEnd(() => {
              events.push("plugin2-end");
            });
          },
        },
      ],
      onAfterBundle(api) {
        expect(events).toContain("plugin1-end");
        expect(events).toContain("plugin2-end");
        expect(api.readFile("out/index.js")).toContain("main");
        expect(api.readFile("out/index.js")).toContain("module");
      },
    };
  });

  itBundled("plugin/OnEndWithBuildResult", () => {
    let buildResult: Bun.BuildOutput | null = null;
    let callbackExecuted = false;

    return {
      files: {
        "index.ts": /* ts */ `
          export const result = "success";
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(result => {
          callbackExecuted = true;
          buildResult = result;
        });
      },
      onAfterBundle(api) {
        expect(callbackExecuted).toBe(true);
        expect(buildResult).toBeDefined();
        expect(buildResult!.outputs).toBeDefined();
        expect(Array.isArray(buildResult!.outputs)).toBe(true);
        expect(api.readFile("out/index.js")).toContain("success");
      },
    };
  });

  itBundled("plugin/OnEndWithFileWrite", ({ root }) => {
    let fileWritten = false;

    return {
      files: {
        "index.ts": /* ts */ `
          export const data = { version: "1.0.0" };
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(async () => {
          const metadata = {
            buildTime: new Date().toISOString(),
            files: ["index.js"],
          };
          await Bun.write(join(root, "out", "build-metadata.json"), JSON.stringify(metadata, null, 2));
          fileWritten = true;
        });
      },
      onAfterBundle(api) {
        expect(fileWritten).toBe(true);
        expect(api.readFile("out/index.js")).toContain("1.0.0");
        // Check if metadata file was created
        api.assertFileExists("out/build-metadata.json");
        const metadata = JSON.parse(api.readFile("out/build-metadata.json"));
        expect(metadata.files).toEqual(["index.js"]);
        expect(metadata.buildTime).toBeDefined();
      },
    };
  });

  itBundled("plugin/OnEndWithThrowOnErrorTrue", ({ root }) => {
    let onEndCalled = false;
    let onEndCalledBeforePromiseResolved = false;

    return {
      files: {
        "index.ts": `
          // This will cause a build error
          import { nonExistent } from "./does-not-exist";
          console.log(nonExistent);
        `,
      },
      outdir: "/out",
      throw: true,
      bundleErrors: {
        "/index.ts": [`Could not resolve: "./does-not-exist"`],
      },
      plugins(builder) {
        builder.onEnd(result => {
          onEndCalled = true;
          expect(result.success).toBe(false);
          expect(result.logs).toBeDefined();
          expect(result.logs.length).toBeGreaterThan(0);
        });
      },
      onAfterBundle() {
        expect(onEndCalled).toBe(true);
        expect(onEndCalledBeforePromiseResolved).toBe(true);
      },
    };
  });

  itBundled("plugin/OnEndWithThrowOnErrorFalse", ({ root }) => {
    let onEndCalled = false;
    let onEndCalledBeforePromiseResolved = false;
    let promiseResolved = false;

    return {
      files: {
        "index.ts": `
          // This will cause a build error
          import { nonExistent } from "./does-not-exist";
          console.log(nonExistent);
        `,
      },
      outdir: "/out",
      throw: false,
      bundleErrors: {
        "/index.ts": [`Could not resolve: "./does-not-exist"`],
      },
      plugins(builder) {
        builder.onEnd(result => {
          onEndCalled = true;
          // Check that promise hasn't resolved yet
          onEndCalledBeforePromiseResolved = !promiseResolved;
          // Result should contain errors
          expect(result.success).toBe(false);
          expect(result.logs).toBeDefined();
          expect(result.logs.length).toBeGreaterThan(0);
        });
      },
      onAfterBundle(api) {
        promiseResolved = true;
        // Verify onEnd was called before the promise resolved
        expect(onEndCalled).toBe(true);
        expect(onEndCalledBeforePromiseResolved).toBe(true);
      },
    };
  });

  itBundled("plugin/OnEndAlwaysFiresOnSuccess", ({ root }) => {
    let onEndCalled = false;
    let onEndCalledBeforePromiseResolved = false;
    let promiseResolved = false;

    return {
      files: {
        "index.ts": `
          export const success = true;
          console.log("Build successful");
        `,
      },
      outdir: "/out",
      throw: true, // Doesn't matter since build will succeed
      plugins(builder) {
        builder.onEnd(result => {
          onEndCalled = true;
          // Check that promise hasn't resolved yet
          onEndCalledBeforePromiseResolved = !promiseResolved;
          // Result should indicate success
          expect(result.success).toBe(true);
          expect(result.outputs).toBeDefined();
          expect(result.outputs.length).toBeGreaterThan(0);
        });
      },
      onAfterBundle(api) {
        promiseResolved = true;
        // Verify onEnd was called before the promise resolved
        expect(onEndCalled).toBe(true);
        expect(onEndCalledBeforePromiseResolved).toBe(true);
        expect(api.readFile("out/index.js")).toContain("Build successful");
      },
    };
  });

  itBundled("plugin/OnEndMultipleCallbacksWithError", ({ root }) => {
    const callOrder: string[] = [];
    let promiseResolved = false;

    return {
      files: {
        "index.ts": `
          // This will cause a build error
          import { missing } from "./missing-module";
        `,
      },
      outdir: "/out",
      throw: false, // Let the build continue so we can check callbacks
      plugins(builder) {
        builder.onEnd(() => {
          callOrder.push("first");
          expect(promiseResolved).toBe(false);
        });
        builder.onEnd(() => {
          callOrder.push("second");
          expect(promiseResolved).toBe(false);
        });
        builder.onEnd(() => {
          callOrder.push("third");
          expect(promiseResolved).toBe(false);
        });
      },
      onAfterBundle(api) {
        promiseResolved = true;
        expect(callOrder).toEqual(["first", "second", "third"]);
      },
    };
  });

  itBundled("plugin/OnEndBuildFailsThrowsSync", () => {
    let onEndCalled = false;
    let onEndError: Error | null = null;

    return {
      files: {
        "index.ts": `
          import { missing } from "./does-not-exist.ts";
          console.log(missing);
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(() => {
          onEndCalled = true;
          onEndError = new Error("onEnd was called after build failure");
        });
      },
      bundleErrors: {
        "/index.ts": [`Could not resolve: "./does-not-exist.ts"`],
      },
      onAfterBundle(api) {
        expect(onEndCalled).toBe(true);
        expect(onEndError).toBeTruthy();
      },
    };
  });

  itBundled("plugin/OnEndBuildFailsThrowsAsyncMicrotask", () => {
    let onEndCalled = false;
    let asyncCompleted = false;

    return {
      files: {
        "index.ts": `
          import { missing } from "./does-not-exist.ts";
          console.log(missing);
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(async () => {
          onEndCalled = true;
          await Promise.resolve();
          asyncCompleted = true;
        });
      },
      bundleErrors: {
        "/index.ts": [`Could not resolve: "./does-not-exist.ts"`],
      },
      onAfterBundle(api) {
        expect(onEndCalled).toBe(true);
        expect(asyncCompleted).toBe(true);
      },
    };
  });

  itBundled("plugin/OnEndBuildFailsThrowsAsyncActual", () => {
    let onEndCalled = false;
    let asyncCompleted = false;

    return {
      files: {
        "index.ts": `
          import { missing } from "./does-not-exist.ts";
          console.log(missing);
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(async () => {
          onEndCalled = true;
          await Bun.sleep(0); // Actual async
          asyncCompleted = true;
        });
      },
      bundleErrors: {
        "/index.ts": [`Could not resolve: "./does-not-exist.ts"`],
      },
      onAfterBundle(api) {
        expect(onEndCalled).toBe(true);
        expect(asyncCompleted).toBe(true);
      },
    };
  });

  itBundled("plugin/OnEndBuildSucceedsThrowsAsyncMicrotask", () => {
    let onEndCalled = false;
    let asyncCompleted = false;

    return {
      files: {
        "index.ts": `
          console.log("Build succeeds");
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(async () => {
          onEndCalled = true;
          await Promise.resolve(); // Microtask
          // Test async microtask completion
          asyncCompleted = true;
        });
      },
      onAfterBundle(api) {
        expect(onEndCalled).toBe(true);
        expect(asyncCompleted).toBe(true);
        expect(api.readFile("out/index.js")).toContain("Build succeeds");
      },
    };
  });

  itBundled("plugin/OnEndBuildSucceedsThrowsAsyncActual", () => {
    let onEndCalled = false;
    let asyncCompleted = false;

    return {
      files: {
        "index.ts": `
          console.log("Build succeeds");
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(async () => {
          onEndCalled = true;
          await Bun.sleep(0); // Actual async
          // Test actual async completion
          asyncCompleted = true;
        });
      },
      onAfterBundle(api) {
        expect(onEndCalled).toBe(true);
        expect(asyncCompleted).toBe(true);
        expect(api.readFile("out/index.js")).toContain("Build succeeds");
      },
    };
  });

  itBundled("plugin/OnEndWithGCBeforeAwait", () => {
    let onEndCalled = false;

    return {
      files: {
        "index.ts": `
          console.log("Build succeeds");
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(async () => {
          onEndCalled = true;
          Bun.gc(true); // Force GC before await
          await Bun.sleep(0);
          Bun.gc(true); // Force GC after await
        });
      },
      onAfterBundle(api) {
        expect(onEndCalled).toBe(true);
        expect(api.readFile("out/index.js")).toContain("Build succeeds");
      },
    };
  });

  itBundled("plugin/OnEndMultipleMixedErrors", () => {
    const events: string[] = [];
    let errorCount = 0;

    return {
      files: {
        "index.ts": `
          console.log("Build succeeds");
        `,
      },
      outdir: "/out",
      throw: false,
      plugins(builder) {
        builder.onEnd(() => {
          events.push("first-success");
        });

        builder.onEnd(() => {
          events.push("second-throw");
          errorCount++;
          throw new Error("second callback error");
        });

        builder.onEnd(async () => {
          events.push("third-throw");
          await Promise.resolve();
          events.push("third-throw-after-await");
          errorCount++;
          throw new Error("third callback error");
        });

        builder.onEnd(() => {
          events.push("fourth-success");
        });

        builder.onEnd(async () => {
          events.push("fifth-throw");
          await Bun.sleep(0);
          // Shouldn't reach here, promise should have already rejected elsewhere
          events.push("fifth-throw-after-await");
          errorCount++;
          throw new Error("fifth callback error");
        });
      },
      bundleErrors: {
        "<bun>": ["second callback error"],
      },
      onAfterApiBundle(build) {
        expect(build.success).toBe(false);
        expect(events).toMatchInlineSnapshot(`
          [
            "first-success",
            "second-throw",
            "third-throw",
            "fourth-success",
            "fifth-throw",
            "third-throw-after-await",
          ]
        `);
        expect(errorCount).toBe(2);
      },
    };
  });

  itBundled("plugin/OnEndFirstThrowsRestRun", () => {
    const events: string[] = [];

    return {
      files: {
        "index.ts": `
          export const test = "multiple callbacks";
        `,
      },
      outdir: "/out",
      throw: false,
      plugins(builder) {
        builder.onEnd(() => {
          events.push("first");
          throw new Error("first callback error");
        });

        builder.onEnd(() => {
          events.push("second");
        });

        builder.onEnd(async () => {
          events.push("third");
          await Promise.resolve();
        });

        builder.onEnd(() => {
          events.push("fourth");
        });
      },
      bundleErrors: {
        "<bun>": ["first callback error"],
      },
      onAfterApiBundle(build) {
        expect(build.success).toBe(false);
        expect(events).toEqual(["first", "second", "third", "fourth"]);
      },
    };
  });

  itBundled("plugin/OnEndMultipleAsyncWithGC", () => {
    const events: string[] = [];

    return {
      files: {
        "index.ts": `
          export default "gc test";
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(async () => {
          events.push("first-start");
          Bun.gc(true);
          await Bun.sleep(0);
          events.push("first-end");
        });

        builder.onEnd(async () => {
          events.push("second-start");
          await Promise.resolve();
          Bun.gc(true);
          events.push("second-end");
        });

        builder.onEnd(async () => {
          events.push("third-start");
          Bun.gc(true);
          await Bun.sleep(0);
          Bun.gc(true);
          events.push("third-end");
        });
      },
      onAfterBundle(api) {
        expect(events).toEqual(["first-start", "second-start", "third-start", "second-end", "first-end", "third-end"]);
        expect(api.readFile("out/index.js")).toContain("gc test");
      },
    };
  });

  itBundled("plugin/OnEndMultipleCallbacksSomeThrow", () => {
    const events: string[] = [];

    return {
      files: {
        "index.ts": `
          // Build will succeed but some onEnd callbacks throw
          export const test = "multiple callbacks with errors";
        `,
      },
      outdir: "/out",
      throw: false,
      plugins(builder) {
        builder.onEnd(() => {
          events.push("first");
        });

        builder.onEnd(() => {
          events.push("second-throw");
          throw new Error("second throws");
        });

        builder.onEnd(async () => {
          events.push("third-async");
          await Bun.sleep(0);
          throw new Error("third throws async");
        });

        builder.onEnd(() => {
          events.push("fourth");
        });
      },
      bundleErrors: {
        "<bun>": ["second throws"],
      },
      onAfterApiBundle(build) {
        expect(build.success).toBe(false);
        expect(events).toEqual(["first", "second-throw", "third-async", "fourth"]);
      },
    };
  });

  itBundled("plugin/OnEndAsyncErrorsAreAwaited", () => {
    let asyncStarted = false;
    let asyncCompleted = false;

    return {
      files: {
        "index.ts": `
          export const test = "async error test";
        `,
      },
      outdir: "/out",
      plugins(builder) {
        builder.onEnd(async () => {
          asyncStarted = true;
          await Bun.sleep(5);
          asyncCompleted = true;
          throw new Error("async error after delay");
        });
      },
      bundleErrors: {
        "<bun>": ["async error after delay"],
      },
      onAfterApiBundle(build) {
        expect(build.success).toBe(false);
        expect(asyncStarted).toBe(true);
        expect(asyncCompleted).toBe(true);
      },
    };
  });
});
