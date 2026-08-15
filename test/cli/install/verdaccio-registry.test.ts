import { afterEach, expect, test } from "bun:test";
import { tempDir, VerdaccioRegistry } from "harness";
import { once } from "node:events";
import { join } from "node:path";

const registries: VerdaccioRegistry[] = [];

afterEach(async () => {
  await Promise.all(
    registries.splice(0).map(async ({ process: child }) => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }),
  );
});

test("start() resolves with the port verdaccio bound and registryUrl() serves from it", async () => {
  const registry = new VerdaccioRegistry();
  registries.push(registry);

  // The port used to be picked here, before anything was listening on it.
  expect(() => registry.port).toThrow("not known until start()");

  await registry.start();

  const { port } = registry;
  expect(port).toBeGreaterThan(0);
  expect(registry.registryUrl()).toBe(`http://localhost:${port}/`);

  const response = await fetch(new URL("no-deps", registry.registryUrl()));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ name: "no-deps" });
});

test("start() rejects when verdaccio exits before it is listening", async () => {
  using dir = tempDir("verdaccio-registry-missing-config", {});
  const registry = new VerdaccioRegistry({ configPath: join(String(dir), "missing.yaml") });
  registries.push(registry);

  // Before the fix this promise never settled: the exit handler only logged, so a
  // beforeAll() starting the registry sat there until the hook timed out.
  const error = await registry.start().catch((error: Error) => error);
  expect(error).toBeInstanceOf(Error);
  expect(error!.message).toContain("Verdaccio exited with code 1 and signal null before it started listening");
  expect(error!.message).toContain("cannot open config file");
  expect(() => registry.port).toThrow("not known until start()");
});
