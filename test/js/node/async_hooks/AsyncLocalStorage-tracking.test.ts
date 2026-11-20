import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isBroken, isLinux, isWindows, nodeExe, tempDir } from "harness";
import { basename, join } from "path";
import { unsupported as aotUnsupported } from "../../../aot/supported";

describe.concurrent("AsyncLocalStorage passes context to callbacks", () => {
  let files = [...new Glob(join(import.meta.dir, "async-context", "async-context-*.js")).scanSync()];

  let todos: string[] = [];
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

test.skipIf(!!aotUnsupported)("compiled Worker events preserve the construction async context", async () => {
  using dir = tempDir("compiled-worker-async-context", {});
  const executable = join(String(dir), isWindows ? "app.exe" : "app");
  const fixture = join(import.meta.dir, "async-context", "async-context-worker_threads-message.js");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", fixture, "--outfile", executable],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildOut, buildError, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect({ buildOut: buildExit ? buildOut : "", buildError: buildExit ? buildError : "", buildExit }).toEqual({
    buildOut: "",
    buildError: "",
    buildExit: 0,
  });
  await using proc = Bun.spawn({ cmd: [executable], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
});
