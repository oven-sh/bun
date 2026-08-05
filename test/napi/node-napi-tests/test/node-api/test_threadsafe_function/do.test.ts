import { basename, dirname, sep } from "node:path";
import { build, runAsync } from "../../../harness";

// Start the node-gyp build immediately; every test awaits this same promise so the
// concurrent .js tests never race ahead of the compile and the addon builds only once.
const built = build(import.meta.dir);

test("build", async () => {
  await built;
});

for (const file of Array.from(new Bun.Glob("*.js").scanSync(import.meta.dir))) {
  // test.js: crash inside uv_thread_create.
  // test_legacy_uncaught_exception.js: --no-force-node-api-uncaught-exceptions-policy is
  // not implemented, so the error still reaches the test's mustNotCall uncaughtException
  // listener.
  test.concurrent.todoIf(["test.js", "test_legacy_uncaught_exception.js"].includes(file))(file, async () => {
    await built;
    await runAsync(dirname(import.meta.dir), basename(import.meta.dir) + sep + file);
  });
}
