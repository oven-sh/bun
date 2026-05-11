import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

describe("process.stdout.end() flushes pending writes before callback", () => {
  test("large write followed by end() with process.exit in callback", async () => {
    using dir = tempDir("issue-25432", {
      "test.js": `
        const output = Buffer.alloc(200000, 120).toString() + "\\n";
        process.stdout.write(output);
        process.stdout.end(() => { process.exit(0); });
      `,
    });

    // Use a shell pipe to detect truncation — Bun.spawn's own pipe reader
    // doesn't reproduce the issue because it drains fully after child exit.
    const result = Bun.spawnSync({
      cmd: ["sh", "-c", `"${bunExe()}" "${path.join(String(dir), "test.js")}" 2>/dev/null | wc -c`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const byteCount = parseInt(result.stdout.toString().trim(), 10);
    expect(byteCount).toBe(200001);
    expect(result.exitCode).toBe(0);
  });

  test("overridden write with .bind() pattern from issue", async () => {
    using dir = tempDir("issue-25432-bind", {
      "test.js": `
        const originalStdoutWrite = process.stdout.write.bind(process.stdout);
        process.stdout.write = function(chunk, ...args) {
          return process.stderr.write(chunk, ...args);
        };
        const output = JSON.stringify({
          items: Array.from({ length: 1000 }, (_, i) => ({
            id: i,
            name: "Item " + i,
            description: "Description for item " + i + " with extra padding text to increase total size.",
            metadata: { index: i, category: "Cat " + (i % 10) }
          }))
        }, null, 2);
        originalStdoutWrite(output);
        originalStdoutWrite("\\n");
        process.stdout.end(() => { process.exit(0); });
      `,
    });

    const result = Bun.spawnSync({
      cmd: ["sh", "-c", `"${bunExe()}" "${path.join(String(dir), "test.js")}" 2>/dev/null | wc -c`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const byteCount = parseInt(result.stdout.toString().trim(), 10);
    // The JSON output should be ~216KB, not truncated at 64KB/128KB
    expect(byteCount).toBeGreaterThan(200000);
    expect(result.exitCode).toBe(0);
  });
});
