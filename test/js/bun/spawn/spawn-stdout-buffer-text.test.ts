import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "node:path";

describe("Bun.spawn() stdout: 'buffer' and 'text'", () => {
  describe("stdout: 'buffer'", () => {
    test("returns a promise that resolves to a Buffer", async () => {
      const dir = tempDirWithFiles("spawn-buffer-test", {
        "echo.js": `console.log("Hello, world!");`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "echo.js")],
        env: bunEnv,
        stdout: "buffer",
        stderr: "pipe",
      });

      // Should return a promise
      expect(proc.stdout).toBeInstanceOf(Promise);

      const buffer = await proc.stdout;
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString()).toBe("Hello, world!\n");

      // Accessing again should return the same promise
      const buffer2 = await proc.stdout;
      expect(buffer2).toBe(buffer);

      // stderr should still be a stream
      const stderr = await new Response(proc.stderr).text();
      expect(stderr).toBe("");
    });

    test("handles binary data correctly", async () => {
      const dir = tempDirWithFiles("spawn-buffer-binary", {
        "binary.js": `
          const buf = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x02, 0x03]);
          process.stdout.write(buf);
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "binary.js")],
        env: bunEnv,
        stdout: "buffer",
      });

      const buffer = await proc.stdout;
      expect(buffer).toBeInstanceOf(Buffer);
      expect(Array.from(buffer)).toEqual([0xFF, 0xFE, 0x00, 0x01, 0x02, 0x03]);
    });

    test("handles large output", async () => {
      const dir = tempDirWithFiles("spawn-buffer-large", {
        "large.js": `
          const chunk = Buffer.alloc(1024 * 1024, 'A').toString();
          for (let i = 0; i < 10; i++) {
            process.stdout.write(chunk);
          }
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "large.js")],
        env: bunEnv,
        stdout: "buffer",
      });

      const buffer = await proc.stdout;
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(10 * 1024 * 1024);
      expect(buffer.every(byte => byte === 65)).toBe(true); // All 'A's
    });

    test("works with stderr: 'buffer' too", async () => {
      const dir = tempDirWithFiles("spawn-buffer-stderr", {
        "both.js": `
          console.log("stdout message");
          console.error("stderr message");
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "both.js")],
        env: bunEnv,
        stdout: "buffer",
        stderr: "buffer",
      });

      const [stdout, stderr] = await Promise.all([proc.stdout, proc.stderr]);
      
      expect(stdout).toBeInstanceOf(Buffer);
      expect(stdout.toString()).toBe("stdout message\n");
      
      expect(stderr).toBeInstanceOf(Buffer);
      expect(stderr.toString()).toBe("stderr message\n");
    });

    test("handles empty output", async () => {
      const dir = tempDirWithFiles("spawn-buffer-empty", {
        "empty.js": `// No output`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "empty.js")],
        env: bunEnv,
        stdout: "buffer",
      });

      const buffer = await proc.stdout;
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(0);
      expect(buffer.toString()).toBe("");
    });

    test("resolves after process exits", async () => {
      const dir = tempDirWithFiles("spawn-buffer-timing", {
        "delayed.js": `
          setTimeout(() => {
            console.log("delayed output");
          }, 100);
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "delayed.js")],
        env: bunEnv,
        stdout: "buffer",
      });

      const buffer = await proc.stdout;
      expect(buffer.toString()).toBe("delayed output\n");
      
      // Process should have exited by now
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });

    test("works with maxBuffer", async () => {
      const dir = tempDirWithFiles("spawn-buffer-maxbuf", {
        "overflow.js": `
          const chunk = Buffer.alloc(1024, 'A').toString();
          for (let i = 0; i < 10; i++) {
            process.stdout.write(chunk);
          }
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "overflow.js")],
        env: bunEnv,
        stdout: "buffer",
        maxBuffer: 5 * 1024, // 5KB limit
      });

      try {
        await proc.stdout;
        expect.unreachable("Should have been killed due to maxBuffer");
      } catch (e) {
        // Process should be killed
      }

      const exitCode = await proc.exited;
      expect(exitCode).not.toBe(0);
    });
  });

  describe("stdout: 'text'", () => {
    test("returns a promise that resolves to a UTF-8 string", async () => {
      const dir = tempDirWithFiles("spawn-text-test", {
        "echo.js": `console.log("Hello, world!");`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "echo.js")],
        env: bunEnv,
        stdout: "text",
        stderr: "pipe",
      });

      // Should return a promise
      expect(proc.stdout).toBeInstanceOf(Promise);

      const text = await proc.stdout;
      expect(typeof text).toBe("string");
      expect(text).toBe("Hello, world!\n");

      // Accessing again should return the same promise
      const text2 = await proc.stdout;
      expect(text2).toBe(text);

      // stderr should still be a stream
      const stderr = await new Response(proc.stderr).text();
      expect(stderr).toBe("");
    });

    test("handles UTF-8 correctly", async () => {
      const dir = tempDirWithFiles("spawn-text-utf8", {
        "utf8.js": `
          console.log("Hello 世界 🌍");
          console.log("Emoji: 🎉🎊🎈");
          console.log("Accents: café, naïve, résumé");
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "utf8.js")],
        env: bunEnv,
        stdout: "text",
      });

      const text = await proc.stdout;
      expect(text).toBe("Hello 世界 🌍\nEmoji: 🎉🎊🎈\nAccents: café, naïve, résumé\n");
    });

    test("handles multi-byte UTF-8 sequences", async () => {
      const dir = tempDirWithFiles("spawn-text-multibyte", {
        "multibyte.js": `
          // 2-byte: £ (U+00A3)
          // 3-byte: € (U+20AC)
          // 4-byte: 𝄞 (U+1D11E)
          console.log("2-byte: £");
          console.log("3-byte: €");
          console.log("4-byte: 𝄞");
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "multibyte.js")],
        env: bunEnv,
        stdout: "text",
      });

      const text = await proc.stdout;
      expect(text).toBe("2-byte: £\n3-byte: €\n4-byte: 𝄞\n");
    });

    test("handles invalid UTF-8 by rejecting", async () => {
      const dir = tempDirWithFiles("spawn-text-invalid", {
        "invalid.js": `
          // Output invalid UTF-8 sequence
          process.stdout.write(Buffer.from([0xFF, 0xFE, 0xFD]));
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "invalid.js")],
        env: bunEnv,
        stdout: "text",
      });

      try {
        await proc.stdout;
        expect.unreachable("Should have rejected with invalid UTF-8");
      } catch (e) {
        // Expected to reject
      }
    });

    test("works with stderr: 'text' too", async () => {
      const dir = tempDirWithFiles("spawn-text-stderr", {
        "both.js": `
          console.log("stdout message");
          console.error("stderr message");
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "both.js")],
        env: bunEnv,
        stdout: "text",
        stderr: "text",
      });

      const [stdout, stderr] = await Promise.all([proc.stdout, proc.stderr]);
      
      expect(typeof stdout).toBe("string");
      expect(stdout).toBe("stdout message\n");
      
      expect(typeof stderr).toBe("string");
      expect(stderr).toBe("stderr message\n");
    });

    test("handles empty output", async () => {
      const dir = tempDirWithFiles("spawn-text-empty", {
        "empty.js": `// No output`,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "empty.js")],
        env: bunEnv,
        stdout: "text",
      });

      const text = await proc.stdout;
      expect(typeof text).toBe("string");
      expect(text).toBe("");
    });

    test("handles large text output", async () => {
      const dir = tempDirWithFiles("spawn-text-large", {
        "large.js": `
          const line = Buffer.alloc(80, 'X').toString() + '\\n';
          for (let i = 0; i < 10000; i++) {
            process.stdout.write(line);
          }
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "large.js")],
        env: bunEnv,
        stdout: "text",
      });

      const text = await proc.stdout;
      expect(typeof text).toBe("string");
      expect(text.length).toBe(10000 * 81); // 80 X's + newline
      const lines = text.split('\n');
      expect(lines.length).toBe(10001); // 10000 lines + empty string at end
      expect(lines[0]).toBe(Buffer.alloc(80, 'X').toString());
    });
  });

  describe("mixed modes", () => {
    test("can mix buffer, text, and pipe", async () => {
      const dir = tempDirWithFiles("spawn-mixed", {
        "mixed.js": `
          console.log("stdout");
          console.error("stderr");
        `,
      });

      // Test all combinations
      const configs = [
        { stdout: "buffer", stderr: "text" },
        { stdout: "text", stderr: "buffer" },
        { stdout: "buffer", stderr: "pipe" },
        { stdout: "pipe", stderr: "buffer" },
        { stdout: "text", stderr: "pipe" },
        { stdout: "pipe", stderr: "text" },
      ] as const;

      for (const config of configs) {
        const proc = Bun.spawn({
          cmd: [bunExe(), path.join(dir, "mixed.js")],
          env: bunEnv,
          ...config,
        });

        if (config.stdout === "buffer") {
          const buffer = await proc.stdout;
          expect(buffer).toBeInstanceOf(Buffer);
          expect(buffer.toString()).toBe("stdout\n");
        } else if (config.stdout === "text") {
          const text = await proc.stdout;
          expect(typeof text).toBe("string");
          expect(text).toBe("stdout\n");
        } else {
          const text = await new Response(proc.stdout).text();
          expect(text).toBe("stdout\n");
        }

        if (config.stderr === "buffer") {
          const buffer = await proc.stderr;
          expect(buffer).toBeInstanceOf(Buffer);
          expect(buffer.toString()).toBe("stderr\n");
        } else if (config.stderr === "text") {
          const text = await proc.stderr;
          expect(typeof text).toBe("string");
          expect(text).toBe("stderr\n");
        } else {
          const text = await new Response(proc.stderr).text();
          expect(text).toBe("stderr\n");
        }
      }
    });
  });

  describe("sync mode (spawnSync)", () => {
    test("buffer mode returns buffer in result", () => {
      const dir = tempDirWithFiles("spawn-sync-buffer", {
        "echo.js": `console.log("sync output");`,
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), path.join(dir, "echo.js")],
        env: bunEnv,
        stdout: "buffer",
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toBeDefined();
      expect(result.stdout).toBeInstanceOf(Buffer);
      expect(result.stdout!.toString()).toBe("sync output\n");
    });

    test("text mode returns string in result", () => {
      const dir = tempDirWithFiles("spawn-sync-text", {
        "echo.js": `console.log("sync text");`,
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), path.join(dir, "echo.js")],
        env: bunEnv,
        stdout: "text",
      });

      expect(result.success).toBe(true);
      expect(typeof result.stdout).toBe("string");
      expect(result.stdout).toBe("sync text\n");
    });

    test("handles UTF-8 in sync text mode", () => {
      const dir = tempDirWithFiles("spawn-sync-text-utf8", {
        "utf8.js": `console.log("Hello 世界 🌍");`,
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), path.join(dir, "utf8.js")],
        env: bunEnv,
        stdout: "text",
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("Hello 世界 🌍\n");
    });
  });

  describe("edge cases", () => {
    test("process that exits immediately", async () => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "process.exit(0)"],
        env: bunEnv,
        stdout: "buffer",
      });

      const buffer = await proc.stdout;
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(0);
    });

    test("process that fails", async () => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "throw new Error('test error')"],
        env: bunEnv,
        stdout: "buffer",
        stderr: "text",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout,
        proc.stderr,
        proc.exited,
      ]);

      expect(stdout).toBeInstanceOf(Buffer);
      expect(stdout.length).toBe(0);
      
      expect(typeof stderr).toBe("string");
      expect(stderr).toContain("Error: test error");
      
      expect(exitCode).not.toBe(0);
    });

    test("stdin still works with buffer/text stdout", async () => {
      const dir = tempDirWithFiles("spawn-stdin-buffer", {
        "cat.js": `
          let data = '';
          process.stdin.on('data', chunk => data += chunk);
          process.stdin.on('end', () => console.log(data));
        `,
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(dir, "cat.js")],
        env: bunEnv,
        stdin: "pipe",
        stdout: "buffer",
      });

      proc.stdin.write("Hello from stdin");
      proc.stdin.end();

      const buffer = await proc.stdout;
      expect(buffer.toString()).toBe("Hello from stdin\n");
    });

    test("accessing stdout after it resolves returns same value", async () => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "console.log('test')"],
        env: bunEnv,
        stdout: "buffer",
      });

      const buffer1 = await proc.stdout;
      const buffer2 = await proc.stdout;
      const buffer3 = await proc.stdout;

      expect(buffer1).toBe(buffer2);
      expect(buffer2).toBe(buffer3);
      expect(buffer1.toString()).toBe("test\n");
    });

    test("stdout promise is created lazily", async () => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "console.log('lazy')"],
        env: bunEnv,
        stdout: "buffer",
      });

      // Wait for process to complete
      await proc.exited;

      // Now access stdout - should still work
      const buffer = await proc.stdout;
      expect(buffer.toString()).toBe("lazy\n");
    });
  });
});