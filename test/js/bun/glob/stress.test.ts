import { expect, test, describe } from "bun:test";
import { Glob } from "bun";
import { tempFixturesDir } from "./util";

const paths = [
  "test/js/bun/glob/fixtures/file.md",
  "test/js/bun/glob/fixtures/second/file.md",
  "test/js/bun/glob/fixtures/second/nested/file.md",
  "test/js/bun/glob/fixtures/second/nested/directory/file.md",
  "test/js/bun/glob/fixtures/third/library/b/book.md",
  "test/js/bun/glob/fixtures/third/library/a/book.md",
  "test/js/bun/glob/fixtures/first/file.md",
  "test/js/bun/glob/fixtures/first/nested/file.md",
  "test/js/bun/glob/fixtures/first/nested/directory/file.md",
  "test/js/bun/glob/fixtures/first/nested/directory/file.json",
];

tempFixturesDir();

test("Glob.scan stress test", async () => {
  const cwd = "test/js/bun/glob";

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
    new Glob("src/**/*.zig").match("src/cli/package_manager_command.zig");
  }
});
