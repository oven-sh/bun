import { $ } from "bun";
import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { rmSync } from "node:fs";
import { join } from "path";

test("$ is lazy", async () => {
  const base = tempDirWithFiles("bun-lazy-test", {
    "bun-lazy": "789",
  });
  const path = join(base, "bun-lazy");
  rmSync(path, { force: true, recursive: true });
  const pending = $`echo 123 > ${path}`;
  expect(async () => await Bun.file(path).text()).toThrow();
  await Bun.write(path, "456");
  expect(await Bun.file(path).text()).toBe("456");
  await pending;
  expect(await Bun.file(path).text()).toBe("123\n");
});
