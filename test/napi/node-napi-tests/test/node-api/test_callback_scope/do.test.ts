import { isWindows } from "harness";
import { basename, dirname, sep } from "node:path";
import { build, run } from "../../../harness";

test("build", async () => {
  await build(import.meta.dir);
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  // crash inside uv_queue_work
  // https://github.com/oven-sh/bun/issues/12827 is the latter
  test.todoIf(["test-resolve-async.js", "test-async-hooks.js"].includes(file) || (file === "test.js" && isWindows))(
    file,
    () => {
      run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
    },
  );
}
