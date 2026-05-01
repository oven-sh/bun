import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";

test("malformed integrity base64 in lockfile should be handled gracefully", async () => {
  const dir = tempDirWithFiles("malformed-integrity-test", {
    "package.json": JSON.stringify({
      name: "test-malformed-integrity",
      version: "1.0.0",
      dependencies: {
        "lodash": "4.17.21", // Use a real package that exists
      },
    }),
  });

  // First create a normal lockfile by running install
  const { exitCode: installExitCode } = Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
  });

  if (installExitCode !== 0) {
    throw new Error("Initial install failed");
  }

  // Now modify the lockfile to have malformed integrity data
  // The original panic occurs when parsing this during lockfile loading
  const oversizedBytes = new Uint8Array(100); // Way larger than any hash digest (max 64 bytes)
  oversizedBytes.fill(0xaa);
  const oversizedBase64 = Buffer.from(oversizedBytes).toString("base64");

  const lockfile = {
    lockfileVersion: 1,
    workspaces: {
      "": {
        name: "test-malformed-integrity",
        dependencies: {
          "lodash": "4.17.21",
        },
      },
    },
    packages: {
      "lodash": ["lodash@4.17.21", "", {}, `sha256-${oversizedBase64}`], // This causes the panic
    },
  };

  await Bun.write(`${dir}/bun.lock`, JSON.stringify(lockfile, null, 2));

  // Now run any command that would parse the lockfile - this should not panic
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "install", "--dry-run"],
    cwd: dir,
    env: bunEnv,
  });

  expect(normalizeBunSnapshot(stdout.toString(), dir)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

     lodash@4.17.21 done"
  `);
  expect(normalizeBunSnapshot(stderr.toString(), dir)).toMatchInlineSnapshot(`""`);
  expect(exitCode).toMatchInlineSnapshot(`0`);
});
