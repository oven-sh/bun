import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

// Skip these tests on Windows as they're for verifying cross-compilation
describe.skipIf(isWindows)("Windows PE Checksum Verification", () => {
  const hasObjdump = Bun.which("objdump") !== null;

  test.skipIf(!hasObjdump)("verifies PE checksum is calculated correctly", async () => {
    const dir = tempDirWithFiles("pe-checksum-test", {
      "index.js": `console.log("Testing PE checksum");`,
    });

    // Build executable without any Windows settings
    await using buildProc = spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-windows-x64",
        join(dir, "index.js"),
        "--outfile",
        join(dir, "test.exe"),
      ],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
    });

    const [buildStderr, buildExitCode] = await Promise.all([new Response(buildProc.stderr).text(), buildProc.exited]);

    expect(buildExitCode).toBe(0);
    expect(buildStderr).toBe("");

    // Use objdump to check the PE checksum
    await using objdumpProc = spawn({
      cmd: ["objdump", "-p", join(dir, "test.exe")],
      cwd: dir,
      stdout: "pipe",
    });

    const [objdumpStdout, objdumpExitCode] = await Promise.all([
      new Response(objdumpProc.stdout).text(),
      objdumpProc.exited,
    ]);

    expect(objdumpExitCode).toBe(0);

    // Extract checksum from objdump output
    const checksumMatch = objdumpStdout.match(/CheckSum\s+([0-9a-fA-F]+)/);
    expect(checksumMatch).not.toBeNull();

    const checksum = checksumMatch![1];
    console.log("PE checksum:", checksum);

    // Checksum should not be 0 after our implementation
    expect(checksum).not.toBe("00000000");
  });

  test.skipIf(!hasObjdump)("verifies PE checksum with Windows resources", async () => {
    const dir = tempDirWithFiles("pe-checksum-resources", {
      "index.js": `console.log("Testing checksum with resources");`,
      "icon.ico": createTestIcon(),
    });

    // Build with Windows resources
    await using buildProc = spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target=bun-windows-x64",
        "--windows-icon",
        join(dir, "icon.ico"),
        "--windows-version",
        "1.2.3.4",
        "--windows-description",
        "Checksum Test App",
        join(dir, "index.js"),
        "--outfile",
        join(dir, "test-resources.exe"),
      ],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
    });

    const [buildStderr, buildExitCode] = await Promise.all([new Response(buildProc.stderr).text(), buildProc.exited]);

    expect(buildExitCode).toBe(0);
    expect(buildStderr).toBe("");

    // Check the checksum
    await using objdumpProc = spawn({
      cmd: ["objdump", "-p", join(dir, "test-resources.exe")],
      cwd: dir,
      stdout: "pipe",
    });

    const [objdumpStdout, objdumpExitCode] = await Promise.all([
      new Response(objdumpProc.stdout).text(),
      objdumpProc.exited,
    ]);

    expect(objdumpExitCode).toBe(0);

    const checksumMatch = objdumpStdout.match(/CheckSum\s+([0-9a-fA-F]+)/);
    expect(checksumMatch).not.toBeNull();

    const checksum = checksumMatch![1];
    console.log("PE checksum with resources:", checksum);

    // Checksum should not be 0
    expect(checksum).not.toBe("00000000");
  });
});

// Helper function to create a test icon
function createTestIcon() {
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

  // Minimal BMP data
  const bmpHeader = Buffer.alloc(40);
  bmpHeader.writeUInt32LE(40, 0); // Header size
  bmpHeader.writeInt32LE(16, 4); // Width
  bmpHeader.writeInt32LE(32, 8); // Height (double for AND mask)
  bmpHeader.writeUInt16LE(1, 12); // Planes
  bmpHeader.writeUInt16LE(8, 14); // Bit count
  bmpHeader.writeUInt32LE(0, 16); // Compression
  bmpHeader.writeUInt32LE(256, 20); // Image size

  const imageData = Buffer.alloc(256); // 16x16x8bpp

  return Buffer.concat([header, dirEntry, bmpHeader, imageData]);
}
