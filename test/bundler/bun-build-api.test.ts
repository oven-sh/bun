import { test, expect, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { bunEnv, bunExe } from "harness";

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

  test("invalid options throws", async () => {
    // @ts-expect-error
    expect(() => Bun.build({})).toThrow();
    // @ts-expect-error
    expect(() => Bun.build({ entrypoints: [] })).toThrow();
    // @ts-expect-error
    expect(() => Bun.build({ entrypoints: ["hello"], format: "invalid" })).toThrow();
    // @ts-expect-error
    expect(() => Bun.build({ entrypoints: ["hello"], target: "invalid" })).toThrow();
    // @ts-expect-error
    expect(() => Bun.build({ entrypoints: ["hello"], sourcemap: "invalid" })).toThrow();
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
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    });
    await Bun.write("/tmp/bun-build-test-write.js", x.outputs[0]);
    expect(readFileSync("/tmp/bun-build-test-write.js", "utf-8")).toMatchSnapshot();
    Bun.gc(true);
  });

  test("rebuilding busts the directory entries cache", () => {
    Bun.gc(true);
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), join(import.meta.dir, "bundler-reloader-script.ts")],
      env: bunEnv,
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
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      outdir: "/tmp/bun-build-test-read-out",
    });
    expect(await x.outputs.values().next().value?.text()).toMatchSnapshot();
    Bun.gc(true);
  });

  test("BuildArtifact properties", async () => {
    Bun.gc(true);
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    });
    const [blob] = x.outputs;
    expect(blob).toBeTruthy();
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(blob.path).toBe("./index.js");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot("hash");
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(null);
    Bun.gc(true);
  });

  test("BuildArtifact properties + entry.naming", async () => {
    Bun.gc(true);
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      naming: {
        entry: "hello",
      },
    });
    const [blob] = x.outputs;
    expect(blob).toBeTruthy();
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(blob.path).toBe("./hello");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot("hash");
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(null);
    Bun.gc(true);
  });

  test("BuildArtifact properties sourcemap", async () => {
    Bun.gc(true);
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      sourcemap: "external",
    });
    const [blob, map] = x.outputs;
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(blob.path).toBe("./index.js");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot("hash index.js");
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(map);

    expect(map.type).toBe("application/json;charset=utf-8");
    expect(map.size).toBeGreaterThan(1);
    expect(map.path).toBe("./index.js.map");
    expect(map.hash).toBeTruthy();
    expect(map.hash).toMatchSnapshot("hash index.js.map");
    expect(map.kind).toBe("sourcemap");
    expect(map.loader).toBe("file");
    expect(map.sourcemap).toBe(null);
    Bun.gc(true);
  });

  test("BuildArtifact properties splitting", async () => {
    Bun.gc(true);
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      splitting: true,
    });

    const expected: Pick<import("bun").BuildArtifact, "type" | "path" | "kind" | "loader" | "sourcemap">[] = [
      {
        type: "text/javascript;charset=utf-8",
        path: "./index.js",
        kind: "entry-point",
        loader: "jsx",
        sourcemap: null,
      },
      {
        type: "text/javascript;charset=utf-8",
        path: "./fn.js",
        kind: "chunk",
        loader: "jsx",
        sourcemap: null,
      },
      {
        type: "text/javascript;charset=utf-8",
        path: "./chunk-[hash].js",
        kind: "chunk",
        loader: "js",
        sourcemap: null,
      },
    ];
    expect(x.outputs).toHaveLength(expected.length);

    x.outputs.forEach((blob, i) => {
      const e = expected[i];
      expect(blob).toBeTruthy();
      expect(blob.type).toBe(e.type);
      expect(blob.size).toBePositive();
      expect(blob.hash).toBeTruthy();
      expect(blob.path).toBe(e.path.replace("[hash]", blob.hash as string));
      expect(blob.hash).toMatchSnapshot(`hash ${blob.path}`);
      expect(blob.kind).toBe(e.kind);
      expect(blob.loader).toBe(e.loader);
      expect(blob.sourcemap).toBe(e.sourcemap);
    });

    Bun.gc(true);
  });

  test("new Response(BuildArtifact) sets content type", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    });
    const response = new Response(x.outputs[0]);
    expect(response.headers.get("content-type")).toBe("text/javascript;charset=utf-8");
    expect(await response.text()).toMatchSnapshot("response text");
  });

  test.todo("new Response(BuildArtifact) sets etag", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
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
    });
    expect(x.success).toBe(true);
    expect(x.logs).toHaveLength(1);
    expect(x.logs[0].message).toBe(
      '"key" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.',
    );
    expect(x.logs[0].name).toBe("BuildMessage");
    expect(x.logs[0].position).toBeTruthy();
  });

  test("test bun target", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/bundle-ws.ts")],
      target: "bun",
    });
    expect(x.success).toBe(true);
    const [blob] = x.outputs;
    const content = await blob.text();

    // use bun's ws
    expect(content).toContain('import {WebSocket} from "ws"');
    expect(content).not.toContain("var websocket = __toESM(require_websocket(), 1);");
  });

  test("test node target, issue #3844", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/bundle-ws.ts")],
      target: "node",
    });
    expect(x.success).toBe(true);
    const [blob] = x.outputs;
    const content = await blob.text();

    expect(content).not.toContain('import {WebSocket} from "ws"');
    // depends on the ws package in the test/node_modules.
    expect(content).toContain("var websocket = __toESM(require_websocket(), 1);");
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
});
