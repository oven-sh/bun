import { describe, expect } from "bun:test";
import { dirname, join, resolve } from "node:path";
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
    todo: true,
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
    todo: true,
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
    todo: true,
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
    todo: true,
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
    todo: true,
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
    todo: true,
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

  // Load Plugin Errors
  itBundled("plugin/ResolveThrow", {
    todo: true,
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
    todo: true,
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
    todo: true,
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
    todo: true,
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
      todo: true,
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
      todo: true,
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
        builder.onResolve({ filter: /.*/, namespace: "magic" }, args => {
          onResolveCountBad++;
        });
        builder.onResolve({ filter: /magic:some_string/, namespace: "magic" }, args => {
          onResolveCountBad++;
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
      todo: true,
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
      todo: true,
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
      debugTimeoutScale: 3,
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
          expect(args.kind).toBe("entry-point");
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
      plugins(build) {
        const opts = (build as any).initialOptions;
        expect(opts.bundle).toEqual(true);
        expect(opts.entryPoints).toEqual([join(root, "index.ts")]);
        expect(opts.external).toEqual(["esbuild"]);
        expect(opts.format).toEqual(undefined);
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
});

describe("start", () => {
  {

let state: string = "Should not see this!";

itBundled("works", {
  experimentalCss: true,
  minifyWhitespace: true,
  files: {
    "/entry.css": /* css */ `
      body {
        background: white;
        color: blue; }
    `,
  },
  plugins: [
    {
      name: "demo",
      setup(build) {
        build.onStart(() => {
          state = "red";
        });

        build.onLoad({ filter: /\.css/ }, async ({ path }) => {
          console.log("[plugin] Path", path);
          return {
            contents: `body { color: ${state} }`,
            loader: "css",
          };
        });
      },
    },
  ],
  outfile: "/out.js",
  onAfterBundle(api) {
    api.expectFile("/out.js").toEqualIgnoringWhitespace(`body{color:${state}}`);
  },
});
}

{
type Action = "onLoad" | "onStart";
let actions: Action[] = [];

itBundled("executes before everything", {
  experimentalCss: true,
  minifyWhitespace: true,
  files: {
    "/entry.css": /* css */ `
      body {
        background: white;
        color: blue; }
    `,
  },
  plugins: [
    {
      name: "demo",
      setup(build) {
        build.onLoad({ filter: /\.css/ }, async ({ path }) => {
          actions.push("onLoad");
          return {
            contents: `body { color: red }`,
            loader: "css",
          };
        });

        build.onStart(() => {
          actions.push("onStart");
        });
      },
    },
  ],
  outfile: "/out.js",
  onAfterBundle(api) {
    api.expectFile("/out.js").toEqualIgnoringWhitespace(`body{ color: red }`);

    expect(actions).toStrictEqual(["onStart", "onLoad"]);
  },
});
}

{
let action: string[] = [];
itBundled("executes after all plugins have been setup", {
  experimentalCss: true,
  minifyWhitespace: true,
  files: {
    "/entry.css": /* css */ `
      body {
        background: white;
        color: blue; }
    `,
  },
  plugins: [
    {
      name: "onStart 1",
      setup(build) {
        build.onStart(async () => {
          action.push("onStart 1 setup");
          await Bun.sleep(1000);
          action.push("onStart 1 complete");
        });
      },
    },
    {
      name: "onStart 2",
      setup(build) {
        build.onStart(async () => {
          action.push("onStart 2 setup");
          await Bun.sleep(1000);
          action.push("onStart 2 complete");
        });
      },
    },
    {
      name: "onStart 3",
      setup(build) {
        build.onStart(async () => {
          action.push("onStart 3 setup");
          await Bun.sleep(1000);
          action.push("onStart 3 complete");
        });
      },
    },
  ],
  outfile: "/out.js",
  onAfterBundle(api) {
    expect(action.slice(0, 3)).toStrictEqual(["onStart 1 setup", "onStart 2 setup", "onStart 3 setup"]);
    expect(new Set(action.slice(3))).toStrictEqual(
      new Set(["onStart 1 complete", "onStart 2 complete", "onStart 3 complete"]),
    );
  },
});
}

{
let action: string[] = [];
test("LMAO", async () => {
  const folder = tempDirWithFiles("plz", {
    "index.ts": "export const foo = {}",
  });
  try {
    const result = await Bun.build({
      entrypoints: [path.join(folder, "index.ts")],
      experimentalCss: true,
      minify: true,
      plugins: [
        {
          name: "onStart 1",
          setup(build) {
            build.onStart(async () => {
              action.push("onStart 1 setup");
              throw new Error("WOOPS");
              // await Bun.sleep(1000);
            });
          },
        },
        {
          name: "onStart 2",
          setup(build) {
            build.onStart(async () => {
              action.push("onStart 2 setup");
              await Bun.sleep(1000);
              action.push("onStart 2 complete");
            });
          },
        },
        {
          name: "onStart 3",
          setup(build) {
            build.onStart(async () => {
              action.push("onStart 3 setup");
              await Bun.sleep(1000);
              action.push("onStart 3 complete");
            });
          },
        },
      ],
    });
    console.log(result);
  } catch (err) {
    expect(err).toBeDefined();
    return;
  }
  throw new Error("DIDNT GET ERRROR!");
});
}
});

describe("defer", () => {
{
type Action = {
  type: "load" | "defer";
  path: string;
};
let actions: Action[] = [];
function logLoad(path: string) {
  actions.push({ type: "load", path: path.replaceAll("\\", "/") });
}
function logDefer(path: string) {
  actions.push({ type: "defer", path: path.replaceAll("\\", "/") });
}

itBundled("basic", {
  experimentalCss: true,
  files: {
    "/index.ts": /* ts */ `
import { lmao } from "./lmao.ts";
import foo from "./a.css";

console.log("Foo", foo, lmao);
  `,
    "/lmao.ts": `
import { foo } from "./foo.ts";
export const lmao = "lolss";
console.log(foo);
  `,
    "/foo.ts": `
  export const foo = 'lkdfjlsdf';
  console.log('hi')`,
    "/a.css": `
  h1 {
    color: blue;
  }
        `,
  },
  entryPoints: ["index.ts"],
  plugins: [
    {
      name: "demo",
      setup(build) {
        build.onLoad({ filter: /\.(ts)/ }, async ({ defer, path }) => {
          // console.log("Running on load plugin", path);
          if (path.includes("index.ts")) {
            logLoad(path);
            return undefined;
          }
          logDefer(path);
          await defer();
          logLoad(path);
          return undefined;
        });
      },
    },
  ],
  outdir: "/out",
  onAfterBundle(api) {
    const expected_actions: Action[] = [
      {
        type: "load",
        path: "index.ts",
      },
      {
        type: "defer",
        path: "lmao.ts",
      },
      {
        type: "load",
        path: "lmao.ts",
      },
      {
        type: "defer",
        path: "foo.ts",
      },
      {
        type: "load",
        path: "foo.ts",
      },
    ];

    expect(actions.length).toBe(expected_actions.length);
    for (let i = 0; i < expected_actions.length; i++) {
      const expected = expected_actions[i];
      const action = actions[i];
      const filename = action.path.split("/").pop();

      expect(action.type).toEqual(expected.type);
      expect(filename).toEqual(expected.path);
    }
  },
});
}

itBundled("edgecase", {
experimentalCss: true,
minifyWhitespace: true,
files: {
  "/entry.css": /* css */ `
      body {
        background: white;
        color: black }
    `,
},
plugins: [
  {
    name: "demo",
    setup(build) {
      build.onLoad({ filter: /\.css/ }, async ({ path }) => {
        console.log("[plugin] Path", path);
        return {
          contents: 'h1 [this_worked="nice!"] { color: red; }',
          loader: "css",
        };
      });
    },
  },
],
outfile: "/out.js",
onAfterBundle(api) {
  api.expectFile("/out.js").toContain(`h1 [this_worked=nice\\!]{color:red}
`);
},
});

// encountered double free when CSS build has error
itBundled("shouldn't crash on CSS parse error", {
experimentalCss: true,
files: {
  "/index.ts": /* ts */ `
import { lmao } from "./lmao.ts";
import foo from "./a.css";

console.log("Foo", foo, lmao);
    `,
  "/lmao.ts": `
import { foo } from "./foo.ts";
export const lmao = "lolss";
console.log(foo);
    `,
  "/foo.ts": `
export const foo = "LOL bro";
console.log("FOOOO", foo);
    `,
  "/a.css": `
    /* helllooo friends */
          `,
},
entryPoints: ["index.ts"],
plugins: [
  {
    name: "demo",
    setup(build) {
      build.onLoad({ filter: /\.css/ }, async ({ path }) => {
        console.log("[plugin] CSS path", path);
        return {
          // this fails, because it causes a Build error I think?
          contents: `hello friends`,
          loader: "css",
        };
      });

      build.onLoad({ filter: /\.(ts)/ }, async ({ defer, path }) => {
        // console.log("Running on load plugin", path);
        if (path.includes("index.ts")) {
          console.log("[plugin] Path", path);
          return undefined;
        }
        await defer();
        return undefined;
      });
    },
  },
],
outdir: "/out",
bundleErrors: {
  "/a.css": ["end_of_input"],
},
});

itBundled("works as expected when onLoad error occurs after defer", {
experimentalCss: true,
files: {
  "/index.ts": /* ts */ `
import { lmao } from "./lmao.ts";
import foo from "./a.css";

console.log("Foo", foo, lmao);
    `,
  "/lmao.ts": `
import { foo } from "./foo.ts";
export const lmao = "lolss";
console.log(foo);
    `,
  "/foo.ts": `
export const foo = "LOL bro";
console.log("FOOOO", foo);
    `,
  "/a.css": `
    /* helllooo friends */
          `,
},
entryPoints: ["index.ts"],
plugins: [
  {
    name: "demo",
    setup(build) {
      build.onLoad({ filter: /\.css/ }, async ({ path }) => {
        return {
          // this fails, because it causes a Build error I think?
          contents: `hello friends`,
          loader: "css",
        };
      });

      build.onLoad({ filter: /\.(ts)/ }, async ({ defer, path }) => {
        if (path.includes("index.ts")) {
          return undefined;
        }
        await defer();
        throw new Error("woopsie");
      });
    },
  },
],
outdir: "/out",
bundleErrors: {
  "/a.css": ["end_of_input"],
  "/lmao.ts": ["woopsie"],
},
});

itBundled("calling defer more than once errors", {
experimentalCss: true,
files: {
  "/index.ts": /* ts */ `
import { lmao } from "./lmao.ts";
import foo from "./a.css";

console.log("Foo", foo, lmao);
    `,
  "/lmao.ts": `
import { foo } from "./foo.ts";
export const lmao = "lolss";
console.log(foo);
    `,
  "/foo.ts": `
export const foo = "LOL bro";
console.log("FOOOO", foo);
    `,
  "/a.css": `
    /* helllooo friends */
          `,
},
entryPoints: ["index.ts"],
plugins: [
  {
    name: "demo",
    setup(build) {
      build.onLoad({ filter: /\.css/ }, async ({ path }) => {
        return {
          // this fails, because it causes a Build error I think?
          contents: `hello friends`,
          loader: "css",
        };
      });

      build.onLoad({ filter: /\.(ts)/ }, async ({ defer, path }) => {
        if (path.includes("index.ts")) {
          return undefined;
        }
        await defer();
        await defer();
      });
    },
  },
],
outdir: "/out",
bundleErrors: {
  "/a.css": ["end_of_input"],
  "/lmao.ts": ["Can't call .defer() more than once within an onLoad plugin"],
},
});

test("integration", async () => {
const folder = tempDirWithFiles("integration", {
  "module_data.json": "{}",
  "package.json": `{
    "name": "integration-test",
    "version": "1.0.0",
    "private": true,
    "type": "module",
    "dependencies": {
    }
  }`,
  "src/index.ts": `
import { greet } from "./utils/greetings";
import { formatDate } from "./utils/dates";
import { calculateTotal } from "./math/calculations";
import { logger } from "./services/logger";
import moduleData from "../module_data.json";
import path from "path";


await Bun.write(path.join(import.meta.dirname, 'output.json'), JSON.stringify(moduleData))

function main() {
const today = new Date();
logger.info("Application started");

const total = calculateTotal([10, 20, 30, 40]);
console.log(greet("World"));
console.log(\`Today is \${formatDate(today)}\`);
console.log(\`Total: \${total}\`);
}
`,
  "src/utils/greetings.ts": `
export function greet(name: string): string {
return \`Hello \${name}!\`;
}
`,
  "src/utils/dates.ts": `
export function formatDate(date: Date): string {
return date.toLocaleDateString("en-US", {
weekday: "long",
year: "numeric", 
month: "long",
day: "numeric"
});
}
`,
  "src/math/calculations.ts": `
export function calculateTotal(numbers: number[]): number {
return numbers.reduce((sum, num) => sum + num, 0);
}

export function multiply(a: number, b: number): number {
return a * b;
}
`,
  "src/services/logger.ts": `
export const logger = {
info: (msg: string) => console.log(\`[INFO] \${msg}\`),
error: (msg: string) => console.error(\`[ERROR] \${msg}\`),
warn: (msg: string) => console.warn(\`[WARN] \${msg}\`)
};
`,
});

const entrypoint = path.join(folder, "src", "index.ts");
await Bun.$`${bunExe()} install`.env(bunEnv).cwd(folder);

const outdir = path.join(folder, "dist");

const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir,
  plugins: [
    {
      name: "xXx123_import_checker_321xXx",
      setup(build) {
        type Import = {
          imported: string[];
          dep: string;
        };
        type Export = {
          ident: string;
        };
        let imports_and_exports: Record<string, { imports: Array<Import>; exports: Array<Export> }> = {};

        build.onLoad({ filter: /\.ts/ }, async ({ path }) => {
          const contents = await Bun.$`cat ${path}`.quiet().text();

          const import_regex = /import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"];/g;
          const imports: Array<Import> = [...contents.toString().matchAll(import_regex)].map(m => ({
            imported: m
              .slice(1, m.length - 1)
              .map(match => (match[0] === "{" ? match.slice(2, match.length - 2) : match)),
            dep: m[m.length - 1],
          }));

          const export_regex =
            /export\s+(?:default\s+|const\s+|let\s+|var\s+|function\s+|class\s+|enum\s+|type\s+|interface\s+)?([\w$]+)?(?:\s*=\s*|(?:\s*{[^}]*})?)?[^;]*;/g;
          const exports: Array<Export> = [...contents.matchAll(export_regex)].map(m => ({
            ident: m[1],
          }));

          imports_and_exports[path.replaceAll("\\", "/").split("/").pop()!] = { imports, exports };
          return undefined;
        });

        build.onLoad({ filter: /module_data\.json/ }, async ({ defer }) => {
          await defer();
          const contents = JSON.stringify(imports_and_exports);

          return {
            contents,
            loader: "json",
          };
        });
      },
    },
  ],
});

expect(result.success).toBeTrue();
await Bun.$`${bunExe()} run ${result.outputs[0].path}`;
const output = await Bun.$`cat ${path.join(folder, "dist", "output.json")}`.json();
expect(output).toStrictEqual({
  "index.ts": {
    "imports": [
      { "imported": ["greet"], "dep": "./utils/greetings" },
      { "imported": ["formatDate"], "dep": "./utils/dates" },
      { "imported": ["calculateTotal"], "dep": "./math/calculations" },
      { "imported": ["logger"], "dep": "./services/logger" },
      { "imported": ["moduleData"], "dep": "../module_data.json" },
      { "imported": ["path"], "dep": "path" },
    ],
    "exports": [],
  },
  "greetings.ts": {
    "imports": [],
    "exports": [{ "ident": "greet" }],
  },
  "dates.ts": {
    "imports": [],
    "exports": [{ "ident": "formatDate" }],
  },
  "calculations.ts": {
    "imports": [],
    "exports": [{ "ident": "calculateTotal" }, { "ident": "multiply" }],
  },
  "logger.ts": {
    "imports": [],
    "exports": [{ "ident": "logger" }],
  },
});
});

itBundled("calling defer and not awaiting it", {
experimentalCss: true,
files: {
  "/index.ts": /* ts */ `
import { lmao } from "./lmao.ts";
import foo from "./a.css";

console.log("Foo", foo, lmao);
    `,
  "/lmao.ts": `
import { foo } from "./foo.ts";
export const lmao = "lolss";
console.log(foo);
    `,
  "/foo.ts": `
export const foo = "LOL bro";
console.log("FOOOO", foo);
    `,
  "/a.css": `
    /* helllooo friends */
          `,
},
entryPoints: ["index.ts"],
plugins: [
  {
    name: "demo",
    setup(build) {
      build.onLoad({ filter: /\.css/ }, async ({ path }) => {
        return {
          // this fails, because it causes a Build error I think?
          contents: `hello friends`,
          loader: "css",
        };
      });

      build.onLoad({ filter: /\.(ts)/ }, async ({ defer, path }) => {
        if (path.includes("index.ts")) {
          return undefined;
        }
        defer();
        await 1;
        return {
          contents: `hello friends`,
          loader: "css",
        };
      });
    },
  },
],
outdir: "/out",
bundleErrors: {
  "/a.css": ["end_of_input"],
  "/lmao.ts": ["Can't call .defer() more than once within an onLoad plugin"],
},
});
});