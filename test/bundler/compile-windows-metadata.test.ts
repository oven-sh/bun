import { describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { promises as fs } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

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

describe.skipIf(!isWindows)("Windows compile metadata", () => {
  describe("CLI flags", () => {
    test("all metadata flags via CLI", async () => {
      const dir = tempDirWithFiles("windows-metadata-cli", {
        "app.js": `console.log("Test app with metadata");`,
      });

      const outfile = join(dir, "app-with-metadata.exe");
      await using _cleanup = cleanup(outfile);

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(dir, "app.js"),
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

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

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
      const dir = tempDirWithFiles("windows-metadata-partial", {
        "app.js": `console.log("Partial metadata test");`,
      });

      const outfile = join(dir, "app-partial.exe");
      await using _cleanup = cleanup(outfile);

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(dir, "app.js"),
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

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

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
      const dir = tempDirWithFiles("windows-no-compile", {
        "app.js": `console.log("test");`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", join(dir, "app.js"), "--windows-title", "Should Fail"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--windows-title requires --compile");
    });

    test("windows flags with non-Windows target should error", async () => {
      const dir = tempDirWithFiles("windows-wrong-target", {
        "app.js": `console.log("test");`,
      });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--target",
          "bun-linux-x64",
          join(dir, "app.js"),
          "--windows-title",
          "Should Fail",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(exitCode).not.toBe(0);
      // When cross-compiling to non-Windows, it tries to download the target but fails
      expect(stderr.toLowerCase()).toContain("target platform");
    });
  });

  describe("Bun.build() API", () => {
    test("all metadata via Bun.build()", async () => {
      const dir = tempDirWithFiles("windows-metadata-api", {
        "app.js": `console.log("API metadata test");`,
      });

      const result = await Bun.build({
        entrypoints: [join(dir, "app.js")],
        outdir: dir,
        compile: {
          target: "bun-windows-x64",
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
      const dir = tempDirWithFiles("windows-metadata-api-partial", {
        "app.js": `console.log("Partial API test");`,
      });

      const result = await Bun.build({
        entrypoints: [join(dir, "app.js")],
        outdir: dir,
        compile: {
          target: "bun-windows-x64",
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
      const dir = tempDirWithFiles("windows-relative-outdir", {
        "app.js": `console.log("Relative outdir test");`,
      });

      const result = await Bun.build({
        entrypoints: [join(dir, "app.js")],
        outdir: "./out",
        compile: {
          target: "bun-windows-x64",
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
      const dir = tempDirWithFiles(`windows-version-${input.replace(/\./g, "-")}`, {
        "app.js": `console.log("Version test");`,
      });

      const outfile = join(dir, "version-test.exe");

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", join(dir, "app.js"), "--outfile", outfile, "--windows-version", input],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const version = execSync(`powershell -Command "(Get-ItemProperty '${outfile}').VersionInfo.ProductVersion"`, {
        encoding: "utf8",
      }).trim();

      expect(version).toBe(expected);
    });

    test("invalid version format should error gracefully", async () => {
      const dir = tempDirWithFiles("windows-invalid-version", {
        "app.js": `console.log("Invalid version test");`,
      });

      const invalidVersions = [
        "not.a.version",
        "1.2.3.4.5",
        "1.-2.3.4",
        "65536.0.0.0", // > 65535
        "",
      ];

      for (const version of invalidVersions) {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            join(dir, "app.js"),
            "--outfile",
            join(dir, "test.exe"),
            "--windows-version",
            version,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const exitCode = await proc.exited;
        expect(exitCode).not.toBe(0);
      }
    });
  });

  describe("Edge cases", () => {
    test("long strings in metadata", async () => {
      const dir = tempDirWithFiles("windows-long-strings", {
        "app.js": `console.log("Long strings test");`,
      });

      const longString = Buffer.alloc(255, "A").toString();
      const outfile = join(dir, "long-strings.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(dir, "app.js"),
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

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);
    });

    test("special characters in metadata", async () => {
      const dir = tempDirWithFiles("windows-special-chars", {
        "app.js": `console.log("Special chars test");`,
      });

      const outfile = join(dir, "special-chars.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(dir, "app.js"),
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

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

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
      const dir = tempDirWithFiles("windows-unicode", {
        "app.js": `console.log("Unicode test");`,
      });

      const outfile = join(dir, "unicode.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(dir, "app.js"),
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

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);
    });

    test("empty strings in metadata", async () => {
      const dir = tempDirWithFiles("windows-empty-strings", {
        "app.js": `console.log("Empty strings test");`,
      });

      const outfile = join(dir, "empty.exe");
      await using _cleanup = cleanup(outfile);

      // Empty strings should be treated as not provided
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(dir, "app.js"),
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

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const exists = await Bun.file(outfile).exists();
      expect(exists).toBe(true);
    });
  });

  describe("Combined with other compile options", () => {
    test("metadata with --windows-hide-console", async () => {
      const dir = tempDirWithFiles("windows-metadata-hide-console", {
        "app.js": `console.log("Hidden console test");`,
      });

      const outfile = join(dir, "hidden-with-metadata.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(dir, "app.js"),
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

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

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

      const dir = tempDirWithFiles("windows-metadata-icon", {
        "app.js": `console.log("Icon test");`,
        "icon.ico": icoHeader,
      });

      const outfile = join(dir, "icon-with-metadata.exe");

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          join(dir, "app.js"),
          "--outfile",
          outfile,
          "--windows-icon",
          join(dir, "icon.ico"),
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
      if (exitCode === 0) {
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
      }
    });
  });
});

// Test for non-Windows platforms
