import { test, expect, describe } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

describe("Bun.build", () => {
  test("rebuilding busts the directory entries cache", () => {
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
  });

  test("outdir + reading out blobs works", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      outdir: "/tmp/bun-build-test-read-out",
    });
    expect(await x.outputs.values().next().value?.text()).toMatchSnapshot();
  });

  test("BuildArtifact properties", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    });
    const [blob] = x.outputs;
    expect(blob).toBeTruthy();
    // expect(blob instanceof Blob).toBe(true);
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(blob.path).toBe("/index.js");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot();
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(null);
  });

  test("BuildArtifact properties sourcemap", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      sourcemap: "inline",
    });
    const [blob] = x.outputs;
    expect(blob).toBeTruthy();
    // expect(blob instanceof Blob).toBe(true);
    expect(blob.type).toBe("text/javascript;charset=utf-8");
    expect(blob.size).toBeGreaterThan(1);
    expect(blob.path).toBe("/index.js");
    expect(blob.hash).toBeTruthy();
    expect(blob.hash).toMatchSnapshot();
    expect(blob.kind).toBe("entry-point");
    expect(blob.loader).toBe("jsx");
    expect(blob.sourcemap).toBe(null);
  });

  test("BuildArtifact properties splitting", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
      splitting: true,
    });
    const [indexBlob, chunkBlob] = x.outputs;
    console.log(indexBlob);
    expect(indexBlob).toBeTruthy();
    // expect(indexBlob instanceof Blob).toBe(true);
    expect(indexBlob.type).toBe("text/javascript;charset=utf-8");
    expect(indexBlob.size).toBeGreaterThan(1);
    expect(indexBlob.path).toBe("/index.js");
    expect(indexBlob.hash).toBeTruthy();
    expect(indexBlob.hash).toMatchSnapshot();
    expect(indexBlob.kind).toBe("entry-point");
    expect(indexBlob.loader).toBe("jsx");
    expect(indexBlob.sourcemap).toBe(null);

    expect(chunkBlob).toBeTruthy();
    // expect(chunkBlob instanceof Blob).toBe(true);
    expect(chunkBlob.type).toBe("text/javascript;charset=utf-8");
    expect(chunkBlob.size).toBeGreaterThan(1);
    expect(chunkBlob.path).toBe(`/foo-${chunkBlob.hash}.js`);
    expect(chunkBlob.hash).toBeTruthy();
    expect(chunkBlob.hash).toMatchSnapshot();
    expect(chunkBlob.kind).toBe("chunk");
    expect(chunkBlob.loader).toBe("jsx");
    expect(chunkBlob.sourcemap).toBe(null);
  });

  test("Bun.write(BuildArtifact)", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    });
    Bun.write("/tmp/bun-build-test-write.js", x.outputs.values().next().value!);
    expect(readFileSync("/tmp/bun-build-test-write.js", "utf-8")).toMatchSnapshot();
  });

  test("new Response(BuildArtifact)", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    });
    const response = new Response(x.outputs.values().next().value!);
    expect(await response.text()).toMatchSnapshot();
    expect(response.headers.get("content-type")).toBe("text/javascript;charset=utf-8");
    expect(response.headers.get("content-length")).toBeGreaterThan(1);
    expect(response.headers.get("content-length")).toMatchSnapshot();
    expect(response.headers.get("content-etag")).toBeTruthy();
    expect(response.headers.get("content-etag")).toMatchSnapshot();
  });

  test("BuildArtifact with assets", async () => {
    // const x = await Bun.build({
    //   entrypoints: [join(import.meta.dir, "./fixtures/with-assets/index.js")],
    //   loader: {
    //     ".png": "file",
    //   },
    // });
    // const indexBlob = x.outputs.get("/index.js")!;
    // expect(indexBlob).toBeTruthy();
    // expect(indexBlob instanceof Blob).toBe(true);
    // expect(indexBlob.type).toBe("text/javascript;charset=utf-8");
    // expect(indexBlob.size).toBeGreaterThan(1);
    // expect(indexBlob.path).toBe("/index.js");
    // expect(indexBlob.hash).toBeTruthy();
    // expect(indexBlob.hash).toMatchSnapshot();
    // expect(indexBlob.kind).toBe("entry-point");
    // expect(indexBlob.loader).toBe("jsx");
    // expect(indexBlob.sourcemap).toBe(null);
    throw new Error("test was not fully written");
  });

  test("errors are returned as an array", async () => {
    const x = await Bun.build({
      entrypoints: [join(import.meta.dir, "does-not-exist.ts")],
    });
    expect(x.errors).toHaveLength(1);
    expect(x.errors[0].message).toMatch(/ModuleNotFound/);
    expect(x.errors[0].name).toBe("BuildError");
    expect(x.errors[0].position).toEqual(null);
  });
});
