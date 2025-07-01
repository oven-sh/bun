import { expect, test, describe } from "bun:test";
import { Glob } from "bun";
import { basename, join } from "path";
import { bunEnv, bunExe, nodeExe } from "harness";

describe("AsyncLocalStorage passes context to callbacks", () => {
  let files = [...new Glob(join(import.meta.dir, "async-context", "async-context-*.js")).scanSync()];

  const todos = ["async-context-worker_threads-message.js"];

  files = files.filter(file => !todos.includes(basename(file)));

  for (const filepath of files) {
    const file = basename(filepath).replaceAll("async-context-", "").replaceAll(".js", "");
    test(file, async () => {
      async function run(exe) {
        const { exited } = Bun.spawn({
          cmd: [exe, filepath],
          stdout: "inherit",
          stderr: "inherit",
          env: bunEnv,
        });

        if (await exited) {
          throw new Error(`${basename(exe)} failed in ${filepath}`);
        }
      }

      await Promise.all([run(bunExe()), run(nodeExe())]);
    });
  }

  for (const filepath of todos) {
    const file = basename(filepath).replaceAll("async-context-", "").replaceAll(".js", "");
    test.todo(file);
  }
});
