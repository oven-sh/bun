import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path, { join } from "path";

describe("Bun.build", () => {
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
    const y = await Bun.build({
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
    const build = await Bun.build({
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
    const x = await Bun.build({
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
});
