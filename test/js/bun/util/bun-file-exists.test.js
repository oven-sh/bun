import { write } from "bun";
import { expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "fs";
import { tempDir } from "harness";
import { tmpdir } from "os";
import { join } from "path";
test("bun-file-exists", async () => {
  expect(await Bun.file(import.meta.path).exists()).toBeTrue();
  expect(
    await Bun.file(import.meta.path)
      .slice(0, 4)
      .exists(),
  ).toBeTrue();
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
  expect({ size: file.size, text: await file.text() }).toEqual({ size: 4, text: "boop" });
});

// A slice has a size before any stat, so exists() is the only call that stats the file for it.
test.each([
  ["a slice", path => Bun.file(path).slice(0, 4)],
  ["a structuredClone() of a slice", path => structuredClone(Bun.file(path).slice(0, 4))],
])("exists() on %s sees a file that is created after it found none", async (_, make) => {
  using dir = tempDir("bun-file-exists-slice-later", {});
  const path = join(String(dir), "later.txt");
  const slice = make(path);
  expect([await slice.exists(), await slice.exists()]).toEqual([false, false]);
  writeFileSync(path, "boop!");
  expect({ exists: await slice.exists(), text: await slice.text() }).toEqual({ exists: true, text: "boop" });
});
