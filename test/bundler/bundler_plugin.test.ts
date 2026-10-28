import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { writeFileSync } from "node:fs";
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

  itBundled("plugin/LoadXmlLoader", {
    files: {
      "/index.ts": /* ts */ `
        import doc from "./data.magic";
        import feed from "./feed.xml";
        console.log(JSON.stringify([doc, feed]));
      `,
      "/data.magic": `<config env="test"><name>app</name></config>`,
      "/feed.xml": `<feed><entry>1</entry><entry>2</entry></feed>`,
    },
    plugins(builder) {
      builder.onLoad({ filter: /\.magic$/ }, async args => ({
        contents: await Bun.file(args.path).text(),
        loader: "xml",
      }));
      // .xml files report their default loader and can rely on it implicitly.
      builder.onLoad({ filter: /\.xml$/ }, async args => {
        if (args.loader !== "xml") throw new Error("expected args.loader to be xml, got " + args.loader);
        return { contents: await Bun.file(args.path).text() };
      });
    },
    run: {
      stdout: '[{"config":{"@env":"test","name":"app"}},{"feed":{"entry":["1","2"]}}]',
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
  // A max-length 16-bit rope throws "Out of memory" the first time it's flattened.
  // `external: true` skips the JS-side path checks, which would flatten it first.
  test.concurrent("plugin/fails the build when a returned string can't be flattened", async () => {
    using dir = tempDir("plugin-string-answer-cannot-flatten", {
      "entry.ts": `import { foo } from "./foo.magic"; console.log(foo);`,
      "foo.magic": `hello world`,
      "build.mjs": `
        let huge = "\\u0100";
        for (let i = 0; i < 30; i++) huge = huge + huge + "\\u0100";
        console.log("length=" + (huge.length === 2 ** 31 - 1));

        async function run(name, answer) {
          const { success, logs } = await Bun.build({
            entrypoints: ["./entry.ts"],
            throw: false,
            plugins: [{
              name,
              setup(build) {
                build.onResolve({ filter: /foo\\.magic$/ }, args => {
                  console.log(name + ": resolve returned");
                  return answer.resolve ? answer.resolve(args.path) : undefined;
                });
                build.onLoad({ filter: /\\.magic$/ }, () => {
                  console.log(name + ": load returned");
                  return answer.load ? answer.load() : undefined;
                });
              },
            }],
          });
          const errors = logs.map(l => l.level + " " + JSON.stringify(l.message) + " " + l.position?.file.split(/[\\\\/]/).pop());
          console.log(name + ": success=" + success + " " + errors.join(", "));
        }

        await run("contents", { load: () => ({ contents: huge, loader: "js" }) });
        await run("path", { resolve: () => ({ path: huge, external: true }) });
        await run("namespace", { resolve: path => ({ path, namespace: huge, external: true }) });
        await run("ok", { load: () => ({ contents: "export const foo = 1;", loader: "js" }) });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr }).toEqual({
      stdout: [
        "length=true",
        "contents: resolve returned",
        "contents: load returned",
        'contents: success=false error "Out of memory" foo.magic',
        "path: resolve returned",
        'path: success=false error "Out of memory" entry.ts',
        "namespace: resolve returned",
        'namespace: success=false error "Out of memory" entry.ts',
        "ok: resolve returned",
        "ok: load returned",
        "ok: success=true ",
        "",
      ].join("\n"),
      stderr: "",
    });
    expect(exitCode).toBe(0);
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
          expect(args.importer).toBe(path.join(root, "index.ts"));
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
  // Like esbuild, an external import is printed with the path that onResolve returned.
  itBundled("plugin/ResolveExternalRewritesPath", {
    files: {
      "index.ts": /* ts */ `
        import React from "react";
        import { createRoot } from "react-dom/client";
        export { h } from "preact";
        export * from "mobx";
        console.log(React, createRoot, await import("lodash"));
      `,
    },
    plugins(builder) {
      builder.onResolve({ filter: /^(react|react-dom\/client|preact|mobx|lodash)$/ }, args => {
        return { path: "https://esm.sh/" + args.path, external: true };
      });
    },
    onAfterBundle(api) {
      const contents = api.readFile("/out.js");
      expect(contents).toContain(`from "https://esm.sh/react"`);
      expect(contents).toContain(`from "https://esm.sh/react-dom/client"`);
      expect(contents).toContain(`from "https://esm.sh/preact"`);
      expect(contents).toContain(`from "https://esm.sh/mobx"`);
      expect(contents).toContain(`import("https://esm.sh/lodash")`);
      for (const original of ["react", "react-dom/client", "preact", "mobx", "lodash"]) {
        expect(contents).not.toContain(`"${original}"`);
      }
    },
  });
  itBundled("plugin/ResolveExternalRewritesPathRequire", {
    files: {
      "index.ts": /* ts */ `
        const React = require("react");
        console.log(React);
      `,
    },
    format: "cjs",
    plugins(builder) {
      builder.onResolve({ filter: /^react$/ }, () => {
        return { path: "./vendor/react.cjs", external: true };
      });
    },
    onAfterBundle(api) {
      const contents = api.readFile("/out.js");
      expect(contents).toContain(`require("./vendor/react.cjs")`);
      expect(contents).not.toContain(`require("react")`);
    },
  });
  for (const format of ["esm", "cjs"] as const) {
    itBundled(`plugin/ResolveExternalRewritesRelativeImport_${format}`, {
      files: {
        "/a.js": /* js */ `
          import { v } from "./b.js";
          console.log(v);
        `,
        "/b.js": `export const v = "bundled";`,
      },
      target: "bun",
      format,
      plugins(builder) {
        builder.onResolve({ filter: /b\.js$/ }, () => {
          return { path: "/somewhere/else/b.js", external: true };
        });
      },
      onAfterBundle(api) {
        const contents = api.readFile("/out.js");
        expect(contents).toContain(
          format === "esm" ? `import { v } from "/somewhere/else/b.js";` : `require("/somewhere/else/b.js")`,
        );
        expect(contents).not.toContain(`"./b.js"`);
        expect(contents).not.toContain(`"bundled"`);
      },
    });
  }
  // rewriteExternalWithNamespace and rewriteExternalWithoutNamespace in
  // https://github.com/evanw/esbuild/blob/f6058f8364fe7ab91ca57a83e02577ed74c9cae4/scripts/plugin-tests.js#L680-L728
  for (const namespace of ["for-testing", undefined]) {
    itBundled(`plugin/RewriteExternal${namespace ? "WithNamespace" : "WithoutNamespace"}`, {
      files: {
        "/in.js": /* js */ `
          import { exists } from "extern";
          export default exists;
        `,
        "/check.js": /* js */ `
          const fs = require("fs");
          console.log(require("./out.js").default === fs.exists);
        `,
      },
      format: "cjs",
      plugins(builder) {
        builder.onResolve({ filter: /^extern$/ }, () => {
          return { path: "fs", external: true, namespace };
        });
      },
      run: {
        file: "/check.js",
        stdout: "true",
      },
    });
  }
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
        expect(importers.sort()).toEqual([path.join(root, "one.ts"), path.join(root, "two.ts")].sort());
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
        expect(build.config).toBe(getConfigRef() as typeof build.config);
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

  test.concurrent("plugin/onLoad that returns nothing for an asset leaves it to the file loader", async () => {
    using dir = tempDir("plugin-onload-declines-asset", {
      "index.ts": `
        import logo from "./logo.png";
        console.log(logo);
      `,
      "logo.png": "png bytes",
      "build.mjs": `
        import { basename } from "node:path";
        const result = await Bun.build({
          entrypoints: ["./index.ts"],
          outdir: "./out",
          naming: { asset: "[name].[ext]" },
          plugins: [
            {
              name: "yaml-only",
              setup(build) {
                build.onLoad({ filter: /.*/ }, args =>
                  args.path.endsWith(".yaml") ? { contents: "export default 1", loader: "js" } : undefined,
                );
              },
            },
          ],
        });
        console.log(result.outputs.map(output => output.kind + " " + basename(output.path)).sort().join("\\n"));
        console.log(await Bun.file("./out/logo.png").text());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("asset logo.png\nentry-point index.js\npng bytes\n");
    expect(exitCode).toBe(0);
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

  for (const [name, call, tuple] of [
    ["addFilter", 1, `[123, () => {}]`],
    ["onBeforeParse", 3, `[123, {}, "symbol", undefined]`],
  ] as const) {
    test.concurrent(`plugin/${name} throws a TypeError when the filter is not a RegExp`, async () => {
      using dir = tempDir("plugin-filter-not-regexp", {
        "index.ts": `console.log("hi");`,
        "build.mjs": `
          const originalEntries = Map.prototype.entries;
          let calls = 0;
          try {
            await Bun.build({
              entrypoints: ["./index.ts"],
              plugins: [
                {
                  name: "entries",
                  setup(build) {
                    Map.prototype.entries = function () {
                      if (++calls !== ${call}) return originalEntries.call(this);
                      Map.prototype.entries = originalEntries;
                      return [["file", [${tuple}]]][Symbol.iterator]();
                    };
                  },
                },
              ],
            });
            console.log("resolved");
          } catch (e) {
            console.log([e.name, e.code, e.message].join("|"));
          } finally {
            Map.prototype.entries = originalEntries;
          }
          console.log("calls=" + calls);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout, stderr }).toEqual({
        stdout: `TypeError|ERR_INVALID_ARG_TYPE|Expected filter (1st argument) to be a RegExp\ncalls=${call}\n`,
        stderr: "",
      });
      expect(exitCode).toBe(0);
    });
  }

  // An entry point that onResolve leaves without a module used to be dropped
  // without a log entry: the linker aborted on an empty chunk list when it was
  // the only entry point, and the build silently emitted only the other entry
  // points otherwise. A declined entry point that the package.json "browser"
  // field disables gets the same error as without plugins.
  test.concurrent("plugin/entry point left without a module by onResolve fails the build", async () => {
    using dir = tempDir("plugin-entry-point-without-module", {
      "package.json": JSON.stringify({ name: "app", browser: { "./disabled.js": false } }),
      "entry.js": `console.log("entry");`,
      "live.js": `console.log("live");`,
      "disabled.js": `console.log("disabled");`,
      "build.mjs": `
        const declined = [];
        const plugins = [
          {
            name: "externalize-entry",
            setup(build) {
              build.onResolve({ filter: /entry\\.js$/ }, args => ({ path: args.path, external: true }));
            },
          },
          {
            name: "decline-disabled",
            setup(build) {
              build.onResolve({ filter: /disabled\\.js$/ }, args => {
                declined.push(args.path);
              });
            },
          },
        ];
        const results = {};
        for (const [name, entrypoints] of Object.entries({
          external: ["./entry.js"],
          externalNextToLiveEntryPoint: ["./entry.js", "./live.js"],
          declinedThenDisabledByBrowserField: ["./disabled.js"],
        })) {
          const result = await Bun.build({ entrypoints, target: "browser", plugins, throw: false });
          results[name] = {
            success: result.success,
            logs: result.logs.map(log => log.message),
            outputs: result.outputs.map(output => output.path),
          };
        }
        results.declined = declined;
        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      external: {
        success: false,
        logs: ['The entry point "./entry.js" cannot be marked as external'],
        outputs: [],
      },
      externalNextToLiveEntryPoint: {
        success: false,
        logs: ['The entry point "./entry.js" cannot be marked as external'],
        outputs: [],
      },
      declinedThenDisabledByBrowserField: {
        success: false,
        logs: ['"./disabled.js" is disabled due to "browser" field in package.json (entry point)'],
        outputs: [],
      },
      declined: ["./disabled.js"],
    });
    expect(exitCode).toBe(0);
  });

  // Two entry point names that onResolve maps to one file make one output file.
  for (const splitting of [false, true]) {
    test.concurrent(`plugin/two entry points that resolve to one file (splitting: ${splitting})`, async () => {
      using dir = tempDir("plugin-two-entry-points-one-file", {
        "entry.ts": `console.log("entry");`,
      });
      const result = await Bun.build({
        entrypoints: ["first-name", "second-name"],
        outdir: join(String(dir), "out"),
        splitting,
        throw: false,
        plugins: [
          {
            name: "alias",
            setup(build) {
              build.onResolve({ filter: /-name$/ }, () => ({ path: join(String(dir), "entry.ts") }));
            },
          },
        ],
      });
      expect({
        success: result.success,
        logs: result.logs.map(log => log.message),
        outputs: result.outputs.map(output => path.basename(output.path)),
      }).toEqual({ success: true, logs: [], outputs: ["second-name.js"] });
    });
  }

  test.concurrent("plugin/internal plugin object checks its receiver and rejects new filters after setup", async () => {
    using dir = tempDir("plugin-private-object", {
      "entry.js": `export default 1;`,
      "fixture.mjs": /* js */ `
        import { getProtectedObjects } from "bun:jsc";
        const hasOwn = Object.prototype.hasOwnProperty;
        // The plugin object is a protected cell. Some other protected cells throw on property lookup.
        function findPlugin() {
          for (const object of getProtectedObjects()) {
            try {
              if (object && typeof object === "object" && hasOwn.call(object, "addFilter")) return object;
            } catch {}
          }
        }
        const attempt = call => {
          try {
            call();
            return "accepted";
          } catch (e) {
            return e.code ?? e.name;
          }
        };

        const leaked = [];
        for (const name of ["promises", "onEndCallbacks"]) {
          Object.defineProperty(Object.prototype, name, {
            configurable: true,
            get() {
              if (hasOwn.call(this, "addFilter")) leaked.push(name);
            },
            set(value) {
              Object.defineProperty(this, name, { value, writable: true, enumerable: true, configurable: true });
            },
          });
        }

        let plugin;
        const outcomes = {};
        const result = await Bun.build({
          entrypoints: ["./entry.js"],
          throw: false,
          plugins: [
            {
              name: "probe",
              // A callable Proxy isn't a JSFunction.
              setup: new Proxy(build => {
                plugin = findPlugin();
                outcomes.duringSetup = attempt(() => plugin.addFilter(/never/, "probe", 1));
                build.onEnd(() => {});
                build.onLoad({ filter: /entry/ }, () => {
                  outcomes.duringBuild = attempt(() => plugin.addFilter(/never/, "probe", 1));
                });
              }, {}),
            },
          ],
        });
        const calls = {
          addFilter: [/x/, "a", 1],
          addError: [0, new Error("x")],
          onLoadAsync: [0, null, null],
          onResolveAsync: [0, null, null, null],
          onBeforeParse: [/x/, "a", {}, "symbol"],
          generateDeferPromise: [0],
        };
        const receivers = Object.entries(calls).map(([name, args]) => attempt(() => plugin[name].apply(undefined, args)));
        console.log(JSON.stringify({ success: result.success, leaked, outcomes, receivers }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout || "null")).toEqual({
      success: true,
      leaked: [],
      outcomes: { duringSetup: "accepted", duringBuild: "ERR_INVALID_STATE" },
      receivers: Array(6).fill("ERR_INVALID_THIS"),
    });
    expect(exitCode).toBe(0);
  });

  // `loader: "object"`: the plugin returns the exports of a module as an object. At run time
  // (ObjectModule.cpp) each own key is one export, so the `default` key is the default export.
  // A bundle must bind the same way. It used to make the whole object the default export, as
  // for a JSON file.
  describe("plugin/loader object", () => {
    // Answers the import of `objdiv:<name>` with `{ exports: modules[name], loader: "object" }`.
    const objectModules = (modules: Record<string, unknown>) => ({
      name: "objdiv",
      setup(b: any) {
        b.onResolve({ filter: /^objdiv:/ }, (a: any) => ({ path: a.path.slice(7), namespace: "objdiv" }));
        b.onLoad({ filter: /.*/, namespace: "objdiv" }, (a: any) => ({ exports: modules[a.path], loader: "object" }));
      },
    });

    const run = async (file: string) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), file], env: bunEnv, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout);
    };

    // Bundles `entry`, runs the bundle, and returns the one JSON value that it prints.
    const bundleAndRun = async (
      modules: Record<string, unknown>,
      entry: string,
      config: Partial<Bun.BuildConfig> = {},
      files: Record<string, string> = {},
    ) => {
      using dir = tempDir("plugin-loader-object", { "entry.ts": entry, ...files });
      const build = await Bun.build({
        entrypoints: [join(String(dir), "entry.ts")],
        ...config,
        plugins: [objectModules(modules), ...(config.plugins ?? [])],
      });
      expect(build.success).toBe(true);
      const out = join(String(dir), config.format === "cjs" ? "out.cjs" : "out.mjs");
      writeFileSync(out, await build.outputs[0].text());
      return await run(out);
    };

    const outputs = [
      { format: "esm", minify: false },
      { format: "esm", minify: true },
      { format: "cjs", minify: true },
      { format: "iife", minify: false },
    ] as const;

    test.concurrent("the default import is exports.default", async () => {
      const result = await bundleAndRun(
        {
          text: { default: "DEF", named: "NAMED" },
          object: { default: { a: 1, b: 2 }, named: "NAMED" },
          zero: { default: 0 },
          null: { default: null },
          empty: { default: "" },
          marked: { default: "DEF", named: "NAMED", __esModule: true },
        },
        `import text, { named } from "objdiv:text";
         import * as textNamespace from "objdiv:text";
         import object from "objdiv:object";
         import zero from "objdiv:zero";
         import nothing from "objdiv:null";
         import empty from "objdiv:empty";
         import marked, * as markedNamespace from "objdiv:marked";
         console.log(JSON.stringify({
           text,
           named,
           textNamespace,
           object,
           falsy: [zero, nothing, empty],
           marked,
           markedKeys: Object.keys(markedNamespace).sort(),
         }));`,
      );
      expect(result).toEqual({
        text: "DEF",
        named: "NAMED",
        textNamespace: { default: "DEF", named: "NAMED" },
        object: { a: 1, b: 2 },
        falsy: [0, null, ""],
        marked: "DEF",
        // `__esModule` is not an export, as in a data file.
        markedKeys: ["default", "named"],
      });
    });

    // `JSON.parse` defines `__proto__` as an own property. The bundle must keep it one: in an
    // object literal of JS source, a plain `"__proto__": value` sets the prototype instead.
    test.concurrent.each(outputs)(
      "an own __proto__ key stays an own key ($format, minify: $minify)",
      async ({ format, minify }) => {
        const withOwnProto = () => JSON.parse('{"__proto__":{"admin":true},"name":"n"}');
        const result = await bundleAndRun(
          {
            // in the data
            data: {
              default: { name: "DEF", user: withOwnProto(), list: [withOwnProto()] },
              user: withOwnProto(),
              nulled: JSON.parse('{"__proto__":null}'),
              primitive: JSON.parse('{"__proto__":"p"}'),
            },
            // as the name of an export
            name: JSON.parse('{"default":"DEF","__proto__":{"admin":true},"name":"n"}'),
          },
          `import d, { user, nulled, primitive } from "objdiv:data";
           import byName, { __proto__ as viaNamed, name } from "objdiv:name";
           import * as ns from "objdiv:name";
           const dataShape = o => ({
             keys: Object.keys(o),
             own: Object.hasOwn(o, "__proto__"),
             plain: Object.getPrototypeOf(o) === Object.prototype,
             admin: o.admin === true,
           });
           const exportsShape = o => ({
             keys: Object.keys(o).sort(),
             own: Object.hasOwn(o, "__proto__"),
             admin: o.admin === true,
           });
           import("objdiv:name").then(imported => {
             console.log(JSON.stringify({
               data: {
                 name: d.name,
                 inDefault: dataShape(d.user),
                 inArray: dataShape(d.list[0]),
                 inNamed: dataShape(user),
                 nulled: dataShape(nulled),
                 primitive: dataShape(primitive),
               },
               exports: {
                 byName,
                 viaNamed,
                 name,
                 namespace: exportsShape(ns),
                 required: exportsShape(require("objdiv:name")),
                 imported: exportsShape(imported),
               },
             }));
           });`,
          { format, minify },
        );
        const keptData = { keys: ["__proto__", "name"], own: true, plain: true, admin: false };
        const keptAlone = { keys: ["__proto__"], own: true, plain: true, admin: false };
        const keptExport = { keys: ["__proto__", "default", "name"], own: true, admin: false };
        expect(result).toEqual({
          data: {
            name: "DEF",
            inDefault: keptData,
            inArray: keptData,
            inNamed: keptData,
            nulled: keptAlone,
            primitive: keptAlone,
          },
          exports: {
            byName: "DEF",
            viaNamed: { admin: true },
            name: "n",
            namespace: keptExport,
            required: keptExport,
            imported: keptExport,
          },
        });
      },
    );

    test.concurrent.each(outputs)(
      "every way to load the module sees the same exports ($format, minify: $minify)",
      async ({ format, minify }) => {
        const result = await bundleAndRun(
          { x: { default: "DEF", named: "NAMED" } },
          `import d, { named } from "objdiv:x";
           import * as star from "./reexport.ts";
           const required = require("objdiv:x");
           const shape = o => ({ keys: Object.keys(o).sort(), default: o.default, named: o.named });
           import("objdiv:x").then(imported => {
             console.log(JSON.stringify({
               d,
               named,
               star: { keys: Object.keys(star).sort(), named: star.named, renamed: star.renamed },
               required: shape(required),
               imported: shape(imported),
             }));
           });`,
          { format, minify },
          { "reexport.ts": `export * from "objdiv:x"; export { default as renamed } from "objdiv:x";` },
        );
        const own = { keys: ["default", "named"], default: "DEF", named: "NAMED" };
        expect(result).toEqual({
          d: "DEF",
          named: "NAMED",
          star: { keys: ["named", "renamed"], named: "NAMED", renamed: "DEF" },
          required: own,
          imported: own,
        });
      },
    );

    test.concurrent("a dynamic import in its own chunk sees exports.default", async () => {
      using dir = tempDir("plugin-loader-object-splitting", {
        "entry.ts": `import("objdiv:x").then(m => console.log(JSON.stringify({ keys: Object.keys(m).sort(), default: m.default, named: m["not-an-identifier"] })));`,
      });
      const build = await Bun.build({
        entrypoints: [join(String(dir), "entry.ts")],
        outdir: join(String(dir), "out"),
        splitting: true,
        plugins: [objectModules({ x: { default: "DEF", "not-an-identifier": "NAMED" } })],
      });
      expect(build.outputs.map(output => output.kind).sort()).toEqual(["chunk", "entry-point"]);
      expect(await run(build.outputs.find(output => output.kind === "entry-point")!.path)).toEqual({
        keys: ["default", "not-an-identifier"],
        default: "DEF",
        named: "NAMED",
      });
    });

    test.concurrent.each(["esm", "cjs"] as const)("an object module as the %s entry point", async format => {
      using dir = tempDir("plugin-loader-object-entry-point", {
        "data.objdiv": "",
        "load.mjs": `import * as m from "./out.mjs"; console.log(JSON.stringify({ keys: Object.keys(m).sort(), default: m.default, named: m.named }));`,
        "load.cjs": `const m = require("./out.cjs"); console.log(JSON.stringify({ keys: Object.keys(m).sort(), default: m.default, named: m.named }));`,
      });
      const build = await Bun.build({
        entrypoints: [join(String(dir), "data.objdiv")],
        format,
        plugins: [
          {
            name: "objdiv-entry",
            setup(b) {
              b.onLoad({ filter: /\.objdiv$/ }, () => ({
                exports: { default: "DEF", named: "NAMED" },
                loader: "object",
              }));
            },
          },
        ],
      });
      const ext = format === "cjs" ? "cjs" : "mjs";
      writeFileSync(join(String(dir), "out." + ext), await build.outputs[0].text());
      expect(await run(join(String(dir), "load." + ext))).toEqual({
        keys: ["default", "named"],
        default: "DEF",
        named: "NAMED",
      });
    });

    test.concurrent.each([false, true])("a key that is not a binding name is an export (minify: %p)", async minify => {
      const exports = {
        default: "DEF",
        await: 1,
        eval: 2,
        arguments: 3,
        class: 4,
        let: 5,
        static: 6,
        undefined: 7,
        "not-an-identifier": 8,
        "1": 9,
        "": 10,
        "a-b": 11,
        a_b: 12,
      };
      const result = await bundleAndRun(
        { x: exports },
        `import d, {
           await as a, eval as e, arguments as args, class as c, let as l, static as s, undefined as u,
           "not-an-identifier" as n, "1" as one, "" as empty, "a-b" as dashed, a_b as underscored,
         } from "objdiv:x";
         console.log(JSON.stringify({
           d,
           named: [a, e, args, c, l, s, u, n, one, empty, dashed, underscored],
           required: require("objdiv:x"),
           undefinedIsIntact: undefined === void 0,
         }));`,
        { minify },
      );
      expect(result).toEqual({
        d: "DEF",
        named: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        required: exports,
        undefinedIsIntact: true,
      });
    });

    test.concurrent("what JSON.stringify drops or rewrites is what the module exports", async () => {
      const dropped = { default: "DEF", named: "NAMED", fn: () => 1, undef: undefined, sym: Symbol("s") };
      const result = await bundleAndRun(
        {
          dropped,
          // The `default` key is dropped too, so this is an answer without a `default` key.
          droppedDefault: { default: () => 1, named: "NAMED" },
          rewritten: { default: "NOT_USED", toJSON: () => ({ default: "DEF", named: "NAMED" }) },
        },
        `import dropped, * as droppedNamespace from "objdiv:dropped";
         import droppedDefault from "objdiv:droppedDefault";
         import rewritten, * as rewrittenNamespace from "objdiv:rewritten";
         console.log(JSON.stringify({
           dropped,
           droppedKeys: Object.keys(droppedNamespace).sort(),
           droppedDefault,
           rewritten,
           rewrittenKeys: Object.keys(rewrittenNamespace).sort(),
         }));`,
      );
      expect(result).toEqual({
        dropped: "DEF",
        droppedKeys: ["default", "named"],
        droppedDefault: { named: "NAMED" },
        rewritten: "DEF",
        rewrittenKeys: ["default", "named"],
      });

      // A key that is not an export cannot be imported by name.
      using dir = tempDir("plugin-loader-object-dropped", {
        "entry.ts": `import { fn } from "objdiv:dropped"; console.log(fn);`,
      });
      const build = await Bun.build({
        entrypoints: [join(String(dir), "entry.ts")],
        plugins: [objectModules({ dropped })],
        throw: false,
      });
      expect(build.success).toBe(false);
      expect(build.logs.map(log => log.message)).toEqual(['No matching export in "objdiv:dropped" for import "fn"']);
    });

    test.concurrent("the whole value stays the default export without a default key", async () => {
      const json = JSON.stringify({ default: "DEF", named: "NAMED" });
      const result = await bundleAndRun(
        {
          withDefault: { default: "DEF", named: "NAMED" },
          withoutDefault: { named: "NAMED", other: 42 },
          // An export name cannot have half of a surrogate pair, so this one is not an ES module.
          loneSurrogate: { default: "DEF", "\ud800": 1 },
        },
        `import withDefault from "objdiv:withDefault";
         import withoutDefault, { named, other } from "objdiv:withoutDefault";
         import loneSurrogate from "objdiv:loneSurrogate";
         import jsonLoader from "jsontext:x";
         import jsonFile from "./data.json";
         console.log(JSON.stringify({
           withDefault,
           withoutDefault,
           named,
           other,
           loneSurrogate: { default: loneSurrogate.default, units: Object.keys(loneSurrogate).map(key => key.charCodeAt(0)) },
           jsonLoader,
           jsonFile,
         }));`,
        {
          plugins: [
            {
              name: "jsontext",
              setup(b) {
                b.onResolve({ filter: /^jsontext:/ }, a => ({ path: a.path, namespace: "jsontext" }));
                b.onLoad({ filter: /.*/, namespace: "jsontext" }, () => ({ contents: json, loader: "json" }));
              },
            },
          ],
        },
        { "data.json": json },
      );
      expect(result).toEqual({
        withDefault: "DEF",
        withoutDefault: { named: "NAMED", other: 42 },
        named: "NAMED",
        other: 42,
        loneSurrogate: { default: "DEF", units: ["d".charCodeAt(0), 0xd800] },
        // JSON text is a data file, with or without a plugin: the `default` key is a key of the value.
        jsonLoader: { default: "DEF", named: "NAMED" },
        jsonFile: { default: "DEF", named: "NAMED" },
      });
    });

    test.concurrent("a key that nothing imports is not in the bundle", async () => {
      using dir = tempDir("plugin-loader-object-tree-shaking", {
        "entry.ts": `import d, { used } from "objdiv:x"; console.log(d, used);`,
      });
      const build = await Bun.build({
        entrypoints: [join(String(dir), "entry.ts")],
        plugins: [objectModules({ x: { default: "DEFAULT_VALUE", used: "USED_VALUE", unused: "UNUSED_VALUE" } })],
      });
      const text = await build.outputs[0].text();
      expect(text).toContain("DEFAULT_VALUE");
      expect(text).toContain("USED_VALUE");
      expect(text).not.toContain("UNUSED_VALUE");
    });

    test.concurrent("an answer that is not usable is a build error", async () => {
      using dir = tempDir("plugin-loader-object-errors", { "entry.ts": `import d from "objdiv:x"; console.log(d);` });
      const messages = async (answer: object) => {
        const build = await Bun.build({
          entrypoints: [join(String(dir), "entry.ts")],
          throw: false,
          plugins: [
            {
              name: "objdiv",
              setup(b: any) {
                b.onResolve({ filter: /^objdiv:/ }, (a: any) => ({ path: a.path, namespace: "objdiv" }));
                b.onLoad({ filter: /.*/, namespace: "objdiv" }, () => answer);
              },
            },
          ],
        });
        expect(build.success).toBe(false);
        return build.logs.map(log => log.message);
      };
      const cyclic: Record<string, unknown> = { default: "DEF" };
      cyclic.self = cyclic;
      expect({
        missing: await messages({ loader: "object" }),
        cyclic: await messages({ exports: cyclic, loader: "object" }),
      }).toEqual({
        missing: ['onLoad plugin returning loader: "object" must have "exports" property'],
        cyclic: [
          expect.stringContaining("When using Bun.build, onLoad plugin must return a JSON-serializable object: "),
        ],
      });
    });
  });
});
