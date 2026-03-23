import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("Bun.Archive includes file content when using Bun.file() as input", async () => {
  const content = "Hello, World! This is test content.\n";

  using dir = tempDir("archive-file-input", {
    "input.txt": content,
  });

  const archive = new Bun.Archive({
    "test.txt": Bun.file(`${dir}/input.txt`),
  });

  const files = await archive.files();
  const f = files.get("test.txt");
  expect(f).toBeDefined();
  expect(await f!.text()).toBe(content);
  expect(f!.size).toBe(content.length);
});

test("Bun.Archive handles multiple Bun.file() entries", async () => {
  using dir = tempDir("archive-multi-file", {
    "a.txt": "file a content",
    "b.txt": "file b content",
  });

  const archive = new Bun.Archive({
    "a.txt": Bun.file(`${dir}/a.txt`),
    "b.txt": Bun.file(`${dir}/b.txt`),
    "c.txt": "inline content",
  });

  const files = await archive.files();
  expect(await files.get("a.txt")!.text()).toBe("file a content");
  expect(await files.get("b.txt")!.text()).toBe("file b content");
  expect(await files.get("c.txt")!.text()).toBe("inline content");
});

test("Bun.Archive roundtrips Bun.file() through Bun.write", async () => {
  const content = "roundtrip test content";

  using dir = tempDir("archive-roundtrip", {
    "source.txt": content,
  });

  const archive = new Bun.Archive({
    "dest.txt": Bun.file(`${dir}/source.txt`),
  });

  await Bun.write(`${dir}/output.tar`, archive);

  const loaded = new Bun.Archive(await Bun.file(`${dir}/output.tar`).bytes());
  const files = await loaded.files();
  expect(await files.get("dest.txt")!.text()).toBe(content);
});
