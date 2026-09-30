import { basename, dirname, sep } from "node:path";
import { build, run } from "../../../harness";

test("build", async () => {
  await build(import.meta.dir);
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  // unsupported uv function: uv_sleep (node-options.js runs the same addon;
  // it only appeared to pass while bun -e swallowed the child's exception)
  test.todoIf(["test.js", "node-options.js"].includes(file))(file, () => {
    run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
