import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

// Skip these tests on Windows as they're for verifying cross-compilation
describe.skipIf(isWindows)("Windows Resource Editing with exiftool", () => {
  const hasExiftool = Bun.which("exiftool") !== null;

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
        value === true ? [`--${key}`] : [`--${key}`, value as string],
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
    if (exitCode !== 0) {
      console.error("Build failed with exit code:", exitCode);
      console.error("stderr:", stderr);
    }
    expect(exitCode).toBe(0);
    
    // Filter out mimalloc warnings which are expected for large allocations (Windows PE files ~118MB)
    const filteredStderr = stderr
      .split('\n')
      .filter(line => 
        !line.includes('mimalloc: warning:') && 
        !line.includes('(this may still be a valid very large allocation') &&
        !line.includes('(yes, the previous pointer') &&
        line.trim() !== ''
      )
      .join('\n')
      .trim();
    expect(filteredStderr).toBe("");

    return join(dir, outfile);
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

  test.skipIf(!hasExiftool)("verifies version info with exiftool", async () => {
    const dir = tempDirWithFiles("exiftool-test", {
      "index.js": `console.log("Testing with exiftool");`,
    });

    const exePath = await buildWindowsExecutable(dir, "test.exe", {
      "windows-version": "9.8.7.6",
      "windows-description": "My Custom Description",
      "windows-publisher": "Test Publisher Inc",
      "windows-title": "My Custom Product",
      "windows-copyright": "Copyright 2024 Test Publisher Inc",
    });

    try {
      // Run exiftool to extract metadata
      await using proc = spawn({
        cmd: ["exiftool", "-j", exePath],
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      console.log("Raw exiftool output:", stdout);
      console.log("Executable path for debugging:", join(dir, "test.exe"));
      const metadata = JSON.parse(stdout)[0];

      // Verify the version information
      expect(metadata.FileVersionNumber).toBe("9.8.7.6");
      expect(metadata.ProductVersionNumber).toBe("9.8.7.6");
      expect(metadata.FileDescription).toBe("My Custom Description");
      expect(metadata.CompanyName).toBe("Test Publisher Inc");
      expect(metadata.ProductName).toBe("My Custom Product");
      expect(metadata.LegalCopyright).toBe("Copyright 2024 Test Publisher Inc");
    } finally {
      await Bun.file(exePath).unlink();
    }
  });

  test.skipIf(!hasExiftool)("verifies subsystem change with exiftool", async () => {
    const dir = tempDirWithFiles("exiftool-subsystem", {
      "index.js": `console.log("Testing subsystem");`,
    });

    const exePath = await buildWindowsExecutable(dir, "hidden.exe", {
      "windows-hide-console": true,
    });

    try {
      await using proc = spawn({
        cmd: ["exiftool", "-Subsystem", exePath],
        stdout: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(exitCode).toBe(0);

      // Windows GUI subsystem
      expect(stdout).toContain("Windows GUI");
    } finally {
      await Bun.file(exePath).unlink();
    }
  });

  test.skipIf(!hasExiftool)("verifies icon resource with exiftool", async () => {
    const dir = tempDirWithFiles("exiftool-icon", {
      "index.js": `console.log("Testing icon");`,
      "icon.ico": createTestIcon(),
    });

    const exePath = await buildWindowsExecutable(dir, "icon.exe", {
      "windows-icon": join(dir, "icon.ico"),
      "windows-version": "1.0.0.0",
    });

    try {
      await using proc = spawn({
        cmd: ["exiftool", "-j", exePath],
        stdout: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(exitCode).toBe(0);

      const metadata = JSON.parse(stdout)[0];

      // Even with an icon, the version should still be set
      expect(metadata.FileVersionNumber).toBe("1.0.0.0");
      expect(metadata.ProductVersionNumber).toBe("1.0.0.0");
    } finally {
      await Bun.file(exePath).unlink();
    }
  });

  test.skipIf(!hasExiftool)("verifies all fields with exiftool", async () => {
    const dir = tempDirWithFiles("exiftool-all", {
      "index.js": `console.log("Testing all fields");`,
      "icon.ico": createTestIcon(),
    });

    const exePath = await buildWindowsExecutable(dir, "all.exe", {
      "windows-icon": join(dir, "icon.ico"),
      "windows-version": "5.4.3.2",
      "windows-description": "Complete Test Application",
      "windows-publisher": "Acme Corporation",
      "windows-title": "Acme Test Suite",
      "windows-copyright": "(c) 2024 Acme Corporation. All rights reserved.",
      "windows-hide-console": true,
    });

    try {
      await using proc = spawn({
        cmd: ["exiftool", "-j", exePath],
        stdout: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(exitCode).toBe(0);

      const metadata = JSON.parse(stdout)[0];

      // Verify all fields
      expect(metadata.FileVersionNumber).toBe("5.4.3.2");
      expect(metadata.ProductVersionNumber).toBe("5.4.3.2");
      expect(metadata.FileDescription).toBe("Complete Test Application");
      expect(metadata.CompanyName).toBe("Acme Corporation");
      expect(metadata.ProductName).toBe("Acme Test Suite");
      expect(metadata.LegalCopyright).toBe("(c) 2024 Acme Corporation. All rights reserved.");
      expect(metadata.Subsystem).toBe("Windows GUI");
    } finally {
      await Bun.file(exePath).unlink();
    }
  });

  test.skipIf(!hasExiftool)("snapshot test with exiftool", async () => {
    const dir = tempDirWithFiles("exiftool-snapshot", {
      "index.js": `console.log("Snapshot test");`,
    });

    const exePath = await buildWindowsExecutable(dir, "snapshot.exe", {
      "windows-version": "1.2.3.4",
      "windows-description": "Snapshot Test App",
      "windows-publisher": "Snapshot Publisher",
      "windows-title": "Snapshot Product",
      "windows-copyright": "Copyright 2024",
    });

    try {
      // Get full exiftool output for snapshot
      await using proc = spawn({
        cmd: ["exiftool", exePath],
        stdout: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(exitCode).toBe(0);

      // Extract relevant version info fields for snapshot
      const versionFields = stdout
        .split("\n")
        .filter(
          line =>
            line.includes("File Version Number") ||
            line.includes("Product Version Number") ||
            line.includes("File Description") ||
            line.includes("Company Name") ||
            line.includes("Product Name") ||
            line.includes("Legal Copyright") ||
            line.includes("File Version") ||
            line.includes("Product Version"),
        )
        .join("\n");

      expect(versionFields).toMatchSnapshot();
    } finally {
      await Bun.file(exePath).unlink();
    }
  });

  test.skipIf(!hasExiftool)("verifies real ICO file with exiftool", async () => {
    // Real ICO file created with ImageMagick (full multi-size version)
    const realIcoPath = join(import.meta.dir, "real-icon.ico");
    if (!(await Bun.file(realIcoPath).exists())) {
      // Skip if real icon file doesn't exist
      return;
    }

    const dir = tempDirWithFiles("exiftool-real-ico", {
      "index.js": `console.log("Testing real ICO");`,
      "real.ico": await Bun.file(realIcoPath).bytes(),
    });

    const exePath = await buildWindowsExecutable(dir, "realico.exe", {
      "windows-icon": join(dir, "real.ico"),
      "windows-version": "2.0.0.0",
      "windows-title": "Real Icon Test",
    });

    try {
      await using proc = spawn({
        cmd: ["exiftool", "-j", exePath],
        stdout: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(exitCode).toBe(0);

      const metadata = JSON.parse(stdout)[0];

      // Verify version is still set with real icon
      expect(metadata.FileVersionNumber).toBe("2.0.0.0");
      expect(metadata.ProductName).toBe("Real Icon Test");
    } finally {
      await Bun.file(exePath).unlink();
    }
  });
});
