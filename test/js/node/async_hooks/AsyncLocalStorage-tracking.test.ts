import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isBroken, isLinux, nodeExe } from "harness";
import { basename, join } from "path";

describe.concurrent("AsyncLocalStorage passes context to callbacks", () => {
  let files = [...new Glob(join(import.meta.dir, "async-context", "async-context-*.js")).scanSync()];

  let todos = ["async-context-worker_threads-message.js"];
  if (isASAN && isBroken && isLinux) {
    todos.push("async-context-dns-resolveTxt.js");
  }
  // Fixtures node passes and bun fails. Each asserts that split, so it goes red (and moves
  // to the plain list) when bun catches up.
  const bunFails: Record<string, string> = {
    // Both settle a promise from a JSC internal microtask that does not carry the async
    // context yet; bun passes once WEBKIT_VERSION includes oven-sh/WebKit#268.
    "async-context-unhandled-rejection-finally-thenable.js": "oven-sh/WebKit#268",
    "async-context-unhandled-rejection-then-passthrough.js": "oven-sh/WebKit#268",
    // A promise that Bun's native layer rejects from an event-loop task (fetch, fs.promises)
    // is rejected with no context installed, so the handler reads none. Node installs the
    // resource's creation context around native settlement.
    "async-context-unhandled-rejection-native.js": "native settlement installs no async context",
  };

  files = files.filter(file => !todos.includes(basename(file)) && !(basename(file) in bunFails));

  async function run(exe: string, filepath: string, stdio: "inherit" | "ignore" = "inherit") {
    const { exited } = Bun.spawn({
      cmd: [exe, filepath],
      stdout: stdio,
      stderr: stdio,
      env: bunEnv,
    });

    if (await exited) {
      throw new Error(`${basename(exe)} failed in ${filepath}`);
    }
  }

  for (const filepath of files) {
    const file = basename(filepath).replaceAll("async-context-", "").replaceAll(".js", "");
    test(file, async () => {
      await Promise.all([run(bunExe(), filepath), run(nodeExe()!, filepath)]);
    });
  }

  for (const [file, reason] of Object.entries(bunFails)) {
    const filepath = join(import.meta.dir, "async-context", file);
    const name = file.replaceAll("async-context-", "").replaceAll(".js", "");
    test(`${name} (node passes, bun fails: ${reason})`, async () => {
      await run(nodeExe()!, filepath);
      await expect(run(bunExe(), filepath, "ignore")).rejects.toThrow(`${basename(bunExe())} failed in ${filepath}`);
    });
  }

  for (const filepath of todos) {
    const file = basename(filepath).replaceAll("async-context-", "").replaceAll(".js", "");
    test.todo(file);
  }
});
