import { Glob } from "bun";
import { describe, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isBroken, isLinux, nodeExe } from "harness";
import { basename, join } from "path";

describe.concurrent("AsyncLocalStorage passes context to callbacks", () => {
  let files = [...new Glob(join(import.meta.dir, "async-context", "async-context-*.js")).scanSync()];

  // async-context-unhandled-rejection-async-fn.js: the "finally-returns-rejected" case
  // fails on the current WEBKIT_VERSION because PromiseFinallyAwaitJob does not carry
  // the async context across. Fixed by oven-sh/WebKit#268 (commit 0aef04ea); un-skip
  // once WEBKIT_VERSION picks it up.
  let todos = ["async-context-worker_threads-message.js", "async-context-unhandled-rejection-async-fn.js"];
  if (isASAN && isBroken && isLinux) {
    todos.push("async-context-dns-resolveTxt.js");
  }

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
