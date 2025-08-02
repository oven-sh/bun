import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

// Skip these tests on Windows as they're for verifying cross-compilation
describe.skipIf(isWindows)("Windows Resource Editing with External Tools", () => {
  // Check which tools are available
  const hasObjdump = Bun.which("objdump") !== null;
  const hasLlvmObjdump = Bun.which("llvm-objdump") !== null;
  const hasHexdump = Bun.which("hexdump") !== null;
  const hasStrings = Bun.which("strings") !== null;
  const hasReadelf = Bun.which("readelf") !== null;

  // Common build function
  async function buildWindowsExecutable(
    dir: string,
    outfile: string,
    windowsOptions: Record<string, string | boolean> = {},
  ) {
    const args = [
      bunExe(),
      "build",
      "--compile",
      "--target=bun-windows-x64-v1.2.19",
      ...Object.entries(windowsOptions).flatMap(([key, value]) => 
        value === true ? [`--${key}`] : [`--${key}`, value as string]
      ),
      join(dir, "index.js"),
      "--outfile",
      join(dir, outfile),
    ];

    await using proc = spawn({
      cmd: args,
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    
    // Return path for cleanup
    return join(dir, outfile);
  }

  // Common objdump execution
  async function runObjdump(exePath: string, args: string[] = ["-p"]) {
    await using proc = spawn({
      cmd: ["objdump", ...args, exePath],
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    return { stdout, stderr };
  }

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

  describe("objdump verification", () => {
    test.skipIf(!hasObjdump)("verifies resource directory with objdump", async () => {
      const dir = tempDirWithFiles("objdump-test", {
        "index.js": `console.log("Testing with objdump");`,
        "icon.ico": createTestIcon(),
      });

      const exePath = await buildWindowsExecutable(dir, "test.exe", {
        "windows-icon": join(dir, "icon.ico"),
        "windows-version": "1.2.3.4",
        "windows-description": "Test Application",
        "windows-publisher": "Test Company",
        "windows-title": "TestApp",
        "windows-copyright": "(c) 2024 Test Company",
      });

      try {
        const { stdout: objdumpStdout } = await runObjdump(exePath);

      // Verify resource directory exists
      expect(objdumpStdout).toContain("Resource Directory [.rsrc]");

      // The output should show the resource directory entry
      const resourceMatch = objdumpStdout.match(/Entry 2\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+Resource Directory/);
      expect(resourceMatch).not.toBeNull();

      // Verify the size is non-zero
      const resourceSize = parseInt(resourceMatch![2], 16);
      expect(resourceSize).toBeGreaterThan(0);
      } finally {
        await Bun.file(exePath).unlink();
      }
    });

    test.skipIf(!hasObjdump)("verifies PE subsystem with objdump", async () => {
      const dir = tempDirWithFiles("objdump-subsystem", {
        "index.js": `console.log("Testing subsystem");`,
      });

      const exePath = await buildWindowsExecutable(dir, "hidden.exe", {
        "windows-hide-console": true,
      });

      try {
        const { stdout } = await runObjdump(exePath);

      // Windows GUI subsystem is 2, console subsystem is 3
      expect(stdout).toMatch(/Subsystem\s+00000002\s+\(Windows GUI\)/);
      } finally {
        await Bun.file(exePath).unlink();
      }
    });
  });

  describe("llvm-objdump verification", () => {
    test.skipIf(!hasLlvmObjdump)("verifies sections with llvm-objdump", async () => {
      const dir = tempDirWithFiles("llvm-objdump-test", {
        "index.js": `console.log("LLVM test");`,
        "icon.ico": createTestIcon(),
      });

      const exePath = await buildWindowsExecutable(dir, "llvm-test.exe", {
        "windows-icon": join(dir, "icon.ico"),
        "windows-version": "5.4.3.2",
      });

      try {
        await using llvmProc = spawn({
          cmd: ["llvm-objdump", "--section-headers", exePath],
          cwd: dir,
          stdout: "pipe",
        });

        const [stdout, exitCode] = await Promise.all([new Response(llvmProc.stdout).text(), llvmProc.exited]);
        expect(exitCode).toBe(0);

        // Verify .rsrc section exists
        expect(stdout).toMatch(/\.rsrc\s+[0-9a-fA-F]+\s+[0-9a-fA-F]+/);
      } finally {
        await Bun.file(exePath).unlink();
      }
    });
  });

  describe("hexdump verification", () => {
    test.skipIf(!hasHexdump)("verifies RT_VERSION resource with hexdump", async () => {
      const dir = tempDirWithFiles("hexdump-version", {
        "index.js": `console.log("Version test");`,
      });

      const exePath = await buildWindowsExecutable(dir, "version.exe", {
        "windows-version": "1.2.3.4",
        "windows-description": "My Test App",
        "windows-publisher": "Test Publisher",
        "windows-title": "Test Product",
        "windows-copyright": "Copyright 2024 Test Publisher",
      });

      try {
        const { stdout: objdumpOut } = await runObjdump(exePath, ["-h"]);

      // Parse .rsrc section info
      const rsrcMatch = objdumpOut.match(/\.rsrc\s+([0-9a-fA-F]+)\s+[0-9a-fA-F]+\s+[0-9a-fA-F]+\s+([0-9a-fA-F]+)/);
      expect(rsrcMatch).not.toBeNull();

      const rsrcSize = parseInt(rsrcMatch![1], 16);
      const rsrcOffset = parseInt(rsrcMatch![2], 16);

      // Use dd to extract just the .rsrc section for easier analysis
      await using ddProc = spawn({
        cmd: [
          "dd",
          `if=${exePath}`,
          `bs=1`,
          `skip=${rsrcOffset}`,
          `count=${Math.min(rsrcSize, 4096)}`,
        ],
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const rsrcData = await new Response(ddProc.stdout).bytes();
      expect(await ddProc.exited).toBe(0);

      // Look for UTF-16LE strings in the resource data
      // Convert to string to search for our version strings
      const decoder = new TextDecoder("utf-16le", { fatal: false });
      const text = decoder.decode(rsrcData);

      // Should contain version info strings
      expect(text).toContain("FileDescription");
      expect(text).toContain("My Test App");
      expect(text).toContain("CompanyName");
      expect(text).toContain("Test Publisher");
      expect(text).toContain("ProductName");
      expect(text).toContain("Test Product");
      expect(text).toContain("LegalCopyright");
      expect(text).toContain("Copyright 2024 Test Publisher");
      } finally {
        await Bun.file(exePath).unlink();
      }
    });
  });

  describe("strings utility verification", () => {
    test.skipIf(!hasStrings)("finds version strings with strings command", async () => {
      const dir = tempDirWithFiles("strings-test", {
        "index.js": `console.log("String search test");`,
      });

      const testDescription = "This is my test application description";
      const testPublisher = "Acme Test Corporation";
      const testTitle = "Super Test Product";
      const testCopyright = "Copyright (c) 2024 Acme Test Corporation";

      const exePath = await buildWindowsExecutable(dir, "strings.exe", {
        "windows-version": "9.8.7.6",
        "windows-description": testDescription,
        "windows-publisher": testPublisher,
        "windows-title": testTitle,
        "windows-copyright": testCopyright,
      });

      try {
        // Use strings with UTF-16 encoding to find our strings
        await using stringsProc = spawn({
          cmd: ["strings", "-e", "l", exePath],
          cwd: dir,
          stdout: "pipe",
        });

      const [stdout, exitCode] = await Promise.all([new Response(stringsProc.stdout).text(), stringsProc.exited]);

      expect(exitCode).toBe(0);

      // Our UTF-16LE strings should be found
      expect(stdout).toContain(testDescription);
      expect(stdout).toContain(testPublisher);
      expect(stdout).toContain(testTitle);
      expect(stdout).toContain(testCopyright);
      expect(stdout).toContain("CompanyName");
      expect(stdout).toContain("FileDescription");
      expect(stdout).toContain("ProductName");
      expect(stdout).toContain("LegalCopyright");
      expect(stdout).toContain("9.8.7.6"); // Version string
      } finally {
        await Bun.file(exePath).unlink();
      }
    });
  });

  describe("readelf verification", () => {
    test.skipIf(!hasReadelf)("verifies PE format with readelf", async () => {
      const dir = tempDirWithFiles("readelf-test", {
        "index.js": `console.log("PE format test");`,
      });

      const exePath = await buildWindowsExecutable(dir, "pe.exe", {
        "windows-version": "1.0.0.0",
      });

      try {
        // readelf can detect PE format even though it's primarily for ELF
        await using readelfProc = spawn({
          cmd: ["readelf", "-h", exePath],
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
        });

      const stderr = await new Response(readelfProc.stderr).text();

      // readelf should fail on PE files with a specific error
      expect(stderr).toContain("Not an ELF file");
      } finally {
        await Bun.file(exePath).unlink();
      }
    });
  });

  test("multiple targets with resources", async () => {
    const dir = tempDirWithFiles("multi-target", {
      "index.js": `console.log("Multi-platform build");`,
      "icon.ico": createTestIcon(),
    });

    // Build for multiple Windows architectures
    const targets = ["bun-windows-x64-v1.2.19", "bun-windows-x64-modern-v1.2.19"];

    for (const target of targets) {
      const outfile = `test-${target.replace(/[^a-z0-9]/gi, "-")}.exe`;

      // Override target for this specific test
      await using proc = spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          `--target=${target}`,
          "--windows-icon",
          join(dir, "icon.ico"),
          "--windows-version",
          "2.1.0.0",
          "--windows-description",
          `Built for ${target}`,
          join(dir, "index.js"),
          "--outfile",
          join(dir, outfile),
        ],
        cwd: dir,
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      // Verify file exists and is a PE executable
      const exePath = join(dir, outfile);
      expect(await Bun.file(exePath).exists()).toBe(true);

      // Check magic bytes for PE
      const file = await Bun.file(exePath).slice(0, 2).text();
      expect(file).toBe("MZ"); // DOS header magic
      
      // Clean up
      await Bun.file(exePath).unlink();
    }
  });
});
