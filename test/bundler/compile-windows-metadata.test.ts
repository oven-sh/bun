import { describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { promises as fs } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// PE optional-header Subsystem values
const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3;

// Read the Subsystem field from a PE32+ optional header.
// Layout: e_lfanew at DOS+0x3C points to "PE\0\0" (4 bytes), followed by the
// 20-byte COFF header, then the optional header whose Subsystem is at +68.
// The whole header fits in the first page, so read 4 KiB instead of the full exe.
async function readPESubsystem(path: string): Promise<number> {
  const data = await Bun.file(path).slice(0, 4096).bytes();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const peOffset = view.getUint32(0x3c, true);
  return view.getUint16(peOffset + 24 + 68, true);
}

// Helper to ensure executable cleanup
function cleanup(outfile: string) {
  return {
    [Symbol.asyncDispose]: async () => {
      try {
        await fs.rm(outfile, { force: true });
      } catch {}
    },
  };
}

// Drain stdout/stderr and assert the build succeeded. These tests run
// concurrently and spawn many `bun build --compile` processes from the same
// cwd; asserting on the combined object means a flake shows the real stderr
// instead of just "Expected: 0, Received: 1".
async function expectBuildOk(proc: Bun.Subprocess<"ignore", "pipe", "pipe">) {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return { stdout, stderr, exitCode };
}

// https://github.com/oven-sh/bun/issues/19916
describe.skipIf(!isWindows).concurrent("--windows-hide-console", () => {
  test("default build is a console subsystem", async () => {
    using dir = tempDir("windows-subsystem-default", {
      "app.js": `console.log("cui");`,
    });
    const outfile = join(String(dir), "cui.exe");
    await using _cleanup = cleanup(outfile);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await expectBuildOk(proc);

    expect(await readPESubsystem(outfile)).toBe(IMAGE_SUBSYSTEM_WINDOWS_CUI);
  });

  test("CLI flag sets GUI subsystem", async () => {
    using dir = tempDir("windows-subsystem-gui-cli", {
      "app.js": `require("fs").writeFileSync(process.argv[2], "ran");`,
    });
    const outfile = join(String(dir), "gui.exe");
    await using _cleanup = cleanup(outfile);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--windows-hide-console",
        join(String(dir), "app.js"),
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await expectBuildOk(proc);

    expect(await readPESubsystem(outfile)).toBe(IMAGE_SUBSYSTEM_WINDOWS_GUI);

    // The resulting GUI-subsystem exe still has to be a valid, runnable PE.
    // A GUI process has no console, so assert via a file side effect + exit code.
    const marker = join(String(dir), "marker.txt");
    await using run = Bun.spawn({ cmd: [outfile, marker], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [, , runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(await Bun.file(marker).text()).toBe("ran");
    expect(runExit).toBe(0);
  });

  test("Bun.build() hideConsole sets GUI subsystem", async () => {
    using dir = tempDir("windows-subsystem-gui-api", {
      "app.js": `console.log("gui");`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      outdir: String(dir),
      compile: {
        target: process.arch === "arm64" ? "bun-windows-aarch64" : "bun-windows-x64",
        outfile: "gui-api.exe",
        windows: { hideConsole: true },
      },
    });
    expect(result.success).toBe(true);

    const outfile = result.outputs[0].path;
    await using _cleanup = cleanup(outfile);
    expect(await readPESubsystem(outfile)).toBe(IMAGE_SUBSYSTEM_WINDOWS_GUI);
  });

  test("GUI subsystem survives the rescle metadata pass", async () => {
    using dir = tempDir("windows-subsystem-gui-rescle", {
      "app.js": `console.log("gui+metadata");`,
    });
    const outfile = join(String(dir), "gui-rescle.exe");
    await using _cleanup = cleanup(outfile);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--windows-hide-console",
        "--windows-title",
        "Hidden Console App",
        join(String(dir), "app.js"),
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await expectBuildOk(proc);

    expect(await readPESubsystem(outfile)).toBe(IMAGE_SUBSYSTEM_WINDOWS_GUI);
  });
});

describe.skipIf(!isWindows).concurrent("Windows compile metadata", () => {
  describe("CLI flags", () => {
    test("all metadata flags via CLI", async () => {
      using dir = tempDir("windows-metadata-cli", {
        "app.js": `console.log("Test app with metadata");`,
      });

      const outfile = join(String(dir), "app-with-metadata.exe");
      await using _cleanup = cleanup(outfile);

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          "My Application",
          "--windows-publisher",
          "Test Company Inc",
          "--windows-version",
          "1.2.3.4",
          "--windows-description",
          "A test application with metadata",
          "--windows-copyright",
          "Copyright © 2024 Test Company Inc",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      // Verify executable was created
      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);

      // Verify metadata using PowerShell
      const getMetadata = (field: string) => {
        try {
          return execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.${field}"`, {
            encoding: "utf8",
          }).trim();
        } catch {
          return "";
        }
      };

      expect(getMetadata("ProductName")).toBe("My Application");
      expect(getMetadata("CompanyName")).toBe("Test Company Inc");
      expect(getMetadata("FileDescription")).toBe("A test application with metadata");
      expect(getMetadata("LegalCopyright")).toBe("Copyright © 2024 Test Company Inc");
      expect(getMetadata("ProductVersion")).toBe("1.2.3.4");
      expect(getMetadata("FileVersion")).toBe("1.2.3.4");
    });

    test("partial metadata flags", async () => {
      using dir = tempDir("windows-metadata-partial", {
        "app.js": `console.log("Partial metadata test");`,
      });

      const outfile = join(String(dir), "app-partial.exe");
      await using _cleanup = cleanup(outfile);

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          "Simple App",
          "--windows-version",
          "2.0.0.0",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      const getMetadata = (field: string) => {
        try {
          return execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.${field}"`, {
            encoding: "utf8",
          }).trim();
        } catch {
          return "";
        }
      };

      expect(getMetadata("ProductName")).toBe("Simple App");
      expect(getMetadata("ProductVersion")).toBe("2.0.0.0");
      expect(getMetadata("FileVersion")).toBe("2.0.0.0");
    });

    test("windows flags without --compile should error", async () => {
      using dir = tempDir("windows-no-compile", {
        "app.js": `console.log("test");`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", join(String(dir), "app.js"), "--windows-title", "Should Fail"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--windows-title requires --compile");
    });

    test("windows flags with non-Windows target should error", async () => {
      using dir = tempDir("windows-wrong-target", {
        "app.js": `console.log("test");`,
      });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--target",
          "bun-linux-x64",
          join(String(dir), "app.js"),
          "--windows-title",
          "Should Fail",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(exitCode).not.toBe(0);
      // Windows flags require a Windows compile target
      expect(stderr.toLowerCase()).toContain("windows compile target");
    });
  });

  describe("Bun.build() API", () => {
    test("all metadata via Bun.build()", async () => {
      using dir = tempDir("windows-metadata-api", {
        "app.js": `console.log("API metadata test");`,
      });

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        outdir: String(dir),
        compile: {
          target: process.arch === "arm64" ? "bun-windows-aarch64" : "bun-windows-x64",
          outfile: "app-api.exe",
          windows: {
            title: "API App",
            publisher: "API Company",
            version: "3.0.0.0",
            description: "Built with Bun.build API",
            copyright: "© 2024 API Company",
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.outputs.length).toBe(1);

      const outfile = result.outputs[0].path;
      await using _cleanup = cleanup(outfile);

      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);

      const getMetadata = (field: string) => {
        try {
          return execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.${field}"`, {
            encoding: "utf8",
          }).trim();
        } catch {
          return "";
        }
      };

      expect(getMetadata("ProductName")).toBe("API App");
      expect(getMetadata("CompanyName")).toBe("API Company");
      expect(getMetadata("FileDescription")).toBe("Built with Bun.build API");
      expect(getMetadata("LegalCopyright")).toBe("© 2024 API Company");
      expect(getMetadata("ProductVersion")).toBe("3.0.0.0");
    });

    test("partial metadata via Bun.build()", async () => {
      using dir = tempDir("windows-metadata-api-partial", {
        "app.js": `console.log("Partial API test");`,
      });

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        outdir: String(dir),
        compile: {
          target: process.arch === "arm64" ? "bun-windows-aarch64" : "bun-windows-x64",
          outfile: "partial-api.exe",
          windows: {
            title: "Partial App",
            version: "1.0.0.0",
          },
        },
      });

      expect(result.success).toBe(true);

      const outfile = result.outputs[0].path;
      await using _cleanup = cleanup(outfile);

      const getMetadata = (field: string) => {
        try {
          return execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.${field}"`, {
            encoding: "utf8",
          }).trim();
        } catch {
          return "";
        }
      };

      expect(getMetadata("ProductName")).toBe("Partial App");
      expect(getMetadata("ProductVersion")).toBe("1.0.0.0");
    });

    test("relative outdir with compile", async () => {
      using dir = tempDir("windows-relative-outdir", {
        "app.js": `console.log("Relative outdir test");`,
      });

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        outdir: "./out",
        compile: {
          target: process.arch === "arm64" ? "bun-windows-aarch64" : "bun-windows-x64",
          outfile: "relative.exe",
          windows: {
            title: "Relative Path App",
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.outputs.length).toBe(1);

      // Should not crash with assertion error
      const exists = await Bun.file(result.outputs[0].path).exists();
      expect(exists).toBe(true);
    });
  });

  describe("Version string formats", () => {
    const testVersionFormats = [
      { input: "1", expected: "1.0.0.0" },
      { input: "1.2", expected: "1.2.0.0" },
      { input: "1.2.3", expected: "1.2.3.0" },
      { input: "1.2.3.4", expected: "1.2.3.4" },
      { input: "10.20.30.40", expected: "10.20.30.40" },
      { input: "999.999.999.999", expected: "999.999.999.999" },
    ];

    test.each(testVersionFormats)("version format: $input", async ({ input, expected }) => {
      using dir = tempDir(`windows-version-${input.replace(/\./g, "-")}`, {
        "app.js": `console.log("Version test");`,
      });

      const outfile = join(String(dir), "version-test.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-version",
          input,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      const version = execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.ProductVersion"`, {
        encoding: "utf8",
      }).trim();

      expect(version).toBe(expected);
    });

    test.each([
      { version: "not.a.version" },
      { version: "1.2.3.4.5" },
      { version: "1.-2.3.4" },
      { version: "65536.0.0.0" }, // > 65535
      { version: "" },
    ])("invalid version format should error gracefully: $version", async ({ version }) => {
      using dir = tempDir("windows-invalid-version", {
        "app.js": `console.log("Invalid version test");`,
      });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          join(String(dir), "test.exe"),
          "--windows-version",
          version,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).not.toBe(0);
    });
  });

  describe("Original Filename removal", () => {
    test("Original Filename field should be empty", async () => {
      using dir = tempDir("windows-original-filename", {
        "app.js": `console.log("Original filename test");`,
      });

      const outfile = join(String(dir), "test-original.exe");
      await using _cleanup = cleanup(outfile);

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          "Test Application",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      // Check that Original Filename is empty (not "bun.exe")
      const getMetadata = (field: string) => {
        try {
          return execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.${field}"`, {
            encoding: "utf8",
          }).trim();
        } catch {
          return "";
        }
      };

      const originalFilename = getMetadata("OriginalFilename");
      expect(originalFilename).toBe("");
      expect(originalFilename).not.toBe("bun.exe");
    });

    test("Original Filename should be empty even with all metadata set", async () => {
      using dir = tempDir("windows-original-filename-full", {
        "app.js": `console.log("Full metadata test");`,
      });

      const outfile = join(String(dir), "full-metadata.exe");
      await using _cleanup = cleanup(outfile);

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          "Complete App",
          "--windows-publisher",
          "Test Publisher",
          "--windows-version",
          "5.4.3.2",
          "--windows-description",
          "Application with full metadata",
          "--windows-copyright",
          "© 2024 Test",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      const getMetadata = (field: string) => {
        try {
          return execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.${field}"`, {
            encoding: "utf8",
          }).trim();
        } catch {
          return "";
        }
      };

      // Verify all custom metadata is set correctly
      expect(getMetadata("ProductName")).toBe("Complete App");
      expect(getMetadata("CompanyName")).toBe("Test Publisher");
      expect(getMetadata("FileDescription")).toBe("Application with full metadata");
      expect(getMetadata("ProductVersion")).toBe("5.4.3.2");

      // But Original Filename should still be empty
      const originalFilename = getMetadata("OriginalFilename");
      expect(originalFilename).toBe("");
      expect(originalFilename).not.toBe("bun.exe");
    });
  });

  describe("Edge cases", () => {
    test("long strings in metadata", async () => {
      using dir = tempDir("windows-long-strings", {
        "app.js": `console.log("Long strings test");`,
      });

      const longString = Buffer.alloc(255, "A").toString();
      const outfile = join(String(dir), "long-strings.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          longString,
          "--windows-description",
          longString,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);
    });

    test("special characters in metadata", async () => {
      using dir = tempDir("windows-special-chars", {
        "app.js": `console.log("Special chars test");`,
      });

      const outfile = join(String(dir), "special-chars.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          "App™ with® Special© Characters",
          "--windows-publisher",
          "Company & Co.",
          "--windows-description",
          "Test \"quotes\" and 'apostrophes'",
          "--windows-copyright",
          "© 2024 <Company>",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);

      const getMetadata = (field: string) => {
        try {
          return execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.${field}"`, {
            encoding: "utf8",
          }).trim();
        } catch {
          return "";
        }
      };

      expect(getMetadata("ProductName")).toContain("App");
      expect(getMetadata("CompanyName")).toContain("Company & Co.");
    });

    test("unicode in metadata", async () => {
      using dir = tempDir("windows-unicode", {
        "app.js": `console.log("Unicode test");`,
      });

      const outfile = join(String(dir), "unicode.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          "アプリケーション",
          "--windows-publisher",
          "会社名",
          "--windows-description",
          "Émoji test 🚀 🎉",
          "--windows-copyright",
          "© 2024 世界",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);
    });

    test("empty strings in metadata", async () => {
      using dir = tempDir("windows-empty-strings", {
        "app.js": `console.log("Empty strings test");`,
      });

      const outfile = join(String(dir), "empty.exe");
      await using _cleanup = cleanup(outfile);

      // Empty strings should be treated as not provided
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          "",
          "--windows-description",
          "",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);
    });
  });

  describe("Combined with other compile options", () => {
    test("metadata with --windows-hide-console", async () => {
      using dir = tempDir("windows-metadata-hide-console", {
        "app.js": `console.log("Hidden console test");`,
      });

      const outfile = join(String(dir), "hidden-with-metadata.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-hide-console",
          "--windows-title",
          "Hidden Console App",
          "--windows-version",
          "1.0.0.0",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);

      const getMetadata = (field: string) => {
        try {
          return execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.${field}"`, {
            encoding: "utf8",
          }).trim();
        } catch {
          return "";
        }
      };

      expect(getMetadata("ProductName")).toBe("Hidden Console App");
      expect(getMetadata("ProductVersion")).toBe("1.0.0.0");
    });

    test("metadata with --windows-icon", async () => {
      // Create a simple .ico file (minimal valid ICO header)
      const icoHeader = Buffer.from([
        0x00,
        0x00, // Reserved
        0x01,
        0x00, // Type (1 = ICO)
        0x01,
        0x00, // Count (1 image)
        0x10, // Width (16)
        0x10, // Height (16)
        0x00, // Color count
        0x00, // Reserved
        0x01,
        0x00, // Color planes
        0x20,
        0x00, // Bits per pixel
        0x68,
        0x01,
        0x00,
        0x00, // Size
        0x16,
        0x00,
        0x00,
        0x00, // Offset
      ]);

      using dir = tempDir("windows-metadata-icon", {
        "app.js": `console.log("Icon test");`,
        "icon.ico": icoHeader,
      });

      const outfile = join(String(dir), "icon-with-metadata.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-icon",
          join(String(dir), "icon.ico"),
          "--windows-title",
          "App with Icon",
          "--windows-version",
          "2.0.0.0",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Icon might fail but metadata should still work
      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);

      const getMetadata = (field: string) => {
        try {
          return execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.${field}"`, {
            encoding: "utf8",
          }).trim();
        } catch {
          return "";
        }
      };

      expect(getMetadata("ProductName")).toBe("App with Icon");
      expect(getMetadata("ProductVersion")).toBe("2.0.0.0");
    });
  });
});

// The PE OptionalHeader.CheckSum field is defined as `fold16(word_sum) + file_length`
// (the same algorithm Windows' MapFileAndCheckSum uses). An earlier implementation
// folded again after adding the file length, truncating the 32-bit result to ~17 bits,
// so every `bun build --compile --target=bun-windows-*` output carried a checksum that
// tools like MapFileAndCheckSum / dumpbin reported as invalid. Windows only enforces
// this field for drivers, so the executables still ran, but PE validators flagged them.
//
// This test crafts a minimal PE64 template (large enough that the correct checksum
// exceeds 0xffff) and cross-compiles via `--compile-executable-path`, so it runs on
// every platform without downloading a real bun.exe.
test("bun build --compile writes a valid PE OptionalHeader.CheckSum", async () => {
  const fileAlign = 512;
  const sectAlign = 4096;
  const peOff = 64;
  const optOff = peOff + 24;
  const optSize = 240;
  const shOff = optOff + optSize;
  const textRaw = 512;
  // Big enough that fold16(word_sum) + file_length > 0xffff; with a tiny template
  // the correct checksum happens to fit in 16 bits and the bug is invisible.
  const textRawSize = 128 * 1024;
  const textVA = sectAlign;

  const tmpl = Buffer.alloc(textRaw + textRawSize);
  // DOS header
  tmpl.writeUInt16LE(0x5a4d, 0); // "MZ"
  tmpl.writeUInt32LE(peOff, 0x3c); // e_lfanew
  // COFF header
  tmpl.writeUInt32LE(0x00004550, peOff); // "PE\0\0"
  tmpl.writeUInt16LE(0x8664, peOff + 4); // machine = AMD64
  tmpl.writeUInt16LE(1, peOff + 6); // NumberOfSections
  tmpl.writeUInt16LE(optSize, peOff + 20); // SizeOfOptionalHeader
  tmpl.writeUInt16LE(0x0022, peOff + 22); // Characteristics
  // Optional header (PE32+)
  tmpl.writeUInt16LE(0x020b, optOff); // Magic
  tmpl.writeUInt32LE(textVA, optOff + 16); // AddressOfEntryPoint
  tmpl.writeUInt32LE(textVA, optOff + 20); // BaseOfCode
  tmpl.writeBigUInt64LE(0x140000000n, optOff + 24); // ImageBase
  tmpl.writeUInt32LE(sectAlign, optOff + 32); // SectionAlignment
  tmpl.writeUInt32LE(fileAlign, optOff + 36); // FileAlignment
  tmpl.writeUInt16LE(6, optOff + 40); // MajorOSVersion
  tmpl.writeUInt16LE(6, optOff + 48); // MajorSubsystemVersion
  tmpl.writeUInt32LE(textVA + sectAlign, optOff + 56); // SizeOfImage
  tmpl.writeUInt32LE(512, optOff + 60); // SizeOfHeaders
  tmpl.writeUInt16LE(3, optOff + 68); // Subsystem = CUI
  tmpl.writeUInt32LE(16, optOff + 108); // NumberOfRvaAndSizes
  // Section header: .text
  tmpl.write(".text\0\0\0", shOff, 8, "latin1");
  tmpl.writeUInt32LE(textRawSize, shOff + 8); // VirtualSize
  tmpl.writeUInt32LE(textVA, shOff + 12); // VirtualAddress
  tmpl.writeUInt32LE(textRawSize, shOff + 16); // SizeOfRawData
  tmpl.writeUInt32LE(textRaw, shOff + 20); // PointerToRawData
  tmpl.writeUInt32LE(0x60000020, shOff + 36); // Characteristics
  tmpl.fill(0xcc, textRaw); // .text body

  using dir = tempDir("pe-checksum", {
    "entry.js": `console.log("hi");`,
  });
  const cwd = String(dir);
  const tmplPath = join(cwd, "template.exe");
  const outPath = join(cwd, "out.exe");
  await Bun.write(tmplPath, tmpl);

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--target=bun-windows-x64",
      "--compile-executable-path",
      tmplPath,
      join(cwd, "entry.js"),
      "--outfile",
      outPath,
    ],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  const out = Buffer.from(await Bun.file(outPath).arrayBuffer());
  const outPeOff = out.readUInt32LE(0x3c);
  const ckOff = outPeOff + 24 + 64;
  const stored = out.readUInt32LE(ckOff);

  // Recompute the reference checksum over the output with the CheckSum field zeroed.
  const copy = Buffer.from(out);
  copy.writeUInt32LE(0, ckOff);
  let sum = 0;
  for (let i = 0; i + 1 < copy.length; i += 2) {
    sum += copy[i] | (copy[i + 1] << 8);
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  if (copy.length & 1) sum += copy[copy.length - 1];
  sum = (sum & 0xffff) + (sum >>> 16);
  sum = (sum & 0xffff) + (sum >>> 16);
  const expected = (sum + copy.length) >>> 0;

  // The correct checksum for a >64KB image cannot fit in 16 bits; the broken
  // implementation always produced a value <= 0x1fffe. Assert both the exact
  // match and that the test template is large enough to distinguish the two.
  expect(expected).toBeGreaterThan(0xffff);
  expect(stored).toBe(expected);
});
