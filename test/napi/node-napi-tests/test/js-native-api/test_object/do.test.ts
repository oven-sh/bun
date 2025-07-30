import { build, run } from "../../../harness";
import { sep, basename, dirname } from "node:path";

test("build", async () => {
  await build(import.meta.dir);
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  test(file, () => {
    run(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
