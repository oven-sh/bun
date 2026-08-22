import { isWindows } from "harness";
import { basename, dirname, sep } from "node:path";
import { build, run } from "../../../harness";

test("build", async () => {
  await build(import.meta.dir);
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  // The hooks complete through a uv_async_t on the env's loop, which Bun only
  // has on Windows: on POSIX, uv_async_init crashes (not implemented).
  test.todoIf(file === "test.js" && !isWindows)(file, () => {
    run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
