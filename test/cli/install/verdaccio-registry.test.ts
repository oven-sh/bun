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

async function startFailure(configPath: string): Promise<Error> {
  const registry = new VerdaccioRegistry({ configPath });
  registries.push(registry);
  // Before the fix this promise never settled: the exit handler only logged, so a
  // beforeAll() starting the registry sat there until the hook timed out.
  const error = await registry.start().catch((error: Error) => error);
  expect(error).toBeInstanceOf(Error);
  expect(() => registry.port).toThrow("not known until start()");
  return error as Error;
}

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

test("start() rejects when the config file is missing", async () => {
  using dir = tempDir("verdaccio-registry-missing-config", {});
  const error = await startFailure(join(String(dir), "missing.yaml"));
  expect(error.message).toContain("Verdaccio exited with code 1 and signal null before it started listening");
  expect(error.message).toContain("config file does not exist or not reachable");
});

test("start() rejects with what verdaccio logged when a plugin fails to load", async () => {
  using dir = tempDir("verdaccio-registry-bad-plugin", {
    "verdaccio.yaml": `
      storage: ./storage
      auth:
        nope: {}
      packages:
        "**":
          access: $all
      log: { type: stdout, format: pretty, level: http }
    `,
  });
  const error = await startFailure(join(String(dir), "verdaccio.yaml"));
  expect(error.message).toContain("Verdaccio exited with code 1 and signal null before it started listening");
  // verdaccio's logger (stdout) and the error that ended the fixture (stderr) word it differently.
  expect(error.message).toContain("plugin not found. try npm install verdaccio-nope");
  expect(error.message).toContain('plugin not found. try "npm install verdaccio-nope"');
});
