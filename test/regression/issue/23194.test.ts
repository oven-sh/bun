import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isMusl, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/23194
// MessagePort.postMessage segfaults when ScriptExecutionContext is destroyed
// during high-frequency message passing between main thread and worker via Comlink.
// The structured cloning + MessagePort transfer in Comlink's RPC protocol
// can trigger a dangling ScriptExecutionContext::m_globalObject dereference.
test.skipIf(isASAN || isMusl)("MessagePort does not segfault during rapid Comlink-style message passing", async () => {
  using dir = tempDir("issue-23194", {
    "package.json": JSON.stringify({
      dependencies: { comlink: "^4.4.2" },
      type: "module",
    }),
    "main.js": `
import * as Comlink from 'comlink/dist/esm/comlink.js';

let mainloop = true;
const worker = new Worker(new URL("./worker.js", import.meta.url).href);
const api = Comlink.wrap(worker);
const main = {
  async callback(index, ts, final) {
    if (final) mainloop = false;
  },
};

(async () => {
  await api.start(Date.now(), Comlink.proxy(main));
  while (mainloop) {
    await Bun.sleep(0);
    Bun.sleepSync(16);
  }
  worker.terminate();
  console.log("done");
})();
`,
    "worker.js": `
import * as Comlink from 'comlink/dist/esm/comlink.js';

const TARGET_CALLBACKS = 100;

Comlink.expose({
  async start(start, main) {
    let i = 0;
    const interval = setInterval(() => {
      if (i >= TARGET_CALLBACKS) {
        clearInterval(interval);
        main.callback(i, Date.now() - start, true);
        return;
      }
      main.callback(i++, Date.now() - start);
    }, 1);
  },
});
`,
  });

  // Install comlink
  await using install = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const installExitCode = await install.exited;
  expect(installExitCode).toBe(0);

  // This exercises a race condition — run a few attempts since the
  // exact timing varies across platforms and CI machines.
  let lastStdout = "",
    lastStderr = "",
    lastExitCode = -1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "run", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Bound each attempt to 15s to prevent hangs from blocking the retry loop
    const result = await Promise.race([
      Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]).then(([stdout, stderr, exitCode]) => ({
        stdout,
        stderr,
        exitCode,
      })),
      Bun.sleep(15_000).then(() => {
        proc.kill();
        return { stdout: "", stderr: "timeout", exitCode: -1 };
      }),
    ]);

    lastStdout = result.stdout;
    lastStderr = result.stderr;
    lastExitCode = result.exitCode;

    if (result.stdout.includes("done") && result.exitCode === 0) {
      return; // success — the fix prevented the crash
    }
  }
  expect().fail(
    `Process crashed or failed to complete after 5 attempts. Last attempt: exitCode=${lastExitCode}, stdout=${JSON.stringify(lastStdout)}, stderr=${JSON.stringify(lastStderr.slice(0, 500))}`,
  );
});
