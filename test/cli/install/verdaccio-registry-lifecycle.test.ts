import { afterAll, expect, test } from "bun:test";
import { VerdaccioRegistry } from "harness";
import { once } from "node:events";

let registry: VerdaccioRegistry | undefined;

afterAll(() => {
  if (registry?.process && registry.process.exitCode === null && registry.process.signalCode === null) {
    registry.process.kill("SIGKILL");
  }
});

// stop() previously called kill(0), which only probes for liveness and left the
// forked verdaccio running after every test file that used it.
test("VerdaccioRegistry.stop() terminates the forked process", async () => {
  registry = new VerdaccioRegistry();
  await registry.start();

  const child = registry.process!;
  expect(child.pid).toBeGreaterThan(0);
  expect(() => process.kill(child.pid!, 0)).not.toThrow();

  const exited = once(child, "exit");
  registry.stop();

  const result = await Promise.race([
    exited.then(() => "exited" as const),
    Bun.sleep(3000).then(() => "still running" as const),
  ]);

  expect(result).toBe("exited");
  expect(child.killed).toBe(true);
});
