import assert from "assert";
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDirWithFiles, tempDirWithFilesAnon } from "harness";
import path, { join } from "path";
import { buildNoThrow } from "./buildNoThrow";

describe("Bun.build", () => {
  test("css works", async () => {
    const dir = tempDirWithFiles("bun-build-api-css", {
      "a.css": `
        @import "./b.css";

        .hi {
          color: red;
        }
      `,
      "b.css": `
        .hello {
          color: blue;
        }
      `,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "a.css")],
      minify: true,
    });

    expect(build.outputs).toHaveLength(1);
    expect(build.outputs[0].kind).toBe("asset");
    expect(await build.outputs[0].text()).toEqualIgnoringWhitespace(".hello{color:#00f}.hi{color:red}\n");
  });

  test("bytecode works", async () => {
    const dir = tempDirWithFiles("bun-build-api-bytecode", {
      "package.json": `{}`,
      "index.ts": `
        export function hello() {
          return "world";
        }

        console.log(hello());
      `,
      out: {
        "hmm.js": "hmm",
      },
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      outdir: join(dir, "out"),
      target: "bun",
      bytecode: true,
    });

    expect(build.outputs).toHaveLength(2);
    expect(build.outputs[0].kind).toBe("entry-point");
    expect(build.outputs[1].kind).toBe("bytecode");
    expect([build.outputs[0].path]).toRun("world\n");
  });

  test("passing undefined doesnt segfault", () => {
    try {
      // @ts-ignore
      Bun.build();
    } catch (error) {
      return;
    }
    throw new Error("should have thrown");
  });

  // https://github.com/oven-sh/bun/issues/12818
  test("sourcemap + build error crash case", async () => {
    const dir = tempDirWithFiles("build", {
      "/src/file1.ts": `
        import { A } from './dir';
        console.log(A);
      `,
      "/src/dir/index.ts": `
        import { B } from "./file3";
        export const A = [B]
      `,
      "/src/dir/file3.ts": `
        import { C } from "../file1"; // error
        export const B = C;
      `,
      "/src/package.json": `
        { "type": "module" }
      `,
      "/src/tsconfig.json": `
        {
          "extends": "../tsconfig.json",
          "compilerOptions": {
              "target": "ESNext",
              "module": "ESNext",
              "types": []
          }
        }
      `,
    });
    const y = await buildNoThrow({
      entrypoints: [join(dir, "src/file1.ts")],
      outdir: join(dir, "out"),
      sourcemap: "external",
      external: ["@minecraft"],
    });
  });

  test("invalid options throws", async () => {
    expect(() => Bun.build({} as any)).toThrow();
    expect(() =>
      Bun.build({
        entrypoints: [],
      } as any),
    ).toThrow();
    expect(() =>
      Bun.build({
        entrypoints: ["hello"],
        format: "invalid",
      } as any),
    ).toThrow();
    expect(() =>
      Bun.build({
        entrypoints: ["hello"],
        target: "invalid",
      } as any),
    ).toThrow();
    expect(() =>
      Bun.build({
        entrypoints: ["hello"],
        sourcemap: "invalid",
      } as any),
    ).toThrow();
  });

  test("returns errors properly", async () => {
    Bun.gc(true);
    const build = await buildNoThrow({
      entrypoints: [join(import.meta.dir, "does-not-exist.ts")],
    });
    expect(build.outputs).toHaveLength(0);
    expect(build.logs).toHaveLength(1);
    expect(build.logs[0]).toBeInstanceOf(BuildMessage);
    expect(build.logs[0].message).toMatch(/ModuleNotFound/);
    expect(build.logs[0].name).toBe("BuildMessage");
    expect(build.logs[0].position).toEqual(null);
    expect(build.logs[0].level).toEqual("error");
    Bun.gc(true);
  });

  test("errors are thrown", async () => {
    Bun.gc(true);
    try {
      await Bun.build({
        entrypoints: [join(import.meta.dir, "does-not-exist.ts")],
      });
      expect.unreachable();
    } catch (e) {
      assert(e instanceof AggregateError);
      expect(e.errors).toHaveLength(1);
      expect(e.errors[0]).toBeInstanceOf(BuildMessage);
      expect(e.errors[0].message).toMatch(/ModuleNotFound/);
      expect(e.errors[0].name).toBe("BuildMessage");
      expect(e.errors[0].position).toEqual(null);
      expect(e.errors[0].level).toEqual("error");
      Bun.gc(true);
    }
  });

  test("returns output files", async () => {
    Bun.gc(true);
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    });
    expect(build.outputs).toHaveLength(1);
    expect(build.logs).toHaveLength(0);
    Bun.gc(true);
  });

  test("Bun.write(BuildArtifact)", async () => {
    Bun.gc(true);
    const tmpdir = tempDirWithFiles("bun-build-api-write", {
      "package.json": `{}`,
    });
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    });
    await Bun.write(path.join(tmpdir, "index.js"), x.outputs[0]);
    expect(readFileSync(path.join(tmpdir, "index.js"), "utf-8")).toMatchSnapshot();
    Bun.gc(true);
  });

  test("outdir + reading out blobs works", async () => {
    Bun.gc(true);
    const fixture = tempDirWithFiles("build-outdir", {
      "package.json": `{}`,
    });
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      outdir: fixture,
    });
    expect(await x.outputs.values().next().value?.text()).toMatchSnapshot();
    Bun.gc(true);
  });

  test("BuildArtifact properties", async () => {
    Bun.gc(true);
    const outdir = tempDirWithFiles("build-artifact-properties", {
      "package.json": `{}`,
    });
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      outdir,
    });
    console.log(await x.outputs[0].text());
    const [blob] = x.outputs;
    expect(blob).toBeTruthy();
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(path.relative(outdir, blob.path)).toBe("index.js");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot("hash");
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(null);
    Bun.gc(true);
  });

  test("BuildArtifact properties + entry.naming", async () => {
    Bun.gc(true);
    const outdir = tempDirWithFiles("build-artifact-properties-entry-naming", {
      "package.json": `{}`,
    });
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      naming: {
        entry: "hello",
      },
      outdir,
    });
    const [blob] = x.outputs;
    expect(blob).toBeTruthy();
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(path.relative(outdir, blob.path)).toBe("hello");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot("hash");
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(null);
    Bun.gc(true);
  });

  test("BuildArtifact properties sourcemap", async () => {
    Bun.gc(true);
    const outdir = tempDirWithFiles("build-artifact-properties-sourcemap", {
      "package.json": `{}`,
    });
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      sourcemap: "external",
      outdir,
    });
    const [blob, map] = x.outputs;
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(path.relative(outdir, blob.path)).toBe("index.js");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot("hash index.js");
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(map);

    expect(map.type).toBe("application/json;charset=utf-8");
    expect(map.size).toBeGreaterThan(1);
    expect(path.relative(outdir, map.path)).toBe("index.js.map");
    expect(map.hash).toBeTruthy();
    expect(map.hash).toMatchSnapshot("hash index.js.map");
    expect(map.kind).toBe("sourcemap");
    expect(map.loader).toBe("file");
    expect(map.sourcemap).toBe(null);
    Bun.gc(true);
  });

  // test("BuildArtifact properties splitting", async () => {
  //   Bun.gc(true);
  //   const x = await Bun.build({
  //     entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
  //     splitting: true,
  //   });
  //   expect(x.outputs).toHaveLength(2);
  //   const [indexBlob, chunkBlob] = x.outputs;

  //   expect(indexBlob).toBeTruthy();
  //   expect(indexBlob.type).toBe("text/javascript;charset=utf-8");
  //   expect(indexBlob.size).toBeGreaterThan(1);
  //   expect(indexBlob.path).toBe("/index.js");
  //   expect(indexBlob.hash).toBeTruthy();
  //   expect(indexBlob.hash).toMatchSnapshot("hash index.js");
  //   expect(indexBlob.kind).toBe("entry-point");
  //   expect(indexBlob.loader).toBe("jsx");
  //   expect(indexBlob.sourcemap).toBe(null);

  //   expect(chunkBlob).toBeTruthy();
  //   expect(chunkBlob.type).toBe("text/javascript;charset=utf-8");
  //   expect(chunkBlob.size).toBeGreaterThan(1);
  //   expect(chunkBlob.path).toBe(`/foo-${chunkBlob.hash}.js`);
  //   expect(chunkBlob.hash).toBeTruthy();
  //   expect(chunkBlob.hash).toMatchSnapshot("hash foo.js");
  //   expect(chunkBlob.kind).toBe("chunk");
  //   expect(chunkBlob.loader).toBe("jsx");
  //   expect(chunkBlob.sourcemap).toBe(null);
  //   Bun.gc(true);
  // });

  test("new Response(BuildArtifact) sets content type", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      outdir: tempDirWithFiles("response-buildartifact", {}),
    });
    const response = new Response(x.outputs[0]);
    expect(response.headers.get("content-type")).toBe("text/javascript;charset=utf-8");
    expect(await response.text()).toMatchSnapshot("response text");
  });

  test.todo("new Response(BuildArtifact) sets etag", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      outdir: tempDirWithFiles("response-buildartifact-etag", {}),
    });
    const response = new Response(x.outputs[0]);
    expect(response.headers.get("etag")).toBeTruthy();
    expect(response.headers.get("etag")).toMatchSnapshot("content-etag");
  });

  // test("BuildArtifact with assets", async () => {
  //   const x = await Bun.build({
  //     entrypoints: [join(import.meta.dir, "./fixtures/with-assets/index.js")],
  //     loader: {
  //       ".blob": "file",
  //       ".png": "file",
  //     },
  //   });
  //   console.log(x);
  //   const [blob, asset] = x.outputs;
  //   expect(blob).toBeTruthy();
  //   expect(blob instanceof Blob).toBe(true);
  //   expect(blob.type).toBe("text/javascript;charset=utf-8");
  //   expect(blob.size).toBeGreaterThan(1);
  //   expect(blob.path).toBe("/index.js");
  //   expect(blob.hash).toBeTruthy();
  //   expect(blob.hash).toMatchSnapshot();
  //   expect(blob.kind).toBe("entry-point");
  //   expect(blob.loader).toBe("jsx");
  //   expect(blob.sourcemap).toBe(null);
  //   throw new Error("test was not fully written");
  // });

  test.concurrent("loader map with an empty-string key is ignored without leaving uninitialized slots", async () => {
    // `JSPropertyIterator` skips empty-name properties, but `loader_names` was being
    // indexed by the property position instead of a dense counter, leaving garbage in
    // the skipped slot that was later read/freed. Run in a subprocess so a crash in the
    // bundler thread surfaces as a test failure instead of taking down the test runner.
    const dir = tempDirWithFiles("bun-build-loader-empty-key", {
      "entry.ts": `export const x: number = 42;\n`,
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const result = await Bun.build({
            entrypoints: [${JSON.stringify(join(dir, "entry.ts"))}],
            loader: { "": "js", ".ts": "ts", ".js": "js" },
          });
          if (!result.success) throw new AggregateError(result.logs, "build failed");
          console.log(JSON.stringify({ success: result.success, outputs: result.outputs.length }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ success: true, outputs: 1 });
    expect(exitCode).toBe(0);
  });

  test.concurrent("rebuilding busts the directory entries cache", async () => {
    Bun.gc(true);
    const tmpdir = tempDirWithFiles("rebuild-bust-dirent-cache", {
      "package.json": `{}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fixtures", "bundler-reloader-script.ts")],
      env: { ...bunEnv, BUNDLER_RELOADER_SCRIPT_TMP_DIR: tmpdir },
      stderr: "pipe",
      stdout: "inherit",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (stderr.length > 0) {
      throw new Error(stderr);
    }
    expect(exitCode).toBe(0);
    Bun.gc(true);
  });

  test.concurrent("errors are returned as an array", async () => {
    const x = await buildNoThrow({
      entrypoints: [join(import.meta.dir, "does-not-exist.ts")],
      outdir: tempDirWithFiles("errors-are-returned-as-an-array", {}),
    });
    expect(x.success).toBe(false);
    expect(x.logs).toHaveLength(1);
    expect(x.logs[0].message).toMatch(/ModuleNotFound/);
    expect(x.logs[0].name).toBe("BuildMessage");
    expect(x.logs[0].position).toEqual(null);
  });

  test.concurrent("warnings do not fail a build", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/jsx-warning/index.jsx")],
      outdir: tempDirWithFiles("warnings-do-not-fail-a-build", {}),
    });
    expect(x.success).toBe(true);
    expect(x.logs).toHaveLength(1);
    expect(x.logs[0].message).toBe(
      '"key" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.',
    );
    expect(x.logs[0].name).toBe("BuildMessage");
    expect(x.logs[0].position).toBeTruthy();
  });

  test.concurrent("module() throws error", async () => {
    expect(() =>
      Bun.build({
        entrypoints: [join(import.meta.dir, "./fixtures/trivial/bundle-ws.ts")],
        plugins: [
          {
            name: "test",
            setup: b => {
              b.module("ad", () => {
                return {
                  exports: {
                    hello: "world",
                  },
                  loader: "object",
                };
              });
            },
          },
        ],
      }),
    ).toThrow();
  });

  test.concurrent("non-object plugins throw invalid argument errors", () => {
    for (const plugin of [null, undefined, 1, "hello", true, false, Symbol.for("hello")]) {
      expect(() => {
        Bun.build({
          entrypoints: [join(import.meta.dir, "./fixtures/trivial/bundle-ws.ts")],
          plugins: [
            // @ts-expect-error
            plugin,
          ],
        });
      }).toThrow("Expected plugin to be an object");
    }
  });

  test.concurrent("hash considers cross chunk imports", async () => {
    Bun.gc(true);
    const fixture = tempDirWithFiles("build-hash-cross-chunk-imports", {
      "entry1.ts": `
        import { bar } from './bar'
        export const entry1 = () => {
          console.log('FOO')
          bar()
        }
      `,
      "entry2.ts": `
        import { bar } from './bar'
        export const entry1 = () => {
          console.log('FOO')
          bar()
        }
      `,
      "bar.ts": `
        export const bar = () => {
          console.log('BAR')
        }
      `,
    });
    const first = await Bun.build({
      entrypoints: [join(fixture, "entry1.ts"), join(fixture, "entry2.ts")],
      outdir: join(fixture, "out"),
      target: "browser",
      splitting: true,
      minify: false,
      naming: "[dir]/[name]-[hash].[ext]",
    });
    if (!first.success) throw new AggregateError(first.logs);
    expect(first.outputs.length).toBe(3);

    writeFileSync(join(fixture, "bar.ts"), readFileSync(join(fixture, "bar.ts"), "utf8").replace("BAR", "BAZ"));

    const second = await Bun.build({
      entrypoints: [join(fixture, "entry1.ts"), join(fixture, "entry2.ts")],
      outdir: join(fixture, "out2"),
      target: "browser",
      splitting: true,
      minify: false,
      naming: "[dir]/[name]-[hash].[ext]",
    });
    if (!second.success) throw new AggregateError(second.logs);
    expect(second.outputs.length).toBe(3);

    const totalUniqueHashes = new Set();
    const allFiles = [...first.outputs, ...second.outputs];
    for (const out of allFiles) totalUniqueHashes.add(out.hash);

    expect(
      totalUniqueHashes.size,
      "number of unique hashes should be 6: three per bundle. the changed foo.ts affects all chunks",
    ).toBe(6);

    // ensure that the hashes are in the path
    for (const out of allFiles) {
      expect(out.path).toInclude(out.hash!);
    }

    Bun.gc(true);
  });

  test.concurrent("ignoreDCEAnnotations works", async () => {
    const fixture = tempDirWithFiles("build-ignore-dce-annotations", {
      "package.json": `{}`,
      "entry.ts": `
        /* @__PURE__ */ console.log(1)
      `,
    });

    const bundle = await Bun.build({
      entrypoints: [join(fixture, "entry.ts")],
      ignoreDCEAnnotations: true,
      minify: true,
      outdir: path.join(fixture, "out"),
    });
    if (!bundle.success) throw new AggregateError(bundle.logs);

    expect(await bundle.outputs[0].text()).toBe("console.log(1);\n");
  });

  test.concurrent("emitDCEAnnotations works", async () => {
    const fixture = tempDirWithFiles("build-emit-dce-annotations", {
      "package.json": `{}`,
      "entry.ts": `
        export const OUT = /* @__PURE__ */ console.log(1)
      `,
    });

    const bundle = await Bun.build({
      entrypoints: [join(fixture, "entry.ts")],
      emitDCEAnnotations: true,
      minify: true,
      outdir: path.join(fixture, "out"),
    });
    if (!bundle.success) throw new AggregateError(bundle.logs);

    expect(await bundle.outputs[0].text()).toBe("var o=/*@__PURE__*/console.log(1);export{o as OUT};\n");
  });

  test.concurrent(
    "you can write onLoad and onResolve plugins using the 'html' loader, and it includes script and link tags as bundled entrypoints",
    async () => {
      const fixture = tempDirWithFiles("build-html-plugins", {
        "index.html": `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="stylesheet" href="./style.css">
            <script src="./script.js"></script>
          </head>
        </html>
      `,
        "style.css": ".foo { color: red; }",

        // Check we actually do bundle the script
        "script.js": "console.log(1 + 2)",
      });

      let onLoadCalled = false;
      let onResolveCalled = false;

      const build = await Bun.build({
        entrypoints: [join(fixture, "index.html")],
        minify: {
          syntax: true,
        },
        plugins: [
          {
            name: "test-plugin",
            setup(build) {
              build.onLoad({ filter: /\.html$/ }, async args => {
                onLoadCalled = true;
                const contents = await Bun.file(args.path).text();
                return {
                  contents: contents.replace("</head>", "<meta name='injected-by-plugin' content='true'></head>"),
                  loader: "html",
                };
              });

              build.onResolve({ filter: /\.(js|css)$/ }, args => {
                onResolveCalled = true;
                return {
                  path: join(fixture, args.path),
                  namespace: "file",
                };
              });
            },
          },
        ],
      });

      expect(build.success).toBe(true);
      expect(onLoadCalled).toBe(true);
      expect(onResolveCalled).toBe(true);

      // Should have 3 outputs - HTML, JS and CSS
      expect(build.outputs).toHaveLength(3);

      // Verify we have one of each type
      const types = build.outputs.map(o => o.type);
      expect(types).toContain("text/html;charset=utf-8");
      expect(types).toContain("text/javascript;charset=utf-8");
      expect(types).toContain("text/css;charset=utf-8");

      // Verify the JS output contains the __dirname
      const js = build.outputs.find(o => o.type === "text/javascript;charset=utf-8");
      expect(await js?.text()).toContain("console.log(3)");

      // Verify our plugin modified the HTML
      const html = build.outputs.find(o => o.type === "text/html;charset=utf-8");
      expect(await html?.text()).toContain("<meta name='injected-by-plugin' content='true'>");
    },
  );
});

test.concurrent("macro with nested object", async () => {
  const dir = tempDirWithFilesAnon({
    "index.ts": `
import { testMacro } from "./macro" assert { type: "macro" };

export const testConfig = testMacro({
  borderRadius: {
    1: "4px",
    2: "8px",
  },
});
    `,
    "macro.ts": `
export function testMacro(val: any) {
  return val;
}
    `,
  });

  const build = await Bun.build({
    entrypoints: [join(dir, "index.ts")],
    minify: true,
  });

  expect(build.outputs).toHaveLength(1);
  expect(build.outputs[0].kind).toBe("entry-point");
  expect(await build.outputs[0].text()).toEqualIgnoringWhitespace(
    `var t={borderRadius:{"1":"4px","2":"8px"}};export{t as testConfig};\n`,
  );
});

// Since NODE_PATH has to be set, we need to run this test outside the bundler tests.
test.concurrent("regression/NODE_PATHBuild api", async () => {
  const dir = tempDirWithFiles("node-path-build", {
    "entry.js": `
      import MyClass from 'MyClass';
      console.log(new MyClass().constructor.name);
    `,
    "src/MyClass.js": `
      export default class MyClass {}
    `,
    "build.js": `
      import { join } from "path";
      
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "entry.js")],
        outdir: join(import.meta.dir, "out"),
      });
      
      if (!build.success) {
        console.error("Build failed:", build.logs);
        process.exit(1);
      }
      
      // Run the built file
      const runProc = Bun.spawn({
        cmd: [process.argv[0], join(import.meta.dir, "out", "entry.js")],
        stdout: "pipe",
        stderr: "pipe",
      });
      
      await runProc.exited;
      const runOutput = await new Response(runProc.stdout).text();
      const runError = await new Response(runProc.stderr).text();
      
      if (runError) {
        console.error("Run error:", runError);
        process.exit(1);
      }
      
      console.log(runOutput.trim());
      
    `,
  });

  // Run the build script with NODE_PATH set
  const proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "build.js")],
    env: {
      ...bunEnv,
      NODE_PATH: join(dir, "src"),
    },
    stdout: "pipe",
    stderr: "pipe",
    cwd: dir,
  });

  await proc.exited;
  const output = await proc.stdout.text();
  const error = await proc.stderr.text();

  expect(error).toBe("");
  expect(output.trim()).toBe("MyClass");
});

test.concurrent("regression/GlobalThis", async () => {
  const dir = tempDirWithFiles("global-this-regression", {
    "entry.js": `
      function identity(x) {
        return x;
      }
  import * as mod1 from  'assert';
  identity(mod1);
import * as mod2 from  'buffer';
identity(mod2);
import * as mod3 from  'console';
identity(mod3);
import * as mod4 from  'constants';
identity(mod4);
import * as mod5 from  'crypto';
identity(mod5);
import * as mod6 from  'domain';
identity(mod6);
import * as mod7 from  'events';
identity(mod7);
import * as mod8 from  'http';
identity(mod8);
import * as mod9 from  'https';
identity(mod9);
import * as mod10 from  'net';
identity(mod10);
import * as mod11 from  'os';
identity(mod11);
import * as mod12 from  'path';
identity(mod12);
import * as mod13 from  'process';
identity(mod13);
import * as mod14 from  'punycode';
identity(mod14);
import * as mod15 from  'stream';
identity(mod15);
import * as mod16 from  'string_decoder';
identity(mod16);
import * as mod17 from  'sys';
identity(mod17);
import * as mod18 from  'timers';
identity(mod18);
import * as mod20 from  'tty';
identity(mod20);
import * as mod21 from  'url';
identity(mod21);
import * as mod22 from  'util';
identity(mod22);
import * as mod23 from  'zlib';
identity(mod23);
      `,
  });

  const build = await Bun.build({
    entrypoints: [join(dir, "entry.js")],
    target: "browser",
  });

  expect(build.success).toBe(true);
  const text = await build.outputs[0].text();
  expect(text).not.toContain("process.env.");
  expect(text).not.toContain(" global.");
  expect(text).toContain(" globalThis.");
});

describe.concurrent("sourcemap boolean values", () => {
  test("sourcemap: true should work (boolean)", async () => {
    const dir = tempDirWithFiles("sourcemap-true-boolean", {
      "index.js": `console.log("hello");`,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      sourcemap: true,
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    expect(build.outputs[0].kind).toBe("entry-point");

    const output = await build.outputs[0].text();
    expect(output).toContain("//# sourceMappingURL=data:application/json;base64,");
  });

  test("sourcemap: false should work (boolean)", async () => {
    const dir = tempDirWithFiles("sourcemap-false-boolean", {
      "index.js": `console.log("hello");`,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      sourcemap: false,
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    expect(build.outputs[0].kind).toBe("entry-point");

    const output = await build.outputs[0].text();
    expect(output).not.toContain("//# sourceMappingURL=");
  });

  test("sourcemap: true with outdir should create linked sourcemap", async () => {
    const dir = tempDirWithFiles("sourcemap-true-outdir", {
      "index.js": `console.log("hello");`,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      outdir: join(dir, "out"),
      sourcemap: true,
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(2);

    const jsOutput = build.outputs.find(o => o.kind === "entry-point");
    const mapOutput = build.outputs.find(o => o.kind === "sourcemap");

    expect(jsOutput).toBeTruthy();
    expect(mapOutput).toBeTruthy();
    expect(jsOutput!.sourcemap).toBe(mapOutput!);

    const jsText = await jsOutput!.text();
    expect(jsText).toContain("//# sourceMappingURL=index.js.map");
  });
});

const originalCwd = process.cwd() + "";

describe("tsconfig option", () => {
  afterEach(() => {
    process.chdir(originalCwd);
  });

  test("should resolve path mappings", async () => {
    const dir = tempDirWithFiles("tsconfig-api-basic", {
      "tsconfig.json": `{
        "compilerOptions": {
          "paths": {
            "@/*": ["./src/*"]
          }
        }
      }`,
      "src/utils.ts": `export const greeting = "Hello World";`,
      "index.ts": `import { greeting } from "@/utils";
export { greeting };`,
    });

    try {
      process.chdir(dir);
      const result = await Bun.build({
        entrypoints: ["./index.ts"],
        tsconfig: "./tsconfig.json",
      });
      expect(result.success).toBe(true);
      expect(result.outputs).toHaveLength(1);
      const output = await result.outputs[0].text();
      expect(output).toContain("Hello World");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("should work from nested directories", async () => {
    const dir = tempDirWithFiles("tsconfig-api-nested", {
      "tsconfig.json": `{
        "compilerOptions": {
          "paths": {
            "@/*": ["./src/*"]
          }
        }
      }`,
      "src/utils.ts": `export const greeting = "Hello World";`,
      "src/nested/index.ts": `import { greeting } from "@/utils";
export { greeting };`,
    });

    try {
      process.chdir(join(dir, "src/nested"));
      const result = await Bun.build({
        entrypoints: ["./index.ts"],
        tsconfig: "../../tsconfig.json",
      });
      expect(result.success).toBe(true);
      expect(result.outputs).toHaveLength(1);
      const output = await result.outputs[0].text();
      expect(output).toContain("Hello World");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("should handle relative tsconfig paths", async () => {
    const dir = tempDirWithFiles("tsconfig-api-relative", {
      "tsconfig.json": `{
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "@/*": ["src/*"]
          }
        }
      }`,
      "configs/build-tsconfig.json": `{
        "extends": "../tsconfig.json",
        "compilerOptions": {
          "baseUrl": ".."
        }
      }`,
      "src/utils.ts": `export const greeting = "Hello World";`,
      "index.ts": `import { greeting } from "@/utils";
export { greeting };`,
    });

    try {
      process.chdir(dir);
      const result = await Bun.build({
        entrypoints: ["./index.ts"],
        tsconfig: "./configs/build-tsconfig.json",
      });
      expect(result.success).toBe(true);
      expect(result.outputs).toHaveLength(1);
      const output = await result.outputs[0].text();
      expect(output).toContain("Hello World");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("onEnd fires before promise resolves with throw: true", async () => {
    const dir = tempDirWithFiles("onend-throwonerror-true", {
      "index.ts": `
        // This will cause a build error
        import { missing } from "./does-not-exist";
        console.log(missing);
      `,
    });

    let onEndCalled = false;
    let onEndCalledBeforeReject = false;
    let promiseRejected = false;

    try {
      await Bun.build({
        entrypoints: [join(dir, "index.ts")],
        throw: true,
        plugins: [
          {
            name: "test-plugin",
            setup(builder) {
              builder.onEnd(result => {
                onEndCalled = true;
                onEndCalledBeforeReject = !promiseRejected;
                // Result should contain error information
                expect(result.success).toBe(false);
                expect(result.logs).toBeDefined();
                expect(result.logs.length).toBeGreaterThan(0);
              });
            },
          },
        ],
      });
      // Should not reach here
      expect(false).toBe(true);
    } catch (error) {
      promiseRejected = true;
      // Verify onEnd was called before promise rejected
      expect(onEndCalled).toBe(true);
      expect(onEndCalledBeforeReject).toBe(true);
    }
  });

  test("onEnd fires before promise resolves with throw: false", async () => {
    const dir = tempDirWithFiles("onend-throwonerror-false", {
      "index.ts": `
        // This will cause a build error
        import { missing } from "./does-not-exist";
        console.log(missing);
      `,
    });

    let onEndCalled = false;
    let onEndCalledBeforeResolve = false;
    let promiseResolved = false;

    const result = await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      throw: false,
      plugins: [
        {
          name: "test-plugin",
          setup(builder) {
            builder.onEnd(result => {
              onEndCalled = true;
              onEndCalledBeforeResolve = !promiseResolved;
              // Result should contain error information
              expect(result.success).toBe(false);
              expect(result.logs).toBeDefined();
              expect(result.logs.length).toBeGreaterThan(0);
            });
          },
        },
      ],
    });

    promiseResolved = true;

    // Verify onEnd was called before promise resolved
    expect(onEndCalled).toBe(true);
    expect(onEndCalledBeforeResolve).toBe(true);
    expect(result.success).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  test("onEnd always fires on successful build", async () => {
    const dir = tempDirWithFiles("onend-success", {
      "index.ts": `
        export const message = "Build successful";
        console.log(message);
      `,
    });

    let onEndCalled = false;
    let onEndCalledBeforeResolve = false;
    let promiseResolved = false;

    const result = await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      throw: true, // Should not matter for successful build
      plugins: [
        {
          name: "test-plugin",
          setup(builder) {
            builder.onEnd(result => {
              onEndCalled = true;
              onEndCalledBeforeResolve = !promiseResolved;
              // Result should indicate success
              expect(result.success).toBe(true);
              expect(result.outputs).toBeDefined();
              expect(result.outputs.length).toBeGreaterThan(0);
            });
          },
        },
      ],
    });

    promiseResolved = true;

    // Verify onEnd was called before promise resolved
    expect(onEndCalled).toBe(true);
    expect(onEndCalledBeforeResolve).toBe(true);
    expect(result.success).toBe(true);
    const output = await result.outputs[0].text();
    expect(output).toContain("Build successful");
  });

  test("multiple onEnd callbacks fire in order before promise settles", async () => {
    const dir = tempDirWithFiles("onend-multiple", {
      "index.ts": `
        // This will cause a build error
        import { missing } from "./not-found";
      `,
    });

    const callOrder: string[] = [];
    let promiseSettled = false;

    const result = await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      throw: false,
      plugins: [
        {
          name: "plugin-1",
          setup(builder) {
            builder.onEnd(() => {
              callOrder.push("first");
              expect(promiseSettled).toBe(false);
            });
          },
        },
        {
          name: "plugin-2",
          setup(builder) {
            builder.onEnd(() => {
              callOrder.push("second");
              expect(promiseSettled).toBe(false);
            });
          },
        },
        {
          name: "plugin-3",
          setup(builder) {
            builder.onEnd(() => {
              callOrder.push("third");
              expect(promiseSettled).toBe(false);
            });
          },
        },
      ],
    });

    promiseSettled = true;

    // All callbacks should have fired in order before promise resolved
    expect(callOrder).toEqual(["first", "second", "third"]);
    // The build actually succeeds because the import is being resolved to nothing
    // What matters is that callbacks fired before promise settled
    expect(result.success).toBeDefined();
  });
});

// On release builds mimalloc's large-allocation arenas make RSS growth too
// non-deterministic to draw a clean line between "leaking" and "not leaking"
// for this path. Under debug/ASAN the allocator behaviour is stable enough to
// measure reliably, so we only assert there.
test.skipIf(!isDebug && !isASAN)(
  "Bun.build sourcemap: 'inline' with no outdir does not leak sourcemap JSON",
  async () => {
    // The in-memory build path used to leak the intermediate sourcemap JSON
    // buffer: it is base64-encoded into the output and then dropped without a
    // free. To make the leak observable we make the sourcemap JSON huge —
    // "sourcesContent" embeds the full input source, so a ~30MB comment in the
    // entry produces a ~30MB sourcemap JSON while keeping the actual bundle
    // work trivial. 8 leaked builds ≈ ~240MB that can never be reclaimed.
    //
    // RSS is noisy between builds, so we settle with several GC+sleep cycles
    // before each sample to let JSC collect the output blobs and mimalloc
    // purge freed pages.
    const dir = tempDirWithFiles("bun-build-inline-sourcemap-leak", {
      "entry.ts": "export const a = 1;\n/* " + Buffer.alloc(30 * 1024 * 1024, "x").toString() + " */\n",
      "run.ts": `
        const entry = process.argv[2];
        async function build() {
          const res = await Bun.build({ entrypoints: [entry], sourcemap: "inline" });
          if (!res.success) throw new AggregateError(res.logs, "build failed");
        }
        async function settle() {
          for (let i = 0; i < 4; i++) { Bun.gc(true); await Bun.sleep(10); }
        }
        for (let i = 0; i < 2; i++) await build();
        await settle();
        const before = process.memoryUsage.rss();
        for (let i = 0; i < 8; i++) await build();
        await settle();
        const after = process.memoryUsage.rss();
        console.log(JSON.stringify({ before, after, growth: after - before }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", join(dir, "run.ts"), join(dir, "entry.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const { growth } = JSON.parse(stdout.trim());
    // Observed (2 warmup + 8 measured, settled): ~220-250MB with the free,
    // ~590-650MB without it.
    expect(growth).toBeLessThan(400 * 1024 * 1024);
  },
  120_000,
);
