import { expect, it } from "bun:test";
import { devNull, tmpdir } from "node:os";
import { isWindows } from "harness";

it("offset should work in Bun.file() #4963", async () => {
  const filename = tmpdir() + "/bun.test.offset.txt";
  await Bun.write(filename, "contents");
  const file = Bun.file(filename);
  const slice = file.slice(2, file.size);
  const contents = await slice.text();
  expect(contents).toBe("ntents");
});

it.skipIf(isWindows)("reading a non-regular file blob sliced near max_size does not crash", async () => {
  // Blob.max_size is maxInt(u52). Slicing just below that caused an integer
  // overflow when computing the initial read buffer capacity (size + 16).
  const file = Bun.file(devNull);
  const sliced = file.slice(0, 4503599627370490);
  const result = await sliced.arrayBuffer().catch(e => e);
  // /dev/null has no data; we just care that this does not panic.
  if (result instanceof ArrayBuffer) {
    expect(result.byteLength).toBe(0);
  } else {
    expect(result).toBeInstanceOf(Error);
  }
});
