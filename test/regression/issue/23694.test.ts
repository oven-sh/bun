import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("issue #23694", () => {
  test("bun update --interactive does not crash with pnpm monorepo migration", async () => {
    // Use is-even@0.1.0 with specifier ^0.1.0, so there's an update to 1.0.0 available.
    // This ensures the user can select an update, triggering installWithManager
    // which previously caused a double pnpm migration and segfault.
    using dir = tempDir("issue-23694", {
      "package.json": JSON.stringify(
        {
          name: "test-monorepo",
          private: true,
          dependencies: {
            "is-even": "0.1.0",
          },
          pnpm: {
            overrides: {
              "is-number": "7.0.0",
            },
          },
        },
        null,
        2,
      ),
      "pnpm-workspace.yaml": `packages:\n  - "packages/*"\n`,
      "packages/app/package.json": JSON.stringify(
        {
          name: "app",
          version: "1.0.0",
          dependencies: {
            "is-number": "^7.0.0",
          },
        },
        null,
        2,
      ),
      "pnpm-lock.yaml": `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      is-even:
        specifier: '0.1.0'
        version: 0.1.0

  packages/app:
    dependencies:
      is-number:
        specifier: ^7.0.0
        version: 7.0.0

packages:

  is-buffer@1.1.6:
    resolution: {integrity: sha512-NcdALwpXkTm5Zvvbk7owOUSvVvBKDgKP5/ewfXEznmQFfs4ZRmanOeKBTjRVjka3QFoN6XJ+9F0BQSbXfMSFg==}

  is-even@0.1.0:
    resolution: {integrity: sha512-GJVFoFMfDnHYYHgudtFABEWuOJdRYlBwBhOHOB0ReZ5/9RYfGOedWzDodA9fGZYsiwqPTHSNp6XXbGeJ/OROQ==}
    engines: {node: '>=0.10.0'}

  is-number@7.0.0:
    resolution: {integrity: sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==}
    engines: {node: '>=0.12.0'}

  is-odd@0.1.0:
    resolution: {integrity: sha512-A4iAnRIxBxjMBc2EvCNwbUKp1slRE5MqETJRkLY0rKKJVsGWgLkzaRGfMPGTwCnRyKOSEp2grLYkPnErLCXNA==}
    engines: {node: '>=0.10.0'}

snapshots:

  is-buffer@1.1.6: {}

  is-even@0.1.0:
    dependencies:
      is-odd: 0.1.0

  is-number@7.0.0: {}

  is-odd@0.1.0:
    dependencies:
      is-number: 7.0.0
`,
    });

    // Run bun update --interactive with stdin piped to select and confirm
    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Select the first package and confirm
    proc.stdin.write(" "); // space to select
    proc.stdin.write("\r"); // enter to confirm
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("STDOUT:", stdout);
      console.log("STDERR:", stderr);
    }

    expect(exitCode).toBe(0);

    // Verify the package.json is valid and not corrupted
    const updatedPkgJson = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));

    // Should not have empty-string keys (corruption from double migration)
    expect(updatedPkgJson).not.toHaveProperty("");

    // Should have workspaces (added by pnpm migration)
    expect(updatedPkgJson.workspaces).toBeDefined();

    // pnpm.overrides should have been moved to overrides by migration
    expect(updatedPkgJson.pnpm).toBeUndefined();
    expect(updatedPkgJson.overrides).toBeDefined();

    // is-even should have been updated from the pinned 0.1.0
    expect(updatedPkgJson.dependencies["is-even"]).not.toBe("0.1.0");
  });
});
