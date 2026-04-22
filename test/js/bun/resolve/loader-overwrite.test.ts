import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// globalThis.Loader is user-writable. The lazy esmRegistryMap initializer reads
// Loader.registry off the global and must not assume it is an object (or that
// registry is a JSMap) since user code may have replaced or deleted it.

async function run(name: string, entry: string) {
  using dir = tempDir(name, {
    "target.mjs": "export const x = 1;\n",
    "entry.js": entry,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.concurrent("globalThis.Loader replaced with a primitive", async () => {
  const { stdout, signalCode, exitCode } = await run(
    "loader-overwrite-primitive",
    `
      globalThis.Loader = 1;
      import("./target.mjs").then(() => console.log("ok")).catch(e => console.log("err", e.message));
    `,
  );
  expect(signalCode).toBeNull();
  expect(exitCode).toBe(0);
  expect(stdout).toBe("ok\n");
});

test.concurrent("globalThis.Loader set to undefined", async () => {
  const { stdout, signalCode, exitCode } = await run(
    "loader-overwrite-undefined",
    `
      globalThis.Loader = undefined;
      import("./target.mjs").then(() => console.log("ok")).catch(e => console.log("err", e.message));
    `,
  );
  expect(signalCode).toBeNull();
  expect(exitCode).toBe(0);
  expect(stdout).toBe("ok\n");
});

test.concurrent("globalThis.Loader.registry replaced with a non-Map", async () => {
  const { stdout, signalCode, exitCode } = await run(
    "loader-overwrite-registry",
    `
      globalThis.Loader = { registry: 1 };
      import("./target.mjs").then(() => console.log("ok")).catch(e => console.log("err", e.message));
    `,
  );
  expect(signalCode).toBeNull();
  expect(exitCode).toBe(0);
  expect(stdout).toBe("ok\n");
});

test.concurrent("globalThis.Loader with a throwing registry getter", async () => {
  const { stderr, signalCode } = await run(
    "loader-overwrite-throwing",
    `
      globalThis.Loader = new Proxy({}, { get() { throw new Error("boom"); }, has() { return true; } });
      import("./target.mjs").then(() => console.log("ok")).catch(e => console.log("err", e.message));
    `,
  );
  expect(signalCode).toBeNull();
  expect(stderr).not.toContain("panic");
  expect(stderr).toContain("boom");
});
