import { afterAll, expect, test } from "bun:test";
import { join } from "path";

test("BuildArtifact properties splitting", async () => {
  Bun.gc(true);
  const x = await Bun.build({
    entrypoints: [join(import.meta.dir, "./fixtures/trivial/index.js")],
    splitting: true,
  });
  expect(x.outputs).toHaveLength(2);
  const [indexBlob, chunkBlob] = x.outputs;

  expect(indexBlob).toBeTruthy();
  expect(indexBlob.type).toBe("text/javascript;charset=utf-8");
  expect(indexBlob.size).toBeGreaterThan(1);
  expect(indexBlob.path).toBe("/index.js");
  expect(indexBlob.hash).toBeTruthy();
  expect(indexBlob.hash).toMatchSnapshot();
  expect(indexBlob.kind).toBe("entry-point");
  expect(indexBlob.loader).toBe("jsx");
  expect(indexBlob.sourcemap).toBe(null);

  expect(chunkBlob).toBeTruthy();
  expect(chunkBlob.type).toBe("text/javascript;charset=utf-8");
  expect(chunkBlob.size).toBeGreaterThan(1);
  expect(chunkBlob.path).toBe(`/foo-${chunkBlob.hash}.js`);
  expect(chunkBlob.hash).toBeTruthy();
  expect(chunkBlob.hash).toMatchSnapshot();
  expect(chunkBlob.kind).toBe("chunk");
  expect(chunkBlob.loader).toBe("jsx");
  expect(chunkBlob.sourcemap).toBe(null);
  Bun.gc(true);
});
