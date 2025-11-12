import { basename, dirname, sep } from "node:path";
import { build, run } from "../../../harness";
import { isWindows } from "harness";

test("build", async () => {
  await build(import.meta.dir);
}, isWindows ? 30_000 : 5_000);

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  // crash inside uv_thread_create
  test.todoIf(["test.js", "test_legacy_uncaught_exception.js"].includes(file))(file, () => {
    run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
