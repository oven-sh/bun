import { describe, expect, test } from "bun:test";
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

// Read all VersionInfo fields in a single PowerShell invocation (spawning
// powershell is ~0.5-1s on CI). Forcing [Console]::OutputEncoding makes the
// read independent of the per-console output code page, which another process
// on the same console can flip off UTF-8.
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
      `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ` +
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

const windowsTarget = process.arch === "arm64" ? "bun-windows-aarch64" : "bun-windows-x64";

// Most tests only assert on PE header bytes and VersionInfo, not runtime
// behaviour, so they compile against a ~128 KiB minimal PE instead of cloning
// the full debug bun.exe. A handful of tests below deliberately omit
// `--compile-executable-path` to keep real-bun coverage: that the output runs,
// that rescle merges into bun.exe's existing .rsrc (not just creates one), and
// that it clears bun.exe's baked-in OriginalFilename.
//
// Every template-backed test also sets --windows-version: .NET's
// `FileVersionInfo.GetVersionInfoForCodePage` returns "found" only when the
// FileVersion *string* is non-empty, and on a miss it retries fallback code
// pages which overwrite every field with "". The template has no pre-existing
// FileVersion (unlike bun.exe), so without one the PowerShell readback would
// be blank even though `VerQueryValue` can read the resource rescle wrote.
async function writeTemplate(dir: string): Promise<string> {
  const tmplPath = join(dir, "template.exe");
  await Bun.write(tmplPath, minimalPE64Template());
  return tmplPath;
}

// https://github.com/oven-sh/bun/issues/19916
describe.skipIf(!isWindows).concurrent("--windows-hide-console", () => {
  // The default-target console-subsystem baseline is asserted inside
  // "Windows compile metadata > CLI flags > all metadata flags via CLI" to
  // avoid a redundant full --compile.

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
        target: windowsTarget,
        outfile: "gui-api.exe",
        windows: { hideConsole: true, title: "GUI API App" },
      },
    });
    expect(result.success).toBe(true);

    const outfile = result.outputs[0].path;
    await using _cleanup = cleanup(outfile);
    expect(await readPESubsystem(outfile)).toBe(IMAGE_SUBSYSTEM_WINDOWS_GUI);
    // rescle ran against the real bun.exe (no executablePath here): its
    // existing .rsrc must merge cleanly, OriginalFilename must be cleared,
    // and the GUI subsystem patch above must survive the resource rewrite.
    // FileVersion was not passed, so bun.exe's own FileVersion must remain.
    const info = await readVersionInfo(outfile);
    expect(info).toMatchObject({ ProductName: "GUI API App", OriginalFilename: "" });
    expect(info.FileVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  // The "GUI subsystem survives the rescle metadata pass" case is asserted
  // inside "Combined > metadata with --windows-hide-console" below, which
  // builds the same flag combination and checks both Subsystem and VersionInfo.
});

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

      // No --windows-hide-console here, so the default build must stay a
      // console (CUI) subsystem even after the rescle metadata pass.
      expect(await readPESubsystem(outfile)).toBe(IMAGE_SUBSYSTEM_WINDOWS_CUI);

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
      const tmpl = await writeTemplate(String(dir));

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--compile-executable-path",
          tmpl,
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          "Simple App",
          "--windows-version",
          "10.20.30.40",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      // Version input "10.20.30.40" (multi-digit 4-part) round-trips unchanged.
      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "Simple App",
        ProductVersion: "10.20.30.40",
        FileVersion: "10.20.30.40",
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
      const tmpl = await writeTemplate(String(dir));

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        outdir: String(dir),
        compile: {
          target: windowsTarget,
          outfile: "app-api.exe",
          executablePath: tmpl,
          windows: {
            title: "API App",
            publisher: "API Company",
            version: "65535.65535.65535.65535",
            description: "Built with Bun.build API",
            copyright: "© 2024 API Company",
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.outputs.length).toBe(1);

      const outfile = result.outputs[0].path;
      // Version "65535.65535.65535.65535" (u16 max per part) round-trips; pairs
      // with the invalid "65536.0.0.0" case below as the valid-side fence post.
      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "API App",
        CompanyName: "API Company",
        FileDescription: "Built with Bun.build API",
        LegalCopyright: "© 2024 API Company",
        ProductVersion: "65535.65535.65535.65535",
        FileVersion: "65535.65535.65535.65535",
        OriginalFilename: "",
      });
    });

    test("partial metadata via Bun.build()", async () => {
      using dir = tempDir("windows-metadata-api-partial", {
        "app.js": `console.log("Partial API test");`,
      });
      const tmpl = await writeTemplate(String(dir));

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        outdir: String(dir),
        compile: {
          target: windowsTarget,
          outfile: "partial-api.exe",
          executablePath: tmpl,
          windows: {
            title: "Partial App",
            version: "1.2",
          },
        },
      });

      expect(result.success).toBe(true);

      const outfile = result.outputs[0].path;
      // Version input "1.2" (2-part) is zero-padded to 4 parts.
      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "Partial App",
        ProductVersion: "1.2.0.0",
        FileVersion: "1.2.0.0",
        OriginalFilename: "",
      });
    });

    test("relative outdir with compile", async () => {
      using dir = tempDir("windows-relative-outdir", {
        "app.js": `console.log("Relative outdir test");`,
      });
      const tmpl = await writeTemplate(String(dir));

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        outdir: "./out",
        compile: {
          target: windowsTarget,
          outfile: "relative.exe",
          executablePath: tmpl,
          windows: {
            title: "Relative Path App",
            version: "5.0.0.0",
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.outputs.length).toBe(1);

      const outfile = result.outputs[0].path;
      await using _cleanup = cleanup(outfile);
      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "Relative Path App",
        FileVersion: "5.0.0.0",
        OriginalFilename: "",
      });
    });
  });

  describe("Version string formats", () => {
    // The normalization of each accepted arity is asserted on the binaries the
    // surrounding tests already build, so only the "--windows-version with no
    // other metadata" path needs its own compile here:
    //   1           -> 1.0.0.0          (this test)
    //   1.2         -> 1.2.0.0          (Bun.build API > partial metadata)
    //   1.2.3       -> 1.2.3.0          (Combined > metadata with --windows-hide-console)
    //   1.2.3.4     -> 1.2.3.4          (CLI flags > all metadata flags via CLI)
    //   10.20.30.40 -> 10.20.30.40      (CLI flags > partial metadata flags)
    //   65535.65535.65535.65535 -> same (Bun.build API > all metadata; u16 max)
    test("--windows-version alone zero-pads to four parts", async () => {
      using dir = tempDir("windows-version-alone", {
        "app.js": `console.log("Version test");`,
      });

      const outfile = join(String(dir), "version-test.exe");
      const tmpl = await writeTemplate(String(dir));

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--compile-executable-path",
          tmpl,
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-version",
          "1",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductVersion: "1.0.0.0",
        FileVersion: "1.0.0.0",
        OriginalFilename: "",
      });
    });

    test.each([
      { version: "not.a.version" },
      { version: "1.2.3.4.5" },
      { version: "1.-2.3.4" },
      { version: "65536.0.0.0" }, // > 65535
      { version: "" },
    ])("invalid version format should error gracefully: $version", async ({ version }) => {
      // InvalidVersionFormat is raised by the Rust-side validator *before* the
      // rescle C++ bindings touch the output, so we can compile against a
      // ~128 KiB minimal PE template instead of cloning the full debug bun.exe.
      using dir = tempDir("windows-invalid-version", {
        "app.js": `console.log("Invalid version test");`,
      });
      const tmpl = await writeTemplate(String(dir));

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--compile-executable-path",
          tmpl,
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
      const tmpl = await writeTemplate(String(dir));

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--compile-executable-path",
          tmpl,
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          longString,
          "--windows-description",
          longString,
          "--windows-version",
          "3.0.0.0",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: longString,
        FileDescription: longString,
        FileVersion: "3.0.0.0",
      });
    });

    // Every --windows-* string field flows through the same
    // `to_utf16_alloc_for_real` -> rescle `SetVersionString` wide-string path,
    // so a single build that mixes Latin-1 symbols, ASCII punctuation, BMP CJK
    // and surrogate-pair emoji round-tripping across the four fields covers the
    // same encoding surface as two separate compiles would.
    test("unicode and special characters in metadata", async () => {
      using dir = tempDir("windows-unicode-special", {
        "app.js": `console.log("Unicode + special chars test");`,
      });

      const outfile = join(String(dir), "unicode-special.exe");
      const tmpl = await writeTemplate(String(dir));

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "--compile-executable-path",
          tmpl,
          join(String(dir), "app.js"),
          "--outfile",
          outfile,
          "--windows-title",
          "App™ with® Special© アプリケーション",
          "--windows-publisher",
          "Company & Co. 会社名",
          "--windows-description",
          "Test \"quotes\" and 'apostrophes' 🚀 🎉",
          "--windows-copyright",
          "© 2024 <Company> 世界",
          "--windows-version",
          "4.0.0.0",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "App™ with® Special© アプリケーション",
        CompanyName: "Company & Co. 会社名",
        FileDescription: "Test \"quotes\" and 'apostrophes' 🚀 🎉",
        LegalCopyright: "© 2024 <Company> 世界",
        FileVersion: "4.0.0.0",
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

      // rescle-binding.cpp skips empty title/description but still clears
      // OriginalFilename unconditionally, so asserting on it proves the
      // metadata pass ran (and that the output is a readable PE). No
      // --windows-version was passed on the CLI path either, so bun.exe's own
      // FileVersion must be preserved.
      const info = await readVersionInfo(outfile);
      expect(info).toMatchObject({ OriginalFilename: "" });
      expect(info.FileVersion).toMatch(/^\d+\.\d+\.\d+/);
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
          "1.2.3",
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await expectBuildOk(proc);

      // rescle must not undo the GUI subsystem patch inject() applied.
      expect(await readPESubsystem(outfile)).toBe(IMAGE_SUBSYSTEM_WINDOWS_GUI);
      // Version input "1.2.3" (3-part) is zero-padded to 4 parts.
      expect(await readVersionInfo(outfile)).toMatchObject({
        ProductName: "Hidden Console App",
        ProductVersion: "1.2.3.0",
        FileVersion: "1.2.3.0",
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

      // Stays on real bun.exe: rescle's SetIcon() picks the langId/bundleId
      // from the existing RT_GROUP_ICON/RT_ICON resources when present (bun.exe
      // ships one via windows-app-info.rc), and Commit()'s icon loop overwrites
      // those ids. The template has no .rsrc, so it would only exercise the
      // empty-map defaults.
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

// Build a minimal PE32+ image with one .text section and an optional Authenticode
// overlay past it. Large enough that the correct CheckSum exceeds 0xffff.
function minimalPE64Template(certSize = 0): Buffer {
  const fileAlign = 512;
  const sectAlign = 4096;
  const peOff = 64;
  const optOff = peOff + 24;
  const optSize = 240;
  const shOff = optOff + optSize;
  const textRaw = 512;
  const textRawSize = 128 * 1024;
  const textVA = sectAlign;
  const lastRawEnd = textRaw + textRawSize;

  const tmpl = Buffer.alloc(lastRawEnd + certSize);
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
  if (certSize > 0) {
    // Security directory (index 4): VirtualAddress is a file offset for this entry.
    const secDir = optOff + 112 + 4 * 8;
    tmpl.writeUInt32LE(lastRawEnd, secDir);
    tmpl.writeUInt32LE(certSize, secDir + 4);
  }
  // Section header: .text
  tmpl.write(".text\0\0\0", shOff, 8, "latin1");
  tmpl.writeUInt32LE(textRawSize, shOff + 8); // VirtualSize
  tmpl.writeUInt32LE(textVA, shOff + 12); // VirtualAddress
  tmpl.writeUInt32LE(textRawSize, shOff + 16); // SizeOfRawData
  tmpl.writeUInt32LE(textRaw, shOff + 20); // PointerToRawData
  tmpl.writeUInt32LE(0x60000020, shOff + 36); // Characteristics
  tmpl.fill(0xcc, textRaw, lastRawEnd); // .text body
  if (certSize > 0) tmpl.fill(0xab, lastRawEnd); // cert overlay marker
  return tmpl;
}

// Recompute the reference PE CheckSum over `bytes` with the CheckSum field zeroed.
function peChecksum(bytes: Buffer): { stored: number; expected: number } {
  const peOff = bytes.readUInt32LE(0x3c);
  const ckOff = peOff + 24 + 64;
  const stored = bytes.readUInt32LE(ckOff);
  const copy = Buffer.from(bytes);
  copy.writeUInt32LE(0, ckOff);
  let sum = 0;
  for (let i = 0; i + 1 < copy.length; i += 2) {
    sum += copy[i] | (copy[i + 1] << 8);
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  if (copy.length & 1) sum += copy[copy.length - 1];
  sum = (sum & 0xffff) + (sum >>> 16);
  sum = (sum & 0xffff) + (sum >>> 16);
  return { stored, expected: (sum + copy.length) >>> 0 };
}

function lastSectionEnd(bytes: Buffer): number {
  const peOff = bytes.readUInt32LE(0x3c);
  const nSect = bytes.readUInt16LE(peOff + 6);
  const shOff = peOff + 24 + bytes.readUInt16LE(peOff + 20);
  let end = 0;
  for (let i = 0; i < nSect; i++) {
    const o = shOff + i * 40;
    const rawEnd = bytes.readUInt32LE(o + 20) + bytes.readUInt32LE(o + 16);
    if (rawEnd > end) end = rawEnd;
  }
  return end;
}

async function compileWindowsTemplate(dir: string, tmpl: Buffer): Promise<Buffer> {
  const tmplPath = join(dir, "template.exe");
  const outPath = join(dir, "out.exe");
  await Bun.write(tmplPath, tmpl);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--target=bun-windows-x64",
      "--compile-executable-path",
      tmplPath,
      join(dir, "entry.js"),
      "--outfile",
      outPath,
    ],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await expectBuildOk(proc);
  return Buffer.from(await Bun.file(outPath).arrayBuffer());
}

// The PE OptionalHeader.CheckSum field is defined as `fold16(word_sum) + file_length`
// (the same algorithm Windows' MapFileAndCheckSum uses).
//
// These tests craft a minimal PE64 template and cross-compile via
// `--compile-executable-path`, so they run on every platform without downloading
// a real bun.exe.
test.concurrent("bun build --compile writes a valid PE OptionalHeader.CheckSum", async () => {
  using dir = tempDir("pe-checksum", { "entry.js": `console.log("hi");` });
  const out = await compileWindowsTemplate(String(dir), minimalPE64Template());
  const { stored, expected } = peChecksum(out);
  // Guard against the template shrinking to where the checksum fits in 16 bits
  // and the assertion below becomes vacuous.
  expect(expected).toBeGreaterThan(0xffff);
  expect(stored).toBe(expected);
});

test.concurrent("bun build --compile truncates the PE output when Authenticode strip shrinks it", async () => {
  // 16 KiB cert overlay: larger than the .bun section a trivial entry produces, so
  // strip_authenticode makes the in-memory PE shorter than the cloned base file.
  const certSize = 16 * 1024;
  const tmpl = minimalPE64Template(certSize);
  using dir = tempDir("pe-truncate", { "entry.js": `console.log("hi");` });
  const out = await compileWindowsTemplate(String(dir), tmpl);

  const lastEnd = lastSectionEnd(out);
  expect({ fileSize: out.length, lastEnd }).toEqual({ fileSize: lastEnd, lastEnd });
  expect(out.length).toBeLessThan(tmpl.length);

  const { stored, expected } = peChecksum(out);
  expect(stored).toBe(expected);
});
