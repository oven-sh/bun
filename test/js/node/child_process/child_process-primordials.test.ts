import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The argv handed to a child must not depend on user-patched Array built-ins
// (a polyfill with an off-by-one, an instrumentation wrapper). Each API runs
// once before the patch so every module it needs is loaded, like a polyfill
// installed after startup. The grandchild prints the argv it received.
test("spawnSync, spawn, and fork pass argv through with patched Array.prototype.slice and iterator", async () => {
  using dir = tempDir("child-process-primordials", {
    "fixture.js": `
      const { spawnSync, spawn, fork } = require("child_process");
      // "bun -e" leaves process.argv as [execPath, ...args].
      const printArgv = "console.log(JSON.stringify(process.argv.slice(1)))";
      const forkOptions = { stdio: ["pipe", "pipe", "pipe", "ipc"] };
      const closed = child => new Promise(resolve => child.on("close", resolve));
      const collect = (child, chunks) => child.stdout.on("data", d => chunks.push(d));

      (async () => {
        spawnSync(process.execPath, ["--version"]);
        await Promise.all([closed(spawn(process.execPath, ["--version"])), closed(fork("forked.js", [], forkOptions))]);

        const origSlice = Array.prototype.slice;
        const origIterator = Array.prototype[Symbol.iterator];
        // slice() duplicates the last element, the iterator skips the first one.
        Array.prototype.slice = function (...args) {
          const result = origSlice.apply(this, args);
          if (result.length) result.push(result[result.length - 1]);
          return result;
        };
        Array.prototype[Symbol.iterator] = function () {
          const it = origIterator.call(this);
          it.next();
          return it;
        };

        const sync = spawnSync(process.execPath, ["-e", printArgv, "intended", "last"]);
        const child = spawn(process.execPath, ["-e", printArgv, "intended", "last"]);
        const forked = fork("forked.js", ["intended", "last"], forkOptions);

        Array.prototype.slice = origSlice;
        Array.prototype[Symbol.iterator] = origIterator;

        const childOut = [];
        const forkOut = [];
        collect(child, childOut);
        collect(forked, forkOut);
        // Both "close" listeners go on before the first await: a child that
        // closes while the other one is awaited must not be missed.
        await Promise.all([closed(child), closed(forked)]);
        console.log(
          JSON.stringify({
            sync: String(sync.stdout).trim(),
            async: childOut.join("").trim(),
            fork: forkOut.join("").trim(),
          }),
        );
      })();
    `,
    // fork() puts the script before the arguments: [execPath, script, ...args].
    "forked.js": "console.log(JSON.stringify(process.argv.slice(2)))",
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout:
      JSON.stringify({
        sync: '["intended","last"]',
        async: '["intended","last"]',
        fork: '["intended","last"]',
      }) + "\n",
    stderr: "",
    exitCode: 0,
  });
});
