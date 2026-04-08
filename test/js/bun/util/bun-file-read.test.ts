import { expect, it } from "bun:test";
import { tempDir } from "harness";
import { tmpdir } from "node:os";

it("offset should work in Bun.file() #4963", async () => {
  const filename = tmpdir() + "/bun.test.offset.txt";
  await Bun.write(filename, "contents");
  const file = Bun.file(filename);
  const slice = file.slice(2, file.size);
  const contents = await slice.text();
  expect(contents).toBe("ntents");
});

it("reading a Bun.file without touching .size first does not crash", async () => {
  // Smoke test for the ReadFile.runAsyncWithFD path: reading a Bun.file
  // without resolving its size first previously could hit an integer
  // overflow at `this.size + 16` and a checked `@intCast` in
  // `resolveSizeAndLastModified` for files whose stat size overflows u52.
  using dir = tempDir("bun-file-read-sentinel", {});
  const filename = String(dir) + "/file.txt";
  await Bun.write(filename, "hello world");
  const file = Bun.file(filename);
  expect(await file.text()).toBe("hello world");
});
