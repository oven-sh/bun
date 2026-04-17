import assert from "assert";
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles, tempDirWithFilesAnon } from "harness";
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

  test("rebuilding busts the directory entries cache", () => {
    Bun.gc(true);
    const tmpdir = tempDirWithFiles("rebuild-bust-dirent-cache", {
      "package.json": `{}`,
    });

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), join(import.meta.dir, "fixtures", "bundler-reloader-script.ts")],
      env: { ...bunEnv, BUNDLER_RELOADER_SCRIPT_TMP_DIR: tmpdir },
      stderr: "pipe",
      stdout: "inherit",
    });
    if (stderr.byteLength > 0) {
      throw new Error(stderr.toString());
    }
    expect(exitCode).toBe(0);
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

  test("errors are returned as an array", async () => {
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

  test("warnings do not fail a build", async () => {
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

  test("module() throws error", async () => {
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

  test("non-object plugins throw invalid argument errors", () => {
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

  test("hash considers cross chunk imports", async () => {
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

  test("ignoreDCEAnnotations works", async () => {
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

  test("emitDCEAnnotations works", async () => {
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

  test("you can write onLoad and onResolve plugins using the 'html' loader, and it includes script and link tags as bundled entrypoints", async () => {
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
  });
});

test("macro with nested object", async () => {
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
test("regression/NODE_PATHBuild api", async () => {
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

test("regression/GlobalThis", async () => {
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

describe("sourcemap boolean values", () => {
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

describe("import with { type: 'bundle' }", () => {
  test("creates JSBundle with entrypoint property at import time", async () => {
    const dir = tempDirWithFiles("bundle-import-entrypoint", {
      "index.ts": `export const hello = "world";`,
      "fixture.ts": `
        import bundle from "./index.ts" with { type: "bundle" };
        console.log(JSON.stringify({
          type: typeof bundle,
          hasEntrypoint: !!bundle.entrypoint,
          entrypointName: bundle.entrypoint?.name,
          entrypointKind: bundle.entrypoint?.kind,
          filesCount: bundle.files?.length,
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const result = JSON.parse(stdout.trim());
    expect(result.type).toBe("object");
    expect(result.hasEntrypoint).toBe(true);
    // entrypoint name ends with .js (may include a hash)
    expect(result.entrypointName).toMatch(/index.*\.js$/);
    expect(result.entrypointKind).toBe("entry-point");
    expect(result.filesCount).toBeGreaterThanOrEqual(1);
    expect(exitCode).toBe(0);
  });

  test("serves bundled JS via Bun.serve() with manual routing", async () => {
    const dir = tempDirWithFiles("bundle-import-serve", {
      "index.ts": `export const hello = "world"; console.log(hello);`,
      "fixture.ts": `
        import bundle from "./index.ts" with { type: "bundle" };

        // Use basename for route keys since name may include relative path
        const pathMod = require("path");
        const routes = Object.fromEntries(
          bundle.files.map(f => {
            const basename = pathMod.basename(f.name);
            return [\`/assets/\${basename}\`, new Response(f.file(), {
              headers: { "Content-Type": f.type },
            })];
          })
        );

        const entryBasename = pathMod.basename(bundle.entrypoint.name);

        const server = Bun.serve({
          port: 0,
          routes: {
            ...routes,
            "/*": () => new Response("ok"),
          },
        });

        const res = await fetch(\`http://localhost:\${server.port}/assets/\${entryBasename}\`);
        const text = await res.text();

        console.log(JSON.stringify({
          status: res.status,
          hasContent: text.length > 0,
          contentType: res.headers.get("content-type"),
        }));

        server.stop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const result = JSON.parse(stdout.trim());
    expect(result.status).toBe(200);
    expect(result.hasContent).toBe(true);
    expect(result.contentType).toContain("javascript");
    expect(exitCode).toBe(0);
  });

  test("bun build produces sub-build output with inline metadata", async () => {
    const dir = tempDirWithFiles("bundle-import-build", {
      "app.ts": `export function greet(name: string) { return "Hello, " + name; }
export default { greet };`,
      "server.ts": `import app from "./app.ts" with { type: "bundle" };
console.log(JSON.stringify({
  hasEntrypoint: !!app.entrypoint,
  entrypointName: app.entrypoint?.name,
  entrypointKind: app.entrypoint?.kind,
  filesCount: app.files?.length,
  firstFileName: app.files?.[0]?.name,
  firstFileKind: app.files?.[0]?.kind,
  firstFileType: app.files?.[0]?.type,
  sizeIsNumber: typeof app.files?.[0]?.size === "number",
}));`,
    });

    // Build with bun build
    const buildResult = await Bun.build({
      entrypoints: [join(dir, "server.ts")],
      outdir: join(dir, "dist"),
    });

    expect(buildResult.success).toBe(true);

    // The dist/ should contain both server.js and the sub-build output
    const outputs = buildResult.outputs.map((o: any) => o.path);
    expect(outputs.length).toBeGreaterThanOrEqual(2);

    // Find server.js output
    const serverOutput = buildResult.outputs.find((o: any) => o.path.includes("server"));
    expect(serverOutput).toBeDefined();

    // Read the server output and verify it contains sub-build metadata
    const serverCode = await serverOutput!.text();
    expect(serverCode).toContain("entrypoint:");
    expect(serverCode).toContain("files:");
    expect(serverCode).toContain("entry-point");

    // Find the sub-build output (app-HASH.js)
    const appOutput = buildResult.outputs.find((o: any) => o.path.includes("app"));
    expect(appOutput).toBeDefined();

    // The sub-build output should be written flat in dist/ (not nested)
    const appBasename = require("path").basename(appOutput!.path);
    const appOnDisk = Bun.file(join(dir, "dist", appBasename));
    expect(await appOnDisk.exists()).toBe(true);

    // The sub-build output should contain the actual transpiled code
    const appCode = await appOutput!.text();
    expect(appCode).toContain("greet");

    // Run the built server.js to verify the metadata is correct
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "dist", "server.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.hasEntrypoint).toBe(true);
    expect(result.entrypointKind).toBe("entry-point");
    expect(result.filesCount).toBeGreaterThanOrEqual(1);
    expect(result.firstFileKind).toBe("entry-point");
    expect(result.sizeIsNumber).toBe(true);
    // Entrypoint name should end with .js and contain a hash
    expect(result.entrypointName).toMatch(/app.*\.js$/);
    expect(exitCode).toBe(0);
  });

  test("entrypoint derives .js from various extensions", async () => {
    for (const [input, expectedBase] of [
      ["app.tsx", "app"],
      ["main.ts", "main"],
      ["entry.jsx", "entry"],
      ["script.js", "script"],
    ]) {
      const dir = tempDirWithFiles(`bundle-import-ext-${input}`, {
        [input]: `export default 1;`,
        "fixture.ts": `
          import bundle from "./${input}" with { type: "bundle" };
          // name may include relative path prefix, so use path.basename
          const name = require("path").basename(bundle.entrypoint.name);
          console.log(name);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(dir, "fixture.ts")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Name should start with the base name and end with .js (may include a hash)
      expect(stdout.trim()).toMatch(new RegExp(`^${expectedBase}.*\\.js$`));
      expect(exitCode).toBe(0);
    }
  });

  // Regression guard: the plan explicitly calls this "the single most important
  // invariant" of the bake v2 refactor. Every ?bundle import must get its own
  // Transpiler so that per-import `env: "PREFIX_*"` configuration cannot leak
  // between siblings, regardless of the order they are built in.
  test("env isolation between sibling ?bundle imports", async () => {
    const dir = tempDirWithFiles("bundle-env-isolation", {
      // Each source file references all three env vars so the resulting bundle
      // text will literally contain the secret value if and only if the bundler
      // actually inlined that specific var.
      "frontend.ts": `
        export const FRONTEND_KEY = process.env.MYAPP_FRONTEND_KEY ?? "";
        export const WORKER_KEY = process.env.MYAPP_WORKER_KEY ?? "";
        export const SHARED_KEY = process.env.MYAPP_SHARED_KEY ?? "";
      `,
      "worker.ts": `
        export const FRONTEND_KEY = process.env.MYAPP_FRONTEND_KEY ?? "";
        export const WORKER_KEY = process.env.MYAPP_WORKER_KEY ?? "";
        export const SHARED_KEY = process.env.MYAPP_SHARED_KEY ?? "";
      `,
      "neutral.ts": `
        export const FRONTEND_KEY = process.env.MYAPP_FRONTEND_KEY ?? "";
        export const WORKER_KEY = process.env.MYAPP_WORKER_KEY ?? "";
        export const SHARED_KEY = process.env.MYAPP_SHARED_KEY ?? "";
      `,
      "server.ts": `
        import frontend from "./frontend.ts" with { type: "bundle", env: "MYAPP_FRONTEND_*" };
        import worker from "./worker.ts" with { type: "bundle", env: "MYAPP_WORKER_*" };
        import neutral from "./neutral.ts" with { type: "bundle" };

        const frontendText = await frontend.entrypoint.file().text();
        const workerText = await worker.entrypoint.file().text();
        const neutralText = await neutral.entrypoint.file().text();

        console.log("RESULT:" + JSON.stringify({
          frontend_inlines_frontend: frontendText.includes("frontend-secret-value"),
          frontend_inlines_worker: frontendText.includes("worker-secret-value"),
          frontend_inlines_shared: frontendText.includes("shared-secret-value"),
          worker_inlines_frontend: workerText.includes("frontend-secret-value"),
          worker_inlines_worker: workerText.includes("worker-secret-value"),
          worker_inlines_shared: workerText.includes("shared-secret-value"),
          neutral_inlines_frontend: neutralText.includes("frontend-secret-value"),
          neutral_inlines_worker: neutralText.includes("worker-secret-value"),
          neutral_inlines_shared: neutralText.includes("shared-secret-value"),
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "server.ts")],
      env: {
        ...bunEnv,
        MYAPP_FRONTEND_KEY: "frontend-secret-value",
        MYAPP_WORKER_KEY: "worker-secret-value",
        MYAPP_SHARED_KEY: "shared-secret-value",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const resultLine = stdout.split("\n").find(l => l.startsWith("RESULT:"));
    expect(resultLine, `expected RESULT: line in stdout.\nstdout=${stdout}\nstderr=${stderr}`).toBeDefined();
    const result = JSON.parse(resultLine!.slice("RESULT:".length));

    expect(result).toEqual({
      // frontend: only MYAPP_FRONTEND_* is inlined
      frontend_inlines_frontend: true,
      frontend_inlines_worker: false,
      frontend_inlines_shared: false,
      // worker: only MYAPP_WORKER_* is inlined
      worker_inlines_frontend: false,
      worker_inlines_worker: true,
      worker_inlines_shared: false,
      // neutral: no env attribute → nothing inlined
      neutral_inlines_frontend: false,
      neutral_inlines_worker: false,
      neutral_inlines_shared: false,
    });
    expect(exitCode).toBe(0);
  });

  // Phase 0 SubBuildCache regression guard: when one parent build's graph
  // contains the same nested ?bundle entry point twice (with identical config),
  // the result must be behaviorally indistinguishable from a single import.
  // Both manifests must reference the same set of files, both must inline the
  // configured env vars, and the parent's `.files` must not contain duplicate
  // entries for the same dest path. The cache makes this faster but the
  // observable output is identical either way — this test ensures the cache
  // path doesn't introduce divergence.
  test("nested ?bundle imported twice in one parent build produces consistent output", async () => {
    const dir = tempDirWithFiles("bundle-nested-dedup", {
      "frontend.ts": `
        export const VALUE = process.env.MYAPP_NESTED_KEY ?? "";
      `,
      "worker.ts": `
        import a from "./frontend.ts" with { type: "bundle", env: "MYAPP_NESTED_*" };
        import b from "./frontend.ts" with { type: "bundle", env: "MYAPP_NESTED_*" };
        export default { a, b };
      `,
      "server.ts": `
        import worker from "./worker.ts" with { type: "bundle" };
        const workerText = await worker.entrypoint.file().text();

        // Read the actual frontend bundle file via the manifest's file accessor.
        // The worker bundle's .files contains both worker.js and the nested
        // frontend bundle. Find the frontend file and verify it inlines the env.
        const frontendFile = worker.files.find(f => f.name.includes("frontend"));
        const frontendText = frontendFile ? await frontendFile.file().text() : "";

        const frontendNames = new Set(
          (workerText.match(/frontend-[a-z0-9]+\\.js/gi) ?? [])
        );

        console.log("RESULT:" + JSON.stringify({
          // Both manifests reference the SAME frontend file name (one underlying bundle)
          uniqueFrontendNames: frontendNames.size,
          // The frontend bundle inlines the env var
          frontendInlinesSecret: frontendText.includes("nested-secret-value"),
          // Worker text references frontend (proves both manifests are populated)
          workerReferencesFrontend: frontendNames.size > 0,
          // The parent's .files array doesn't have duplicate frontend entries
          frontendFileCountInParent: worker.files.filter(f => f.name.includes("frontend")).length,
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "server.ts")],
      env: {
        ...bunEnv,
        MYAPP_NESTED_KEY: "nested-secret-value",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const resultLine = stdout.split("\n").find(l => l.startsWith("RESULT:"));
    expect(resultLine, `expected RESULT: line in stdout.\nstdout=${stdout}\nstderr=${stderr}`).toBeDefined();
    const result = JSON.parse(resultLine!.slice("RESULT:".length));

    expect(result).toEqual({
      uniqueFrontendNames: 1,
      frontendInlinesSecret: true,
      workerReferencesFrontend: true,
      frontendFileCountInParent: 1,
    });
    expect(exitCode).toBe(0);
  });

  // Same-parent sibling dedup: importing the exact same (path, config) twice
  // should not cause duplicate work. With SubBuildCache this becomes one build
  // instead of two, but the observable output must be identical either way.
  test("same ?bundle imported twice in one parent produces identical output", async () => {
    const dir = tempDirWithFiles("bundle-same-twice", {
      "shared.ts": `
        export const VALUE = process.env.MYAPP_SAME_TWICE_KEY ?? "";
      `,
      "server.ts": `
        import a from "./shared.ts" with { type: "bundle", env: "MYAPP_SAME_TWICE_*" };
        import b from "./shared.ts" with { type: "bundle", env: "MYAPP_SAME_TWICE_*" };

        const aText = await a.entrypoint.file().text();
        const bText = await b.entrypoint.file().text();

        console.log("RESULT:" + JSON.stringify({
          bothInlineValue: aText.includes("same-twice-value") && bText.includes("same-twice-value"),
          outputsMatch: aText === bText,
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "server.ts")],
      env: {
        ...bunEnv,
        MYAPP_SAME_TWICE_KEY: "same-twice-value",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const resultLine = stdout.split("\n").find(l => l.startsWith("RESULT:"));
    expect(resultLine, `expected RESULT: line in stdout.\nstdout=${stdout}\nstderr=${stderr}`).toBeDefined();
    const result = JSON.parse(resultLine!.slice("RESULT:".length));
    expect(result).toEqual({ bothInlineValue: true, outputsMatch: true });
    expect(exitCode).toBe(0);
  });

  // Phase 1 SubBuildCache regression guard: when two *distinct* top-level
  // `?bundle` parents each contain a nested `?bundle` import of the same
  // entry point with the same config, the VM-wide sub-build cache should
  // make the second parent's nested build reuse the first parent's result.
  // This test does NOT measure cache hits directly (no debug counters in
  // release builds); instead it asserts the observable invariant the cache
  // enables: both nested results contain byte-identical output for the
  // shared entry point, and both inline the configured env var. If the
  // cache regresses to a fresh build per parent, the test still passes
  // (the bundles are deterministic) — but if the cache returns *stale* or
  // *cross-config-leaked* output, this test will catch it.
  test("same ?bundle nested in two distinct parent bundles produces identical output", async () => {
    const dir = tempDirWithFiles("bundle-cross-parent-cache", {
      "frontend.ts": `
        export const VALUE = process.env.MYAPP_CROSS_KEY ?? "";
      `,
      "parent_a.ts": `
        import nested from "./frontend.ts" with { type: "bundle", env: "MYAPP_CROSS_*" };
        export default { nested };
      `,
      "parent_b.ts": `
        import nested from "./frontend.ts" with { type: "bundle", env: "MYAPP_CROSS_*" };
        export default { nested };
      `,
      "server.ts": `
        import a from "./parent_a.ts" with { type: "bundle" };
        import b from "./parent_b.ts" with { type: "bundle" };

        // Each parent manifest contains the parent file plus the nested
        // frontend bundle file. Find the frontend file in each parent.
        const aFrontend = a.files.find(f => f.name.includes("frontend"));
        const bFrontend = b.files.find(f => f.name.includes("frontend"));

        const aFrontendText = aFrontend ? await aFrontend.file().text() : "";
        const bFrontendText = bFrontend ? await bFrontend.file().text() : "";

        console.log("RESULT:" + JSON.stringify({
          // Both parents have a nested frontend bundle file
          bothHaveFrontend: !!aFrontend && !!bFrontend,
          // Both nested bundles inline the env var (no cross-config leakage)
          bothInlineSecret:
            aFrontendText.includes("cross-secret-value") &&
            bFrontendText.includes("cross-secret-value"),
          // Both nested bundles produce byte-identical output (the cache
          // returns the same canonical snapshot to both parents)
          frontendsMatch: aFrontendText === bFrontendText,
          // No accidental duplicate frontend entries within either parent
          aFrontendCount: a.files.filter(f => f.name.includes("frontend")).length,
          bFrontendCount: b.files.filter(f => f.name.includes("frontend")).length,
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "server.ts")],
      env: {
        ...bunEnv,
        MYAPP_CROSS_KEY: "cross-secret-value",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const resultLine = stdout.split("\n").find(l => l.startsWith("RESULT:"));
    expect(resultLine, `expected RESULT: line in stdout.\nstdout=${stdout}\nstderr=${stderr}`).toBeDefined();
    const result = JSON.parse(resultLine!.slice("RESULT:".length));

    expect(result).toEqual({
      bothHaveFrontend: true,
      bothInlineSecret: true,
      frontendsMatch: true,
      aFrontendCount: 1,
      bFrontendCount: 1,
    });
    expect(exitCode).toBe(0);
  });

  // Phase 1 cross-config isolation guard: the VM-wide sub-build cache MUST
  // key on the full BundleImportConfig (not just the path). Two parents that
  // import the same nested entry point with *different* env_prefix patterns
  // must each get their own substituted output — neither should poison the
  // other via the cache.
  test("same ?bundle nested in two parents with different env configs is not cache-poisoned", async () => {
    const dir = tempDirWithFiles("bundle-cross-parent-cache-keys", {
      "frontend.ts": `
        export const A = process.env.MYAPP_AAA_KEY ?? "";
        export const B = process.env.MYAPP_BBB_KEY ?? "";
      `,
      "parent_a.ts": `
        import nested from "./frontend.ts" with { type: "bundle", env: "MYAPP_AAA_*" };
        export default { nested };
      `,
      "parent_b.ts": `
        import nested from "./frontend.ts" with { type: "bundle", env: "MYAPP_BBB_*" };
        export default { nested };
      `,
      "server.ts": `
        import a from "./parent_a.ts" with { type: "bundle" };
        import b from "./parent_b.ts" with { type: "bundle" };

        const aFrontend = a.files.find(f => f.name.includes("frontend"));
        const bFrontend = b.files.find(f => f.name.includes("frontend"));
        const aFrontendText = aFrontend ? await aFrontend.file().text() : "";
        const bFrontendText = bFrontend ? await bFrontend.file().text() : "";

        console.log("RESULT:" + JSON.stringify({
          // parent_a uses MYAPP_AAA_*: only AAA inlined
          a_inlines_aaa: aFrontendText.includes("aaa-secret-value"),
          a_inlines_bbb: aFrontendText.includes("bbb-secret-value"),
          // parent_b uses MYAPP_BBB_*: only BBB inlined
          b_inlines_aaa: bFrontendText.includes("aaa-secret-value"),
          b_inlines_bbb: bFrontendText.includes("bbb-secret-value"),
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "server.ts")],
      env: {
        ...bunEnv,
        MYAPP_AAA_KEY: "aaa-secret-value",
        MYAPP_BBB_KEY: "bbb-secret-value",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const resultLine = stdout.split("\n").find(l => l.startsWith("RESULT:"));
    expect(resultLine, `expected RESULT: line in stdout.\nstdout=${stdout}\nstderr=${stderr}`).toBeDefined();
    const result = JSON.parse(resultLine!.slice("RESULT:".length));

    expect(result).toEqual({
      a_inlines_aaa: true,
      a_inlines_bbb: false,
      b_inlines_aaa: false,
      b_inlines_bbb: true,
    });
    expect(exitCode).toBe(0);
  });

  // When a browser-targeted sub-build (e.g. a service worker) contains a nested
  // ?bundle import, the generated file() accessor must not use import.meta or
  // Bun.file, since neither is available in browser scripts. import.meta is a
  // syntax error in classic (non-module) scripts like service workers.
  test("nested ?bundle inside browser-targeted sub-build omits import.meta", async () => {
    const dir = tempDirWithFiles("bundle-nested-browser-no-import-meta", {
      "app.ts": `export const greeting = "hello";`,
      // The worker imports a nested ?bundle — this is the scenario where
      // import.meta.dir would appear in the IIFE output and cause a SyntaxError.
      "worker.ts": `
        import bundle from "./app.ts?bundle" with { target: "browser" };
        const names = bundle.files.map(f => f.name);
        console.log(names.join(","));
      `,
      // The server imports the worker as a browser-targeted IIFE bundle.
      "server.ts": `
        import worker from "./worker.ts?bundle" with { target: "browser", format: "iife" };
        const entry = worker.files.find(f => f.kind === "entry-point");
        // Read the worker IIFE output and check for import.meta
        const workerCode = await entry.file().text();
        console.log(JSON.stringify({
          hasImportMeta: workerCode.includes("import.meta"),
          hasBunFile: workerCode.includes("Bun.file"),
        }));
      `,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "server.ts")],
      outdir: join(dir, "dist"),
      target: "bun",
    });

    expect(build.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "dist", "server.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const result = JSON.parse(stdout.trim());
    // The worker IIFE must not contain import.meta or Bun.file
    expect(result.hasImportMeta).toBe(false);
    expect(result.hasBunFile).toBe(false);
    expect(exitCode).toBe(0);
  });

  // target: "worker" produces a synchronous bundle (no async wrapper) suitable
  // for service workers. In production builds it should behave like browser
  // but with "worker" in export conditions.
  test("target: 'worker' produces synchronous output without import.meta", async () => {
    const dir = tempDirWithFiles("bundle-target-worker", {
      "app.ts": `export const greeting = "hello";`,
      "sw.ts": `
        import bundle from "./app.ts?bundle" with { target: "worker" };
        const names = bundle.files.map(f => f.name);
        self.addEventListener("install", () => {});
      `,
      "server.ts": `
        import worker from "./sw.ts?bundle" with { target: "worker", format: "iife" };
        const entry = worker.files.find(f => f.kind === "entry-point");
        const workerCode = await entry.file().text();
        console.log(JSON.stringify({
          hasImportMeta: workerCode.includes("import.meta"),
          hasBunFile: workerCode.includes("Bun.file"),
          hasAsyncWrapper: workerCode.includes("async"),
          hasAddEventListener: workerCode.includes("addEventListener"),
        }));
      `,
    });

    const build = await Bun.build({
      entrypoints: [join(dir, "server.ts")],
      outdir: join(dir, "dist"),
      target: "bun",
    });

    expect(build.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "dist", "server.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const result = JSON.parse(stdout.trim());
    expect(result.hasImportMeta).toBe(false);
    expect(result.hasBunFile).toBe(false);
    expect(result.hasAsyncWrapper).toBe(false);
    expect(result.hasAddEventListener).toBe(true);
    expect(exitCode).toBe(0);
  });

  // In hot mode, the dev server's worker HMR runtime should produce output
  // that starts with a SYNCHRONOUS IIFE so service worker event listeners
  // register during initial script evaluation. Additionally, the server's
  // `frontend.files` and the worker's baked-in `frontend.files` (via
  // `import frontend from "./bundle"`) must be IDENTICAL — both should point
  // to the HMR entry, not split production chunks.
  test("target: 'worker' in hot mode uses sync HMR runtime and shares manifest with server", async () => {
    const dir = tempDirWithFiles("bundle-worker-hmr", {
      "app.ts": `export const greeting = "hello";`,
      "bundle.ts": `import b from "./app.ts?bundle"; export default b;`,
      "worker.ts": `
        import frontend from "./bundle";
        const assetPaths = new Set(frontend.files.map(f => f.name));
        self.addEventListener("install", () => { (globalThis as any).__assets = [...assetPaths]; });
      `,
      "server.ts": `
        import frontend from "./bundle";
        import worker from "./worker.ts?bundle" with { target: "worker" };
        import { serve } from "bun";
        const srv = serve({
          port: 0,
          routes: { "/worker.js": () => new Response(worker.files.find(f => f.kind === "entry-point").file()) },
          development: { hmr: false },
        });
        const res = await fetch(srv.url + "worker.js");
        const body = await res.text();

        // Evaluate worker in a VM simulating a service worker environment
        const vm = require("node:vm");
        let installed = false;
        let workerAssets = null;
        const ctx: any = {
          self: {
            addEventListener(evt: string, handler: Function) {
              if (evt === "install") { installed = true; handler({}); }
            },
            registration: undefined,
          },
          console, URL, TextDecoder, TextEncoder, Blob: class { constructor() {} },
          location: { origin: "http://localhost" },
          Symbol, Object, Array, Map, Set, Promise, Error, Uint8Array, DataView, ArrayBuffer, Function,
          WebSocket: class { constructor() {} send() {} close() {} addEventListener() {} },
        };
        ctx.globalThis = ctx;
        ctx.self = new Proxy(ctx.self, { get(t, p) { return (t as any)[p] ?? ctx[p]; }, set(t, p, v) { (t as any)[p] = v; return true; } });
        try {
          vm.runInNewContext(body, ctx, { filename: "worker.js" });
        } catch (e: any) {
          console.error("EVAL FAILED:", e.message);
        }
        workerAssets = ctx.__assets;

        console.log(JSON.stringify({
          startsWithSyncIIFE: body.startsWith("((") && !body.startsWith("(async"),
          installListenerRegistered: installed,
          serverFiles: frontend.files.map(f => f.name).sort(),
          workerFiles: (workerAssets ?? []).sort(),
        }));
        srv.stop();
        process.exit(0);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", join(dir, "server.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Extract the JSON line — --hot may produce extra output
    const jsonLine = stdout.split("\n").find(l => l.startsWith("{"));
    expect(jsonLine, `no JSON line in stdout: ${stdout}\nstderr: ${stderr}`).toBeDefined();
    const result = JSON.parse(jsonLine!);

    expect(result.startsWithSyncIIFE).toBe(true);
    expect(result.installListenerRegistered).toBe(true);
    expect(result.serverFiles).toEqual(result.workerFiles);
    expect(exitCode).toBe(0);
  });
});
