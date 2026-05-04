import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When node:util fails to load (e.g. a builtin it depends on was deleted), inspecting an
// object with a custom inspect method previously tripped a RELEASE_ASSERT in
// JSC::LazyProperty because the initLater lambda returned without calling init.set().
test.concurrent("Bun.inspect custom inspect does not crash when node:util cannot load", async () => {
  const src = `
    void process.stdout;
    delete Function.prototype.bind;
    const obj = { [Symbol.for("nodejs.util.inspect.custom")]() { return "ok"; } };
    try { Bun.inspect(obj); } catch {}
    try { Bun.inspect(obj); } catch {}
    try { Bun.inspect(obj, { colors: true }); } catch {}
    process.stdout.write("done");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(proc.signalCode).toBeNull();
  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(stdout).toBe("done");
  expect(exitCode).toBe(0);
});

test.concurrent("BroadcastChannel custom inspect does not crash when node:util cannot load", async () => {
  const src = `
    void process.stdout;
    delete Function.prototype.bind;
    const bc = new BroadcastChannel("x");
    bc.unref();
    const fn = bc[Symbol.for("nodejs.util.inspect.custom")];
    try { fn.call(bc, 2, {}); } catch {}
    try { fn.call(bc, 2, {}); } catch {}
    process.stdout.write("done");
    process.exit(0);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(proc.signalCode).toBeNull();
  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(stdout).toBe("done");
  expect(exitCode).toBe(0);
});
