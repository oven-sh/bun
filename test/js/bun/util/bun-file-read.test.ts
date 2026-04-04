import { expect, it } from "bun:test";
import { isPosix } from "harness";
import { tmpdir } from "node:os";

it("offset should work in Bun.file() #4963", async () => {
  const filename = tmpdir() + "/bun.test.offset.txt";
  await Bun.write(filename, "contents");
  const file = Bun.file(filename);
  const slice = file.slice(2, file.size);
  const contents = await slice.text();
  expect(contents).toBe("ntents");
});

it.skipIf(!isPosix)("slicing Bun.file() by a non-zero offset rejects rather than overflowing", async () => {
  // Regression: ReadFile.runAsyncWithFD computed buffer capacity as
  // `this.size + 16`, which overflowed u52 when `this.size` approached
  // Blob.max_size (2^52 - 1). The fix uses saturating addition and
  // propagates the OOM via system_error so the promise rejects.
  const file = Bun.file("/dev/zero");
  const sliced = file.slice(1);
  await expect(sliced.text()).rejects.toThrow();
}, 5000);
