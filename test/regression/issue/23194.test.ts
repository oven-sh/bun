import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/23194
// MessagePort.postMessage segfaults when ScriptExecutionContext is destroyed
// during high-frequency message passing between main thread and worker via Comlink.
test("MessagePort does not segfault during rapid Comlink-style message passing", async () => {
  using dir = tempDir("issue-23194", {
    "package.json": JSON.stringify({
      dependencies: { comlink: "^4.4.2" },
      type: "module",
    }),
    "main.js": `
import * as Comlink from 'comlink/dist/esm/comlink.js';

let mainloop = true;
const
  worker = new Worker("./worker.js", {type: "module"}),
  api = Comlink.wrap(worker),
  main = {
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

Comlink.expose({
  async start(start, main) {
    let i = 0;
    const interval = setInterval(
      () => main.callback(i++, Date.now() - start),
      1,
    );
    setTimeout(() => {
      clearInterval(interval);
      main.callback(i, Date.now(), true);
    }, 10000);
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
  await install.exited;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not crash with a segfault
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("has crashed");
  expect(stdout).toContain("done");
  expect(exitCode).toBe(0);
}, 60000);
