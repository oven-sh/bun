// https://github.com/oven-sh/bun/issues/23194
// Test that MessagePort doesn't crash when postMessage is called
// after the script execution context is destroyed
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

test("comlink worker communication doesn't segfault", async () => {
  const testDir = join(tmpdir(), "comlink-test-" + Date.now());
  mkdirSync(testDir, { recursive: true });

  // Write worker file
  writeFileSync(
    join(testDir, "worker.js"),
    `
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
    }, 3000);
  },
});
`,
  );

  // Write main file
  writeFileSync(
    join(testDir, "main.js"),
    `
import * as Comlink from 'comlink/dist/esm/comlink.js';

let mainloop = true;
const
  worker = new Worker("./worker.js", {type: "module"}),
  api = Comlink.wrap(worker),
  main = {
    async callback(index, ts, final) {
      if(final) mainloop = false;
    },
  };

(async () => {
  await api.start(Date.now(), Comlink.proxy(main));
  while (mainloop) {
    await Bun.sleep(0);
    Bun.sleepSync(16);
  }
  worker.terminate();
  console.log("SUCCESS");
})();
`,
  );

  // Write package.json
  writeFileSync(
    join(testDir, "package.json"),
    JSON.stringify({
      dependencies: {
        comlink: "^4.4.2",
      },
      type: "module",
    }),
  );

  // Install dependencies
  const installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: testDir,
    env: bunEnv,
    stdout: "ignore",
    stderr: "ignore",
  });
  await installProc.exited;
  expect(installProc.exitCode).toBe(0);

  // Run the test
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: testDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not crash with segfault
  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS");
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic");
}, 30000);
