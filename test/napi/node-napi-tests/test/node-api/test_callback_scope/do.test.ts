import { isWindows } from "harness";
import { build, run } from "../../../harness";
import { sep, basename, dirname } from "node:path";

test("build", async () => {
  await build(import.meta.dir);
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  // https://github.com/oven-sh/bun/issues/12827 is the latter
  test.todoIf(["test-resolve-async.js", "test-async-hooks.js"].includes(file) || (file === "test.js" && isWindows))(
    file,
    () => {
      run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
    },
  );
}
