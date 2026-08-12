import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// `app.plugins` / `framework.plugins` are held by one native BundlerPlugin cell
// that the dev server takes over from the parsed serve options. The dev server
// used to drop its handle to that cell without releasing it, so every dev
// server created with plugins kept its cell, and every closure the plugins had
// registered, rooted for the rest of the process; options rejected after the
// cell had been created leaked it the same way. The fixture runs one of these
// paths per process and reports how many cells survive a full GC afterwards.
//
// The cases run one at a time: each dev server needs a file watcher instance,
// which Linux hands out per user, and a process only gives it back on exit.
// The fixture waits for one when the machine is out of them (hence the
// timeouts), and the debug build's startup plus full collections are slow.
async function runCase(name: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "app-plugins-release.ts", name],
    cwd: path.join(import.meta.dir, "fixtures/app-plugins-release"),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // stderr is not asserted: "init-fails" makes Bun print the framework file it
  // could not resolve there.
  expect(stdout, stderr).toStartWith("{");
  return { ...JSON.parse(stdout), exitCode };
}

test("a stopped dev server releases the cell holding its app plugins", async () => {
  expect(await runCase("stopped-server")).toEqual({
    cellsWhileServing: 1,
    devServersDeinitialized: 1,
    leakedCells: 0,
    exitCode: 0,
  });
}, 60_000);

test("serve options rejected by a plugin's setup() release the cell", async () => {
  expect(await runCase("setup-throws")).toEqual({
    error: "setup failed on purpose",
    devServersDeinitialized: 0,
    leakedCells: 0,
    exitCode: 0,
  });
}, 60_000);

test("a dev server that fails to initialize releases the cell", async () => {
  expect(await runCase("init-fails")).toEqual({
    error: "Framework is missing required files!",
    devServersDeinitialized: 1,
    leakedCells: 0,
    exitCode: 0,
  });
}, 60_000);
