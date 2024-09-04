import { Glob } from "bun";
import { beforeAll, test } from "bun:test";
import path from "path";
import { tempFixturesDir } from "./util";
const paths = [
  path.join(import.meta.dir, "fixtures/file.md"),
  path.join(import.meta.dir, "fixtures/second/file.md"),
  path.join(import.meta.dir, "fixtures/second/nested/file.md"),
  path.join(import.meta.dir, "fixtures/second/nested/directory/file.md"),
  path.join(import.meta.dir, "fixtures/third/library/b/book.md"),
  path.join(import.meta.dir, "fixtures/third/library/a/book.md"),
  path.join(import.meta.dir, "fixtures/first/file.md"),
  path.join(import.meta.dir, "fixtures/first/nested/file.md"),
  path.join(import.meta.dir, "fixtures/first/nested/directory/file.md"),
  path.join(import.meta.dir, "fixtures/first/nested/directory/file.json"),
];

beforeAll(() => {
  tempFixturesDir();
});

test("Glob.scan stress test", async () => {
  const cwd = import.meta.dir;

  await Promise.all(
    Array(1000)
      .fill(null)
      .map(() =>
        Array.fromAsync(new Glob("src/**/*.zig").scan({ cwd })).then(results => {
          const set = new Set(results);
          return set.size == paths.length && paths.every(path => set.has(path));
        }),
      ),
  );
});

test("Glob.match stress test", () => {
  for (let i = 0; i < 10000; i++) {
    if (!new Glob("src/**/*.zig").match("src/cli/package_manager_command.zig")) {
      throw new Error("test failed on run " + i);
    }
  }
});
