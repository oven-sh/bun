import { isWindows } from "harness";
import { basename, dirname, sep } from "node:path";
import { build, run } from "../../../harness";

test("build", async () => {
  await build(import.meta.dir);
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  // test-async-hooks.js: https://github.com/oven-sh/bun/issues/12827
  // test-resolve-async.js on Windows: the process exits before the
  // after_work_cb of a uv_queue_work on napi_get_uv_event_loop's loop runs
  // ("Mismatched noop function calls. Expected exactly 1, actual 0").
  // test.js on Windows: todo since the suite was imported, for a reason this
  // file does not record; it is unrelated to the line above.
  test.todoIf(
    file === "test-async-hooks.js" || (["test.js", "test-resolve-async.js"].includes(file) && isWindows),
  )(file, () => {
    run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
