import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("Bun.write with append: true appends to existing file", async () => {
  using tmp = tempDir("bun-write-append-existing", {});

  const file = Bun.file(join(tmp, "file.txt"));

  await Bun.write(file, "hello");
  await Bun.write(file, " bun", { append: true });

  expect(await file.text()).toBe("hello bun");
  expect(file.size).toBe(9);
});

test("Bun.write with append: true creates file if it does not exist", async () => {
  using tmp = tempDir("bun-write-append-create", {});

  const file = Bun.file(join(tmp, "file.txt"));

  await Bun.write(file, "hello", { append: true });
  await Bun.write(file, " bun", { append: true });

  expect(await Bun.file(join(tmp, "file.txt")).text()).toBe("hello bun");
  expect(Bun.file(join(tmp, "file.txt")).size).toBe(9);
});

test("Bun.file().write with append: true appends to existing file", async () => {
  using tmp = tempDir("bun-file-write-append-existing", {});

  const file = Bun.file(join(tmp, "file.txt"));

  await file.write("hello");
  await file.write(" bun", { append: true });

  expect(await file.text()).toBe("hello bun");
  expect(file.size).toBe(9);
});

test("Bun.file().write with append: true creates file if it does not exist", async () => {
  using tmp = tempDir("bun-file-write-append-create", {});

  const file = Bun.file(join(tmp, "file.txt"));

  await file.write("hello", { append: true });
  await file.write(" bun", { append: true });

  expect(await file.text()).toBe("hello bun");
  expect(file.size).toBe(9);
});
