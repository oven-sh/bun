import { spawn } from "bun";
import { windowsResourceInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

describe("Windows Resource Editing", () => {
  describe("unit tests", () => {
    test("parseIconFile parses valid ICO", () => {
      const icon = createTestIcon();
      const result = windowsResourceInternals.parseIconFile(icon);

      expect(result.groupIconData).toBeInstanceOf(Uint8Array);
      expect(result.icons).toBeArrayOfSize(1);
      expect(result.icons[0].id).toBe(1);
      expect(result.icons[0].data).toBeInstanceOf(Uint8Array);
    });

    test("parseIconFile rejects invalid data", () => {
      expect(() => windowsResourceInternals.parseIconFile(Buffer.from("not an icon"))).toThrow();
      expect(() => windowsResourceInternals.parseIconFile(Buffer.from([0, 0]))).toThrow();
    });
  });

  // Test icon data (minimal valid ICO file)
  const createTestIcon = () => {
    // ICO header (6 bytes)
    const header = Buffer.from([
      0x00,
      0x00, // Reserved
      0x01,
      0x00, // Type (1 = ICO)
      0x01,
      0x00, // Count (1 icon)
    ]);

    // Directory entry (16 bytes)
    const dirEntry = Buffer.from([
      0x10, // Width (16)
      0x10, // Height (16)
      0x00, // Color count (0 = 256 colors)
      0x00, // Reserved
      0x01,
      0x00, // Planes
      0x08,
      0x00, // Bit count
      0x28,
      0x01,
      0x00,
      0x00, // Bytes in resource (296)
      0x16,
      0x00,
      0x00,
      0x00, // Image offset (22)
    ]);

    // Minimal BMP data (just a header for simplicity)
    const bmpHeader = Buffer.alloc(40);
    bmpHeader.writeUInt32LE(40, 0); // Header size
    bmpHeader.writeInt32LE(16, 4); // Width
    bmpHeader.writeInt32LE(32, 8); // Height (double for AND mask)
    bmpHeader.writeUInt16LE(1, 12); // Planes
    bmpHeader.writeUInt16LE(8, 14); // Bit count
    bmpHeader.writeUInt32LE(0, 16); // Compression
    bmpHeader.writeUInt32LE(256, 20); // Image size

    // Create minimal image data
    const imageData = Buffer.alloc(256); // 16x16x8bpp

    return Buffer.concat([header, dirEntry, bmpHeader, imageData]);
  };

  describe("compile with icon", () => {
    test("--windows-icon sets executable icon", async () => {
      const dir = tempDirWithFiles("windows-icon", {
        "index.js": `console.log("Hello from Bun!");`,
        "test.ico": createTestIcon(),
      });

      const proc = spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          isWindows ? "" : "--target=bun-windows-x64-v1.2.19",
          "--windows-icon",
          join(dir, "test.ico"),
          join(dir, "index.js"),
          "--outfile",
          join(dir, "test.exe"),
        ].filter(x => x),
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        console.log("stdout:", stdout);
        console.log("stderr:", stderr);
        console.log("exitCode:", exitCode);
      }

      expect(exitCode).toBe(0);
      expect(stderr).not.toContain("Failed to set");

      // Verify executable exists
      const exePath = join(dir, "test.exe");
      expect(await Bun.file(exePath).exists()).toBe(true);

      // Check file size
      const fileInfo = await Bun.file(exePath);
      const fileSize = fileInfo.size;

      // Parse and verify resources
      // Force a small delay to ensure file system operations are complete
      await Bun.sleep(100);

      // Use Node.js fs to read the file to avoid any potential Bun caching issues
      const fs = require("fs");
      const exeBuffer = fs.readFileSync(exePath);
      const exeData = exeBuffer.buffer.slice(exeBuffer.byteOffset, exeBuffer.byteOffset + exeBuffer.byteLength);

      const resources = windowsResourceInternals.parseResources(new Uint8Array(exeData));

      // Should have icon resources
      expect(resources.icons.length).toBeGreaterThan(0);
      expect(resources.groupIcons.length).toBe(1);

      // Verify icon data matches what we embedded
      const originalIcon = windowsResourceInternals.parseIconFile(createTestIcon());
      expect(resources.icons[0].data).toEqual(originalIcon.icons[0].data);
    });

    test("invalid icon file shows error", async () => {
      const dir = tempDirWithFiles("windows-icon-invalid", {
        "index.js": `console.log("Hello!");`,
        "bad.ico": Buffer.from("not an icon"),
      });

      const proc = spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          isWindows ? "" : "--target=bun-windows-x64-v1.2.19",
          "--windows-icon",
          join(dir, "bad.ico"),
          join(dir, "index.js"),
          "--outfile",
          join(dir, "test.exe"),
        ].filter(x => x),
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Invalid");
    });
  });

  describe("compile with version info", () => {
    test("--windows-version and --windows-description set version info", async () => {
      const dir = tempDirWithFiles("windows-version", {
        "index.js": `console.log("Hello from MyApp!");`,
      });

      const proc = spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          isWindows ? "" : "--target=bun-windows-x64-v1.2.19",
          "--windows-version",
          "1.2.3.4",
          "--windows-description",
          "My Test Application",
          join(dir, "index.js"),
          "--outfile",
          join(dir, "myapp.exe"),
        ].filter(x => x),
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).not.toContain("Failed to set");

      // Verify executable exists
      const exePath = join(dir, "myapp.exe");
      expect(await Bun.file(exePath).exists()).toBe(true);

      // Parse and verify resources
      await Bun.sleep(100);
      const fs = require("fs");
      const exeBuffer = fs.readFileSync(exePath);
      const exeData = exeBuffer.buffer.slice(exeBuffer.byteOffset, exeBuffer.byteOffset + exeBuffer.byteLength);
      const resources = windowsResourceInternals.parseResources(new Uint8Array(exeData));

      // Should have version info
      expect(resources.versionInfo).not.toBeNull();
      expect(resources.versionInfo.fileVersion).toBe("1.2.3.4");
      expect(resources.versionInfo.fileDescription).toBe("My Test Application");
    });

    test("all Windows options together", async () => {
      const dir = tempDirWithFiles("windows-all", {
        "index.js": `console.log("Complete app!");`,
        "app.ico": createTestIcon(),
      });

      const proc = spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          isWindows ? "" : "--target=bun-windows-x64-v1.2.19",
          "--windows-icon",
          join(dir, "app.ico"),
          "--windows-version",
          "10.5.3.1",
          "--windows-description",
          "Complete Test Application",
          "--windows-hide-console",
          join(dir, "index.js"),
          "--outfile",
          join(dir, "super.exe"),
        ].filter(x => x),
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const exePath = join(dir, "super.exe");
      expect(await Bun.file(exePath).exists()).toBe(true);

      // Parse and verify all resources
      await Bun.sleep(100);
      const fs = require("fs");
      const exeBuffer = fs.readFileSync(exePath);
      const exeData = exeBuffer.buffer.slice(exeBuffer.byteOffset, exeBuffer.byteOffset + exeBuffer.byteLength);
      const resources = windowsResourceInternals.parseResources(new Uint8Array(exeData));

      // Verify icon
      expect(resources.icons.length).toBeGreaterThan(0);
      expect(resources.groupIcons.length).toBe(1);

      // Verify version info
      expect(resources.versionInfo).not.toBeNull();
      expect(resources.versionInfo.fileVersion).toBe("10.5.3.1");
      expect(resources.versionInfo.fileDescription).toBe("Complete Test Application");
    });
  });

  describe("cross-platform compilation", () => {
    test("can set Windows resources when compiling for Windows from non-Windows", async () => {
      // Skip if already on Windows
      if (isWindows) {
        return;
      }

      const dir = tempDirWithFiles("windows-cross", {
        "index.js": `console.log("Cross-compiled!");`,
        "icon.ico": createTestIcon(),
      });

      const proc = spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--target=bun-windows-x64-v1.2.19",
          "--windows-icon",
          join(dir, "icon.ico"),
          "--windows-version",
          "2.0.0.0",
          "--windows-description",
          "Cross Platform App",
          join(dir, "index.js"),
          "--outfile",
          join(dir, "cross.exe"),
        ],
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

      expect(exitCode).toBe(0);

      // Should produce a Windows executable
      const exePath = join(dir, "cross.exe");
      expect(await Bun.file(exePath).exists()).toBe(true);

      // Verify resources are properly embedded even when cross-compiling
      await Bun.sleep(100);
      const fs = require("fs");
      const exeBuffer = fs.readFileSync(exePath);
      const exeData = exeBuffer.buffer.slice(exeBuffer.byteOffset, exeBuffer.byteOffset + exeBuffer.byteLength);
      const resources = windowsResourceInternals.parseResources(new Uint8Array(exeData));

      expect(resources.icons.length).toBeGreaterThan(0);
      expect(resources.versionInfo).not.toBeNull();
      expect(resources.versionInfo.fileVersion).toBe("2.0.0.0");
      expect(resources.versionInfo.fileDescription).toBe("Cross Platform App");
    });
  });

  describe("error handling", () => {
    test("--windows-description requires --compile", async () => {
      const dir = tempDirWithFiles("windows-no-compile", {
        "index.js": `console.log("test");`,
      });

      const proc = spawn({
        cmd: [bunExe(), "build", "--windows-description", "Test", join(dir, "index.js")],
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--windows-description requires --compile");
    });

    test("--windows-icon requires --compile", async () => {
      const dir = tempDirWithFiles("windows-icon-no-compile", {
        "index.js": `console.log("test");`,
        "test.ico": createTestIcon(),
      });

      const proc = spawn({
        cmd: [bunExe(), "build", "--windows-icon", join(dir, "test.ico"), join(dir, "index.js")],
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--windows-icon requires --compile");
    });

    test("--windows-version requires --compile", async () => {
      const dir = tempDirWithFiles("windows-version-no-compile", {
        "index.js": `console.log("test");`,
      });

      const proc = spawn({
        cmd: [bunExe(), "build", "--windows-version", "1.0.0.0", join(dir, "index.js")],
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--windows-version requires --compile");
    });

    test("invalid version format shows error", async () => {
      const dir = tempDirWithFiles("windows-bad-version", {
        "index.js": `console.log("test");`,
      });

      const proc = spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--target=bun-windows-x64-v1.2.19",
          "--windows-version",
          "not-a-version",
          join(dir, "index.js"),
        ],
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("Invalid");
    });
  });

  describe("version parsing", () => {
    test("accepts valid version formats", async () => {
      const dir = tempDirWithFiles("windows-version-formats", {
        "index.js": `console.log("Version test");`,
      });

      const testCases = [
        { version: "1.0.0.0", expected: "1.0.0.0" },
        { version: "255.255.65535.65535", expected: "255.255.65535.65535" },
        { version: "0.0.0.1", expected: "0.0.0.1" },
      ];

      for (const { version, expected } of testCases) {
        await using proc = spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--target=bun-windows-x64-v1.2.19",
            `--outfile=version-${version.replace(/\./g, "-")}.exe`,
            `--windows-version=${version}`,
            join(dir, "index.js"),
          ],
          cwd: dir,
          env: bunEnv,
          stderr: "pipe",
        });

        const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

        expect(exitCode).toBe(0);
        expect(stderr).toBe("");

        // Verify version in resources
        const exePath = join(dir, `version-${version.replace(/\./g, "-")}.exe`);
        await Bun.sleep(100);
        const fs = require("fs");
        const exeBuffer = fs.readFileSync(exePath);
        const exeData = exeBuffer.buffer.slice(exeBuffer.byteOffset, exeBuffer.byteOffset + exeBuffer.byteLength);
        const resources = windowsResourceInternals.parseResources(new Uint8Array(exeData));

        expect(resources.versionInfo?.fileVersion).toBe(expected);
      }
    });

    test("rejects invalid version formats", async () => {
      const dir = tempDirWithFiles("windows-bad-versions", {
        "index.js": `console.log("test");`,
      });

      const invalidVersions = [
        "1", // too few parts
        "1.2", // too few parts
        "1.2.3", // too few parts
        "1.2.3.4.5", // too many parts
        "a.b.c.d", // non-numeric
        "1.2.3.-1", // negative number
        "65536.0.0.0", // overflow
      ];

      for (const version of invalidVersions) {
        await using proc = spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--target=bun-windows-x64-v1.2.19",
            `--windows-version=${version}`,
            join(dir, "index.js"),
          ],
          cwd: dir,
          env: bunEnv,
          stderr: "pipe",
        });

        const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

        expect(exitCode).toBe(1);
        expect(stderr).toContain("Invalid");
      }
    });
  });

  // Run actual executable on Windows
  if (isWindows) {
    describe("runtime verification", () => {
      test("executable with resources runs correctly", async () => {
        const dir = tempDirWithFiles("windows-runtime", {
          "app.js": `console.log("Running with resources!");`,
          "app.ico": createTestIcon(),
        });

        // Build with resources
        await using buildProc = spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--windows-icon",
            join(dir, "app.ico"),
            "--windows-version",
            "1.0.0.0",
            "--windows-description",
            "Runtime Test App",
            join(dir, "app.js"),
            "--outfile",
            join(dir, "app.exe"),
          ],
          cwd: dir,
          env: bunEnv,
        });

        expect(await buildProc.exited).toBe(0);

        // Run the executable
        await using runProc = spawn({
          cmd: [join(dir, "app.exe")],
          cwd: dir,
          stdout: "pipe",
        });

        const [stdout, exitCode] = await Promise.all([new Response(runProc.stdout).text(), runProc.exited]);

        expect(exitCode).toBe(0);
        expect(stdout.trim()).toBe("Running with resources!");
      });
    });
  }
});
