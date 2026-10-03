import { write } from "bun";
import { expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "fs";
import { tempDir } from "harness";
import { tmpdir } from "os";
import { join } from "path";
test("bun-file-exists", async () => {
  expect(await Bun.file(import.meta.path).exists()).toBeTrue();
  expect(await Bun.file(import.meta.path + "boop").exists()).toBeFalse();
  expect(await Bun.file(import.meta.dir).exists()).toBeFalse();
  expect(await Bun.file(import.meta.dir + "/").exists()).toBeFalse();
  const temp = join(tmpdir(), "bun-file-exists.test.js");
  try {
    unlinkSync(temp);
  } catch (e) {}
  expect(await Bun.file(temp).exists()).toBeFalse();
  await write(temp, "boop");
  expect(await Bun.file(temp).exists()).toBeTrue();
  unlinkSync(temp);
  expect(await Bun.file(temp).exists()).toBeFalse();
});

test.each([
  ["exists()", file => file.exists()],
  ["size", file => file.size],
])("one Bun.file() sees a file that is created after %s found none", async (_, look) => {
  using dir = tempDir("bun-file-exists-later", {});
  const file = Bun.file(join(String(dir), "later.txt"));
  await look(file);
  expect(await file.exists()).toBeFalse();
  writeFileSync(file.name, "boop");
  expect(await file.exists()).toBeTrue();
});
