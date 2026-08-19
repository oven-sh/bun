import { basename, dirname, sep } from "node:path";
import { build, run } from "../../../harness";

test("build", async () => {
  await build(import.meta.dir);
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  // Env teardown calls the async cleanup hooks but does not turn the loop
  // until they call napi_remove_async_cleanup_hook (Node does), so the
  // uv_async_t each hook sends never gets its callbacks before the finalizer
  // asserts on the count.
  test.todoIf(["test.js"].includes(file))(file, () => {
    run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
