import { Glob } from "bun";
import { describe, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isBroken, isLinux, nodeExe } from "harness";
import { basename, join } from "path";

describe.concurrent("AsyncLocalStorage passes context to callbacks", () => {
  let files = [...new Glob(join(import.meta.dir, "async-context", "async-context-*.js")).scanSync()];

  let todos: string[] = [];
  if (isASAN && isBroken && isLinux) {
    todos.push("async-context-dns-resolveTxt.js");
  }

  files = files.filter(file => !todos.includes(basename(file)));

  for (const filepath of files) {
    const file = basename(filepath).replaceAll("async-context-", "").replaceAll(".js", "");
    // Spawning a worker creates a fresh JSC VM and module graph; on an ASAN
    // debug build the full round-trip-and-terminate brushes past the 5s
    // default when this whole suite is running concurrently.
    const timeout = file.startsWith("worker_threads") ? 30_000 : undefined;
    test(
      file,
      async () => {
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
      },
      timeout,
    );
  }

  for (const filepath of todos) {
    const file = basename(filepath).replaceAll("async-context-", "").replaceAll(".js", "");
    test.todo(file);
  }
});
