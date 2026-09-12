import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// process.abort/chdir/umask(mask)/set*id act on the whole process and
// process.title is per thread, as in Node. The same rules must apply to a
// worker made with the global Worker and one made with worker_threads.Worker.
// Spawned: a worker that does get through would change this process's cwd.

const posixOnly = ["setuid", "seteuid", "setgid", "setegid", "setgroups", "initgroups"];
const stubbed = ["abort", "chdir", ...(isWindows ? [] : posixOnly)];

const fixture = /* js */ `
  const fs = require("node:fs");
  const path = require("node:path");
  const kind = process.argv[2];
  if (Bun.isMainThread) {
    process.title = "main-title";
    const umaskBefore = process.umask();
    const cwdBefore = process.cwd();
    const onResult = worker => {
      // A relative write follows the kernel cwd. process.cwd() would keep
      // returning the cached cwdBefore even after a worker moved the process.
      fs.writeFileSync("probe.txt", "x");
      const main = {
        relativeWriteLandedInCwd: fs.existsSync(path.join(cwdBefore, "probe.txt")),
        umaskChanged: process.umask() !== umaskBefore,
        title: process.title,
      };
      console.log(JSON.stringify({ worker, main }));
    };
    if (kind === "web") {
      const w = new Worker(import.meta.url, { argv: [kind] });
      w.onmessage = e => { onResult(e.data); w.terminate(); };
      w.onerror = e => { console.error(e.message); process.exit(1); };
    } else {
      const { Worker } = require("node:worker_threads");
      const w = new Worker(new URL(import.meta.url), { argv: [kind] });
      w.on("message", r => { onResult(r); w.terminate(); });
      w.on("error", e => { console.error(e); process.exit(1); });
    }
  } else {
    const probe = fn => {
      try {
        return { returned: fn() };
      } catch (e) {
        return { name: e.name, code: e.code, message: e.message };
      }
    };
    const stub = name => {
      if (process[name].disabled !== true) return { disabled: process[name].disabled };
      return { disabled: true, ...probe(() => process[name]()) };
    };
    const result = {
      stubs: Object.fromEntries(${JSON.stringify(stubbed)}.map(name => [name, stub(name)])),
      chdirWithArgument: probe(() => process.chdir("elsewhere")),
      umaskSet: probe(() => process.umask(0o077)),
      umaskGet: typeof process.umask(),
      titleBefore: process.title,
    };
    process.title = "worker-title";
    result.titleAfter = process.title;
    if (kind === "web") postMessage(result);
    else require("node:worker_threads").parentPort.postMessage(result);
  }
`;

const unsupported = (name: string) => ({
  disabled: true,
  name: "TypeError",
  code: "ERR_WORKER_UNSUPPORTED_OPERATION",
  message: `process.${name}() is not supported in workers`,
});

describe.each(["web", "node"])("%s Worker cannot change process-wide state", kind => {
  test.concurrent("process mutators throw and the main thread is untouched", async () => {
    using dir = tempDir("worker-process-state", { "main.mjs": fixture, "elsewhere/.keep": "" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs", kind],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      worker: {
        stubs: Object.fromEntries(stubbed.map(name => [name, unsupported(name)])),
        chdirWithArgument: {
          name: "TypeError",
          code: "ERR_WORKER_UNSUPPORTED_OPERATION",
          message: "process.chdir() is not supported in workers",
        },
        umaskSet: {
          name: "TypeError",
          code: "ERR_WORKER_UNSUPPORTED_OPERATION",
          message: "Setting process.umask() is not supported in workers",
        },
        umaskGet: "number",
        titleBefore: "main-title",
        titleAfter: "worker-title",
      },
      main: {
        relativeWriteLandedInCwd: true,
        umaskChanged: false,
        title: "main-title",
      },
    });
    expect(exitCode).toBe(0);
  });
});
