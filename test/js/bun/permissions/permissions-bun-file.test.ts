import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Bun.file() permissions", () => {
  describe("read permissions", () => {
    test("Bun.file().text() blocked without --allow-read", async () => {
      using dir = tempDir("bun-file-read", {
        "secret.txt": "secret data",
        "test.ts": `
          try {
            const content = await Bun.file("./secret.txt").text();
            console.log("READ_SUCCESS:" + content);
          } catch (e) {
            console.log("READ_BLOCKED:" + e.message.includes("PermissionDenied"));
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("READ_BLOCKED:true");
      expect(exitCode).toBe(0);
    });

    test("Bun.file().text() allowed with --allow-read", async () => {
      using dir = tempDir("bun-file-read-allowed", {
        "allowed.txt": "allowed data",
        "test.ts": `
          try {
            const content = await Bun.file("./allowed.txt").text();
            console.log("READ_SUCCESS:" + content.trim());
          } catch (e) {
            console.log("READ_BLOCKED:" + e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}`, "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("READ_SUCCESS:allowed data");
      expect(exitCode).toBe(0);
    });

    test("Bun.file().arrayBuffer() blocked without --allow-read", async () => {
      using dir = tempDir("bun-file-arraybuffer", {
        "data.bin": "binary data",
        "test.ts": `
          try {
            const buffer = await Bun.file("./data.bin").arrayBuffer();
            console.log("READ_SUCCESS:" + buffer.byteLength);
          } catch (e) {
            console.log("READ_BLOCKED:" + e.message.includes("PermissionDenied"));
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("READ_BLOCKED:true");
      expect(exitCode).toBe(0);
    });

    test("Bun.file().arrayBuffer() allowed with --allow-read", async () => {
      using dir = tempDir("bun-file-arraybuffer-allowed", {
        "data.bin": "binary data",
        "test.ts": `
          try {
            const buffer = await Bun.file("./data.bin").arrayBuffer();
            console.log("READ_SUCCESS:" + buffer.byteLength);
          } catch (e) {
            console.log("READ_BLOCKED:" + e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}`, "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("READ_SUCCESS:11");
      expect(exitCode).toBe(0);
    });

    test("Bun.file().stream() blocked without --allow-read", async () => {
      using dir = tempDir("bun-file-stream", {
        "stream.txt": "stream data",
        "test.ts": `
          try {
            const stream = Bun.file("./stream.txt").stream();
            const reader = stream.getReader();
            const { value } = await reader.read();
            console.log("READ_SUCCESS:" + new TextDecoder().decode(value));
          } catch (e) {
            console.log("READ_BLOCKED:" + e.message.includes("PermissionDenied"));
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("READ_BLOCKED:true");
      expect(exitCode).toBe(0);
    });

    test("Bun.file().stream() allowed with --allow-read", async () => {
      using dir = tempDir("bun-file-stream-allowed", {
        "stream.txt": "stream data",
        "test.ts": `
          try {
            const stream = Bun.file("./stream.txt").stream();
            const reader = stream.getReader();
            const { value } = await reader.read();
            console.log("READ_SUCCESS:" + new TextDecoder().decode(value).trim());
          } catch (e) {
            console.log("READ_BLOCKED:" + e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}`, "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("READ_SUCCESS:stream data");
      expect(exitCode).toBe(0);
    });

    test("Bun.file().json() blocked without --allow-read", async () => {
      using dir = tempDir("bun-file-json", {
        "data.json": '{"key": "value"}',
        "test.ts": `
          try {
            const data = await Bun.file("./data.json").json();
            console.log("READ_SUCCESS:" + data.key);
          } catch (e) {
            console.log("READ_BLOCKED:" + e.message.includes("PermissionDenied"));
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("READ_BLOCKED:true");
      expect(exitCode).toBe(0);
    });

    test("Bun.file().json() allowed with --allow-read", async () => {
      using dir = tempDir("bun-file-json-allowed", {
        "data.json": '{"key": "value"}',
        "test.ts": `
          try {
            const data = await Bun.file("./data.json").json();
            console.log("READ_SUCCESS:" + data.key);
          } catch (e) {
            console.log("READ_BLOCKED:" + e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}`, "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("READ_SUCCESS:value");
      expect(exitCode).toBe(0);
    });
  });

  describe("write permissions", () => {
    test("Bun.write() to Bun.file() blocked without --allow-write", async () => {
      using dir = tempDir("bun-file-write", {
        "test.ts": `
          try {
            await Bun.write(Bun.file("./output.txt"), "new content");
            console.log("WRITE_SUCCESS");
          } catch (e) {
            console.log("WRITE_BLOCKED:" + e.message.includes("PermissionDenied"));
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("WRITE_BLOCKED:true");
      expect(exitCode).toBe(0);
    });

    test("Bun.write() to Bun.file() allowed with --allow-write", async () => {
      using dir = tempDir("bun-file-write-allowed", {
        "test.ts": `
          try {
            await Bun.write(Bun.file("./output.txt"), "new content");
            const content = await Bun.file("./output.txt").text();
            console.log("WRITE_SUCCESS:" + content);
          } catch (e) {
            console.log("WRITE_BLOCKED:" + e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-write=${String(dir)}`, `--allow-read=${String(dir)}`, "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("WRITE_SUCCESS:new content");
      expect(exitCode).toBe(0);
    });

    test("Bun.write() to path string blocked without --allow-write", async () => {
      using dir = tempDir("bun-write-path", {
        "test.ts": `
          try {
            await Bun.write("./output.txt", "content");
            console.log("WRITE_SUCCESS");
          } catch (e) {
            console.log("WRITE_BLOCKED:" + e.message.includes("PermissionDenied"));
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("WRITE_BLOCKED:true");
      expect(exitCode).toBe(0);
    });

    test("Bun.write() to path string allowed with --allow-write", async () => {
      using dir = tempDir("bun-write-path-allowed", {
        "test.ts": `
          try {
            await Bun.write("./output.txt", "written content");
            const content = await Bun.file("./output.txt").text();
            console.log("WRITE_SUCCESS:" + content);
          } catch (e) {
            console.log("WRITE_BLOCKED:" + e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-write=${String(dir)}`, `--allow-read=${String(dir)}`, "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("WRITE_SUCCESS:written content");
      expect(exitCode).toBe(0);
    });
  });

  describe("Bun.file() properties", () => {
    test("Bun.file().size blocked without --allow-read", async () => {
      using dir = tempDir("bun-file-size", {
        "data.txt": "some content here",
        "test.ts": `
          try {
            const size = Bun.file("./data.txt").size;
            console.log("SIZE_SUCCESS:" + size);
          } catch (e) {
            console.log("SIZE_BLOCKED:" + e.message.includes("PermissionDenied"));
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("SIZE_BLOCKED:true");
      expect(exitCode).toBe(0);
    });

    test("Bun.file().size allowed with --allow-read", async () => {
      using dir = tempDir("bun-file-size-allowed", {
        "data.txt": "some content here",
        "test.ts": `
          try {
            const size = Bun.file("./data.txt").size;
            console.log("SIZE_SUCCESS:" + size);
          } catch (e) {
            console.log("SIZE_BLOCKED:" + e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}`, "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("SIZE_SUCCESS:17");
      expect(exitCode).toBe(0);
    });

    test("Bun.file().exists() blocked without --allow-read", async () => {
      using dir = tempDir("bun-file-exists", {
        "data.txt": "content",
        "test.ts": `
          try {
            const exists = await Bun.file("./data.txt").exists();
            console.log("EXISTS_SUCCESS:" + exists);
          } catch (e) {
            console.log("EXISTS_BLOCKED:" + e.message.includes("PermissionDenied"));
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("EXISTS_BLOCKED:true");
      expect(exitCode).toBe(0);
    });

    test("Bun.file().exists() allowed with --allow-read", async () => {
      using dir = tempDir("bun-file-exists-allowed", {
        "data.txt": "content",
        "test.ts": `
          try {
            const exists = await Bun.file("./data.txt").exists();
            console.log("EXISTS_SUCCESS:" + exists);
          } catch (e) {
            console.log("EXISTS_BLOCKED:" + e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}`, "test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("EXISTS_SUCCESS:true");
      expect(exitCode).toBe(0);
    });
  });
});
