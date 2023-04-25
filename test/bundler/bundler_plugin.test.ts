import assert from "assert";
import dedent from "dedent";
import path from "path";
import { itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

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
          path: path.resolve(path.dirname(args.importer), args.path.replace(/\.magic$/, ".ts")),
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
      stdout: "foo",
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
  });
  itBundled("plugin/LoadThrowPrimative", {
    files: loadFixture,
    plugins(builder) {
      builder.onLoad({ filter: /\.magic$/ }, args => {
        throw "123";
      });
    },
  });
  itBundled("plugin/LoadThrowAsync", {
    files: loadFixture,
    plugins(builder) {
      builder.onLoad({ filter: /\.magic$/ }, async args => {
        throw new Error("error here");
      });
    },
  });
  itBundled("plugin/LoadThrowPrimativeAsync", {
    files: loadFixture,
    plugins(builder) {
      builder.onLoad({ filter: /\.magic$/ }, async args => {
        throw 123;
      });
    },
  });

  // Load Plugin Errors
  itBundled("plugin/ResolveThrow", {
    files: resolveFixture,
    plugins(builder) {
      builder.onResolve({ filter: /\.magic$/ }, args => {
        throw new Error("error here");
      });
    },
  });
  itBundled("plugin/ResolveThrowPrimative", {
    files: resolveFixture,
    plugins(builder) {
      builder.onResolve({ filter: /\.magic$/ }, args => {
        throw "123";
      });
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
          expect(args.suffix).toBeFalsy();

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
    return {
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
          expect(args.suffix).toBeFalsy();

          return {
            contents: "import 'nested_import';export const foo = 'foo';",
            loader: "js",
          };
        });
        builder.onResolve({ filter: /nested_import/ }, args => {
          expect(args.path).toBe("nested_import");
          expect(args.namespace).toBe("my_namespace");
          return {
            path: root + "/foo.ts",
            namespace: "file",
          };
        });
      },
      run: {
        stdout: "foo",
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
  itBundled("plugin/ResolveTwoImportsOnce", ({ root }) => {
    let onResolveCount = 0;
    return {
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
        expect(importers).toEqual([root + "/one.ts", root + "/two.ts"]);
        expect(onResolveCount).toBe(2);
        const contents = api.readFile("/out.js");
        expect([...contents.matchAll(/this string should exist once/g)].length).toBe(1);
      },
    };
  });
});
