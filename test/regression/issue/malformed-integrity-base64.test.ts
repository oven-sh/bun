import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv, normalizeBunSnapshot } from "harness";

test("malformed integrity base64 should be handled gracefully", async () => {
  const dir = tempDirWithFiles("malformed-integrity-test", {
    "package.json": JSON.stringify({
      name: "test-malformed-integrity",
      version: "1.0.0",
      dependencies: {
        "test-pkg": "1.0.0"
      }
    }),
  });

  // Create a lockfile with oversized base64 integrity that would cause panic
  // before the fix (base64 that decodes to more than 64 bytes)
  const oversizedBytes = new Uint8Array(100);
  oversizedBytes.fill(0xAA);
  const oversizedBase64 = Buffer.from(oversizedBytes).toString('base64');
  
  const lockfile = {
    lockfileVersion: 1,
    workspaces: {
      "": {
        name: "test-malformed-integrity",
        dependencies: {
          "test-pkg": "1.0.0"
        }
      }
    },
    packages: {
      "test-pkg": ["test-pkg@1.0.0", "", {}, `sha256-${oversizedBase64}`]
    }
  };

  await Bun.write(`${dir}/bun.lock`, JSON.stringify(lockfile, null, 2));

  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
  });

  expect(normalizeBunSnapshot(stdout.toString(), dir)).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
  expect(normalizeBunSnapshot(stderr.toString(), dir)).toMatchInlineSnapshot(`"error: GET https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz - 404"`);
  expect(exitCode).toMatchInlineSnapshot(`1`);
});