import { isWindows } from "harness";
import { basename, dirname, sep } from "node:path";
import { build, run } from "../../../harness";

test("build", async () => {
  await build(import.meta.dir);
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  // test-async-hooks.js: https://github.com/oven-sh/bun/issues/12827
  // test-resolve-async.js on Windows: the process exits before uv_queue_work's after_work_cb runs.
  test.todoIf(
    file === "test-async-hooks.js" || (["test.js", "test-resolve-async.js"].includes(file) && isWindows),
  )(file, () => {
    run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
