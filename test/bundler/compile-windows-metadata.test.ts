import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Drain stdout/stderr and assert the build succeeded. Asserting on the combined
// object means a flake shows the real stderr instead of just "Expected: 0, Received: 1".
async function expectBuildOk(proc: Bun.Subprocess<"ignore", "pipe", "pipe">) {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return { stdout, stderr, exitCode };
}

// Read all VersionInfo fields in a single PowerShell invocation (spawning
// powershell is ~0.5-1s on CI). `-NoProfile` avoids loading profile scripts.
async function readVersionInfo(outfile: string) {
  const fields = [
    "ProductName",
    "CompanyName",
    "FileDescription",
    "LegalCopyright",
    "ProductVersion",
    "FileVersion",
    "OriginalFilename",
  ];
  await using proc = Bun.spawn({
    cmd: [
      "powershell",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Item -LiteralPath '${outfile.replaceAll("'", "''")}').VersionInfo | ` +
        `Select-Object ${fields.join(",")} | ConvertTo-Json -Compress`,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const info = JSON.parse(stdout) as Record<string, string | null>;
  for (const k of fields) info[k] ??= "";
  return info as Record<string, string>;
}

describe.skipIf(!isWindows).concurrent("Windows compile metadata", () => {
  describe("CLI flags", () => {
    test("all metadata flags via CLI", async () => {
      using dir = tempDir("windows-metadata-cli", {
        "app.js": `console.log("Test app with metadata");`,
      });

      const outfile = join(String(dir), "app-with-metadata.exe");

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

      // OriginalFilename must be cleared (not "bun.exe") even with every
      // metadata field set; this is the "Original Filename removal" coverage.
      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "My Application",
        CompanyName: "Test Company Inc",
        FileDescription: "A test application with metadata",
        LegalCopyright: "Copyright © 2024 Test Company Inc",
        ProductVersion: "1.2.3.4",
        FileVersion: "1.2.3.4",
        OriginalFilename: "",
      });
    });

    test("partial metadata flags", async () => {
      using dir = tempDir("windows-metadata-partial", {
        "app.js": `console.log("Partial metadata test");`,
      });

      const outfile = join(String(dir), "app-partial.exe");

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

      // OriginalFilename must also be cleared with only a subset of flags.
      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "Simple App",
        ProductVersion: "2.0.0.0",
        FileVersion: "2.0.0.0",
        OriginalFilename: "",
      });
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

      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("--windows-title requires --compile");
      expect(exitCode).not.toBe(0);
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

      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Windows flags require a Windows compile target
      expect(stderr.toLowerCase()).toContain("windows compile target");
      expect(exitCode).not.toBe(0);
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
      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "API App",
        CompanyName: "API Company",
        FileDescription: "Built with Bun.build API",
        LegalCopyright: "© 2024 API Company",
        ProductVersion: "3.0.0.0",
        OriginalFilename: "",
      });
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
      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "Partial App",
        ProductVersion: "1.0.0.0",
      });
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

      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductVersion: expected,
        FileVersion: expected,
      });
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

      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("InvalidVersionFormat");
      expect(exitCode).not.toBe(0);
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

      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: longString,
        FileDescription: longString,
      });
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

      const info = await readVersionInfo(outfile);
      expect(info.ProductName).toContain("App");
      expect(info.CompanyName).toBe("Company & Co.");
      expect(info.LegalCopyright).toContain("<Company>");
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

      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "アプリケーション",
        CompanyName: "会社名",
      });
    });

    test("empty strings in metadata", async () => {
      using dir = tempDir("windows-empty-strings", {
        "app.js": `console.log("Empty strings test");`,
      });

      const outfile = join(String(dir), "empty.exe");

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

      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "Hidden Console App",
        ProductVersion: "1.0.0.0",
      });
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

      await expectBuildOk(proc);

      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "App with Icon",
        ProductVersion: "2.0.0.0",
      });
    });
  });
});
