import { isWindows } from "harness";
import { basename, dirname, sep } from "node:path";
import { build, run } from "../../../harness";

test("build", async () => {
  await build(import.meta.dir);
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  test.todoIf(
    // uv_queue_work is a not-implemented stub on POSIX; only Windows runs a real libuv loop.
    (file === "test-resolve-async.js" && !isWindows) ||
      file === "test-async-hooks.js" ||
      // https://github.com/oven-sh/bun/issues/12827
      (file === "test.js" && isWindows),
  )(file, () => {
    run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
