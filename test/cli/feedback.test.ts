import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("bun feedback", () => {
  test("sends all required fields with correct platform and arch", async () => {
    let capturedFormData: FormData | null = null;

    // Create a mock server to capture the feedback request
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "POST") {
          capturedFormData = await req.formData();
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const port = server.port;
    const url = `http://localhost:${port}/v1/feedback`;

    try {
      const tempDir = mkdtempSync(join(tmpdir(), "bun-feedback-test-"));
      const emailFile = join(tempDir, "feedback");
      writeFileSync(emailFile, "test@example.com\n");

      const { exitCode, stdout, stderr } = spawnSync({
        cmd: [bunExe(), "feedback", "test feedback message"],
        env: {
          ...bunEnv,
          BUN_FEEDBACK_URL: url,
          BUN_INSTALL: tempDir,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(exitCode).toBe(0);
      expect(capturedFormData).not.toBeNull();

      if (!capturedFormData) throw new Error("FormData was not captured");

      // Required fields
      expect(capturedFormData.get("email")).toBe("test@example.com");
      expect(capturedFormData.get("message")).toBe("test feedback message");

      // Platform and arch - these should be runtime values not build-time
      const platform = capturedFormData.get("platform");
      const arch = capturedFormData.get("arch");
      expect(platform).toBe(process.platform);
      expect(arch).toBe(process.arch);

      // System info fields
      expect(capturedFormData.get("bunRevision")).toBeTruthy();
      expect(capturedFormData.get("bunVersion")).toBeTruthy();
      expect(capturedFormData.get("bunBuild")).toBeTruthy();
      expect(capturedFormData.get("hardwareConcurrency")).toBeTruthy();
      expect(capturedFormData.get("availableMemory")).toBeTruthy();
      expect(capturedFormData.get("totalMemory")).toBeTruthy();
      expect(capturedFormData.get("osVersion")).toBeTruthy();
      expect(capturedFormData.get("osRelease")).toBeTruthy();

      // UUID field
      const id = capturedFormData.get("id");
      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");

      // IP support fields
      const localIPSupport = capturedFormData.get("localIPSupport");
      const remoteIPSupport = capturedFormData.get("remoteIPSupport");
      expect(localIPSupport).toMatch(/^(ipv4|ipv6|ipv4_and_ipv6|none)$/);
      expect(remoteIPSupport).toMatch(/^(ipv4|ipv6|ipv4_and_ipv6|none)$/);

      // bunBuild should be in correct format
      const bunBuild = capturedFormData.get("bunBuild") as string;
      expect(bunBuild).toMatch(/^bun-(linux|darwin|windows)-(x64|aarch64|arm64)/);

      // Numeric fields should be valid numbers
      const hardwareConcurrency = Number(capturedFormData.get("hardwareConcurrency"));
      const availableMemory = Number(capturedFormData.get("availableMemory"));
      const totalMemory = Number(capturedFormData.get("totalMemory"));
      expect(hardwareConcurrency).toBeGreaterThan(0);
      expect(availableMemory).toBeGreaterThan(0);
      expect(totalMemory).toBeGreaterThan(0);
    } finally {
      server.stop();
    }
  });

  test("shows help message with --help", () => {
    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), "feedback", "--help"],
      env: bunEnv,
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("bun feedback");
    expect(output).toContain("Usage");
    expect(output).toContain("--email");
  });

});
