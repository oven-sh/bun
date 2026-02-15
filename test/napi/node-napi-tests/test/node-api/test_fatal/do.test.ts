import { basename, dirname, sep } from "node:path";
import { build, run } from "../../../harness";
import { isWindows } from "harness";

test("build", async () => {
  await build(import.meta.dir);
}, isWindows ? 60_000 : undefined);

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  test.todoIf(["test.js", "test2.js", "test_threads.js"].includes(file))(file, () => {
    run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
