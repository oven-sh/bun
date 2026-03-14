import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Issue #23607: bun install hangs indefinitely with security scanner enabled
// when node_modules exceeds ~790 packages. Root cause: package JSON was embedded
// inline in the -e argument, exceeding OS MAX_ARG_STRLEN (128KB on Linux).
// Fix: write packages JSON to a temp file and have scanner-entry read from it.

describe("issue #23607", () => {
  test("security scanner receives packages via temp file mechanism", async () => {
    // The scanner module checks that packages were loaded from a temp file
    // (via fs.readFileSync) rather than being embedded inline as JSON in the
    // -e argument. On the old binary, __PACKAGES_JSON__ is replaced with raw
    // JSON inline, so the readFileSync call would fail or not exist.
    using dir = tempDir("issue-23607", {
      "package.json": JSON.stringify({
        name: "test-23607",
        version: "1.0.0",
        dependencies: {
          "is-number": "7.0.0",
        },
      }),
      "bunfig.toml": `[install.security]\nscanner = "./scanner.ts"`,
      "scanner.ts": `
        import fs from "node:fs";

        export const scanner = {
          version: "1",
          scan: async ({ packages }) => {
            if (!Array.isArray(packages)) {
              throw new Error("packages is not an array: " + typeof packages);
            }

            // Look for evidence of the temp file mechanism: there should be
            // a bun_scan_* file in the temp directory that was used to pass
            // the packages JSON. On the old binary this file won't exist
            // because packages were passed inline via __PACKAGES_JSON__.
            const tmpDir = process.env.BUN_TMPDIR || require("os").tmpdir();
            const tmpFiles = fs.readdirSync(tmpDir);
            const scanFile = tmpFiles.find(f => f.startsWith("bun_scan_"));
            if (!scanFile) {
              throw new Error("TEMP_FILE_NOT_FOUND: no bun_scan_* file in " + tmpDir);
            }

            // Verify the temp file contains valid JSON matching our packages
            const contents = fs.readFileSync(tmpDir + "/" + scanFile, "utf8");
            const parsed = JSON.parse(contents);
            if (!Array.isArray(parsed)) {
              throw new Error("TEMP_FILE_INVALID: expected array, got " + typeof parsed);
            }

            console.error("SCANNER_TEMP_FILE_VERIFIED:" + scanFile);
            return [];
          },
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: path.join(String(dir), ".cache") },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The scanner should have found and verified the temp file
    expect(stderr).toContain("SCANNER_TEMP_FILE_VERIFIED:");
    expect(exitCode).toBe(0);
  });
});
