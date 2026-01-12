import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("Symlink permission resolution", () => {
  describe("symlink to forbidden path is denied", () => {
    test("reading through symlink to forbidden directory is denied", async () => {
      using dir = tempDir("perm-symlink-read-denied", {
        "allowed/link-placeholder": "", // placeholder, we'll create symlink
        "forbidden/secret.txt": "secret content",
      });

      // Create symlink: allowed/link -> ../forbidden/secret.txt
      const linkPath = join(String(dir), "allowed/link");
      const targetPath = join(String(dir), "forbidden/secret.txt");

      // Remove placeholder and create symlink
      await Bun.$`rm ${linkPath}-placeholder`;
      symlinkSync(targetPath, linkPath);

      // Write test script
      await Bun.write(
        join(String(dir), "test.ts"),
        `
        import { readFileSync } from "fs";
        try {
          // Try to read through symlink
          const content = readFileSync("./allowed/link", "utf8");
          console.log("READ:", content);
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
      );

      // Run with only allowed/ directory permitted
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}/allowed`, "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Should be denied because symlink target is in forbidden/
      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });

    test("writing through symlink to forbidden directory is denied", async () => {
      using dir = tempDir("perm-symlink-write-denied", {});

      // Create directories
      mkdirSync(join(String(dir), "allowed"));
      mkdirSync(join(String(dir), "forbidden"));

      // Create existing file in forbidden
      writeFileSync(join(String(dir), "forbidden/target.txt"), "original");

      // Create symlink: allowed/link -> ../forbidden/target.txt
      const linkPath = join(String(dir), "allowed/link");
      const targetPath = join(String(dir), "forbidden/target.txt");
      symlinkSync(targetPath, linkPath);

      await Bun.write(
        join(String(dir), "test.ts"),
        `
        import { writeFileSync } from "fs";
        try {
          writeFileSync("./allowed/link", "hacked!");
          console.log("WROTE");
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
      );

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-write=${String(dir)}/allowed`, `--allow-read=${String(dir)}`, "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });
  });

  describe("symlink to allowed path is permitted", () => {
    test("reading through symlink to allowed directory succeeds", async () => {
      using dir = tempDir("perm-symlink-read-allowed", {});

      // Create directories
      mkdirSync(join(String(dir), "links"));
      mkdirSync(join(String(dir), "data"));

      // Create target file
      writeFileSync(join(String(dir), "data/file.txt"), "allowed content");

      // Create symlink: links/link -> ../data/file.txt
      symlinkSync(join(String(dir), "data/file.txt"), join(String(dir), "links/link"));

      await Bun.write(
        join(String(dir), "test.ts"),
        `
        import { readFileSync } from "fs";
        const content = readFileSync("./links/link", "utf8");
        console.log("CONTENT:", content);
      `,
      );

      // Allow both the link directory and target directory
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}`, "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("CONTENT: allowed content");
      expect(exitCode).toBe(0);
    });
  });

  describe("symlink chains are resolved", () => {
    test("nested symlinks are fully resolved", async () => {
      using dir = tempDir("perm-symlink-chain", {});

      // Create directories
      mkdirSync(join(String(dir), "allowed"));
      mkdirSync(join(String(dir), "forbidden"));

      // Create target file in forbidden
      writeFileSync(join(String(dir), "forbidden/secret.txt"), "top secret");

      // Create chain: allowed/link1 -> allowed/link2 -> ../forbidden/secret.txt
      symlinkSync(join(String(dir), "forbidden/secret.txt"), join(String(dir), "allowed/link2"));
      symlinkSync(join(String(dir), "allowed/link2"), join(String(dir), "allowed/link1"));

      await Bun.write(
        join(String(dir), "test.ts"),
        `
        import { readFileSync } from "fs";
        try {
          const content = readFileSync("./allowed/link1", "utf8");
          console.log("READ:", content);
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
      );

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}/allowed`, "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Should be denied because final target is in forbidden/
      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });
  });

  describe("non-existent symlink targets", () => {
    test("writing to new file through symlink in allowed dir works", async () => {
      using dir = tempDir("perm-symlink-new-file", {});

      mkdirSync(join(String(dir), "allowed"));

      await Bun.write(
        join(String(dir), "test.ts"),
        `
        import { writeFileSync, readFileSync } from "fs";
        // Write to a new file (doesn't exist yet)
        writeFileSync("./allowed/newfile.txt", "new content");
        const content = readFileSync("./allowed/newfile.txt", "utf8");
        console.log("CONTENT:", content);
      `,
      );

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--secure",
          `--allow-read=${String(dir)}/allowed`,
          `--allow-write=${String(dir)}/allowed`,
          "test.ts",
        ],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("CONTENT: new content");
      expect(exitCode).toBe(0);
    });
  });

  describe("relative symlinks", () => {
    test("relative symlink escaping allowed directory is denied", async () => {
      using dir = tempDir("perm-symlink-relative", {});

      mkdirSync(join(String(dir), "allowed"));
      mkdirSync(join(String(dir), "forbidden"));
      writeFileSync(join(String(dir), "forbidden/secret.txt"), "secret");

      // Create relative symlink that escapes: allowed/link -> ../forbidden/secret.txt
      symlinkSync("../forbidden/secret.txt", join(String(dir), "allowed/link"));

      await Bun.write(
        join(String(dir), "test.ts"),
        `
        import { readFileSync } from "fs";
        try {
          const content = readFileSync("./allowed/link", "utf8");
          console.log("READ:", content);
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
      );

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}/allowed`, "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });
  });

  describe("symlink resolution only in secure mode", () => {
    test("symlinks are NOT resolved in non-secure mode (default)", async () => {
      using dir = tempDir("perm-symlink-nonsecure", {});

      mkdirSync(join(String(dir), "allowed"));
      mkdirSync(join(String(dir), "forbidden"));
      writeFileSync(join(String(dir), "forbidden/secret.txt"), "secret content");

      // Create symlink escaping to forbidden
      symlinkSync(join(String(dir), "forbidden/secret.txt"), join(String(dir), "allowed/link"));

      await Bun.write(
        join(String(dir), "test.ts"),
        `
        import { readFileSync } from "fs";
        const content = readFileSync("./allowed/link", "utf8");
        console.log("CONTENT:", content);
      `,
      );

      // Run WITHOUT --secure flag (default mode)
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Should succeed in non-secure mode
      expect(stdout).toContain("CONTENT: secret content");
      expect(exitCode).toBe(0);
    });
  });
});
