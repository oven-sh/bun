// https://github.com/oven-sh/bun/issues/23194
// Test that MessagePort doesn't crash when postMessage is called
// after the script execution context is destroyed
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("comlink worker communication doesn't segfault", async () => {
  using testDir = tempDir("comlink-test", {
    "worker.js": `
import * as Comlink from './comlink.js';

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
    }, 1000);
  },
});
`,
    "main.js": `
import * as Comlink from './comlink.js';

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
  });

  // Copy vendored comlink
  await Bun.write(join(String(testDir), "comlink.js"), Bun.file(join(import.meta.dir, "23194", "comlink.js")));

  // Run the test
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(testDir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS");
});
