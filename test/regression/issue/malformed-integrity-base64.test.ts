import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("malformed integrity base64 in lockfile should be handled gracefully", async () => {
  // Decodes to 100 bytes, larger than any digest bun supports (sha512 is 64 bytes).
  // Parsing this used to write past the end of the fixed-size digest buffer.
  const oversizedBase64 = Buffer.alloc(100, 0xaa).toString("base64");

  await using dir = tempDir("malformed-integrity-test", {
    "package.json": JSON.stringify({
      name: "test-malformed-integrity",
      version: "1.0.0",
      dependencies: {
        "lodash": "4.17.21",
      },
    }),
    "bun.lock": JSON.stringify(
      {
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
          "lodash": ["lodash@4.17.21", "", {}, `sha256-${oversizedBase64}`],
        },
      },
      null,
      2,
    ),
  });

  // The integrity string is parsed while the lockfile is loaded, so a --dry-run
  // reaches it without downloading anything. Nothing here needs a registry.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--dry-run"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

     lodash@4.17.21 done"
  `);
  const err = normalizeBunSnapshot(stderr, dir);
  expect(err).toContain("warn: Unsupported or malformed integrity hash; ignoring");
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
});
