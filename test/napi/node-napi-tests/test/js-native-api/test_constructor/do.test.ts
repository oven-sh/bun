import { basename, dirname, sep } from "node:path";
import { build, runAsync } from "../../../harness";

// Start the node-gyp build immediately; every test awaits this same promise so the
// concurrent .js tests never race ahead of the compile.
const built = build(import.meta.dir);

test("build", async () => {
  await built;
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  test.concurrent(file, async () => {
    await built;
    await runAsync(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
