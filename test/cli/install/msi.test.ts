// Validates the Windows MSI packaging sources. These run on every platform
// because the .wxs/.ps1/.c files are plain text; an actual `wix build`
// only happens on a windows-latest runner in the `msi` job of
// .github/workflows/release.yml.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const msiDir = join(repoRoot, "packages", "bun-msi");

// Tiny helpers to pick attributes out of the first matching element in the
// .wxs without pulling in an XML dependency. The source is ours and
// hand-formatted so a non-greedy attribute scan is sufficient; if the tag
// or attribute isn't there we return undefined and the calling assertion
// fails with a readable diff.
//
// Comments and CDATA are stripped first — the .wxs has prose like
// `A valueless <Property Secure="yes"> is WiX's idiom ...` inside <!-- -->
// blocks, and we don't want assertions to accidentally pass against
// commented-out markup rather than the live tree.
function stripXmlTrivia(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
}
function elements(src: string, tag: string): string[] {
  const body = stripXmlTrivia(src);
  return [...body.matchAll(new RegExp(`<${tag}\\b[^>]*?\\/?>`, "gs"))].map(m => m[0]);
}
function attr(el: string | undefined, name: string): string | undefined {
  if (!el) return undefined;
  return el.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];
}
function findBy(src: string, tag: string, key: string, value: string): string | undefined {
  return elements(src, tag).find(e => attr(e, key) === value);
}

describe("packages/bun-msi/bun.wxs", () => {
  const wxs = readFileSync(join(msiDir, "bun.wxs"), "utf8");

  test("container elements are balanced and use the WiX v4/v5 schema", () => {
    // Catch the easy-to-miss mistakes: a stray `<` from a botched edit, a
    // missing close tag. This doesn't validate against the XSD — WiX does
    // that at build time on the windows runner — but it stops
    // obviously-broken pushes from every other lane.
    const body = stripXmlTrivia(wxs);
    const opens: string[] = [];
    for (const m of body.matchAll(/<\/?([A-Za-z][\w:.-]*)\b[^>]*?(\/?)>/gs)) {
      const [raw, name, selfClose] = m;
      if (raw.startsWith("</")) {
        expect(opens.pop()).toBe(name);
      } else if (selfClose !== "/") {
        opens.push(name);
      }
    }
    expect(opens).toEqual([]);

    expect(attr(elements(wxs, "Wix")[0], "xmlns")).toBe("http://wixtoolset.org/schemas/v4/wxs");
  });

  test("is a single product with a fixed UpgradeCode", () => {
    const pkg = elements(wxs, "Package")[0];
    expect({
      Name: attr(pkg, "Name"),
      Manufacturer: attr(pkg, "Manufacturer"),
      Scope: attr(pkg, "Scope"),
      Version: attr(pkg, "Version"),
      Compressed: attr(pkg, "Compressed"),
    }).toEqual({
      Name: "Bun",
      Manufacturer: "Oven",
      Scope: "perMachine",
      Version: "$(BunVersion)",
      Compressed: "yes",
    });
    // One literal UpgradeCode — the three variants are one product family
    // installing to one path. See the header comment in bun.wxs for why
    // per-variant codes would violate the Windows Installer component rule.
    expect(attr(pkg, "UpgradeCode")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(stripXmlTrivia(wxs)).not.toMatch(/<\?if\b/); // no preprocessor branching left

    const mu = elements(wxs, "MajorUpgrade")[0];
    expect(attr(mu, "AllowSameVersionUpgrades")).toBe("yes");
  });

  test("ships three mutually-exclusive bun.exe payloads keyed on BUNVARIANT", () => {
    const comps = elements(wxs, "Component").filter(c => (attr(c, "Id") ?? "").startsWith("BunExe_"));
    const rows = comps
      .map(c => ({
        id: attr(c, "Id"),
        condition: attr(c, "Condition"),
        guid: attr(c, "Guid"),
      }))
      .sort((a, b) => a.id!.localeCompare(b.id!));
    expect(rows).toEqual([
      {
        id: "BunExe_arm64",
        condition: "BUNVARIANT = &quot;arm64&quot;",
        guid: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      },
      { id: "BunExe_x64", condition: "BUNVARIANT = &quot;x64&quot;", guid: expect.stringMatching(/^[0-9a-f-]{36}$/i) },
      {
        id: "BunExe_x64_baseline",
        condition: "BUNVARIANT = &quot;x64-baseline&quot;",
        guid: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      },
    ]);
    // Distinct component GUIDs (same KeyPath but mutually exclusive, so
    // only one is ever installed — the rule is one GUID per *installed*
    // KeyPath, and these conditions guarantee that).
    expect(new Set(rows.map(r => r.guid)).size).toBe(3);

    // Each variant's File targets bun.exe and sources the matching var.
    const files = elements(wxs, "File").map(f => ({
      id: attr(f, "Id"),
      name: attr(f, "Name"),
      src: attr(f, "Source"),
    }));
    expect(files.sort((a, b) => a.id!.localeCompare(b.id!))).toEqual([
      { id: "BunExe_arm64", name: "bun.exe", src: "$(BunExeArm64)" },
      { id: "BunExe_x64", name: "bun.exe", src: "$(BunExeX64)" },
      { id: "BunExe_x64_baseline", name: "bun.exe", src: "$(BunExeX64Baseline)" },
    ]);

    // bunx.exe is produced via DuplicateFile (CopyFile/@FileId) so each
    // variant contributes one payload, not two.
    const copies = elements(wxs, "CopyFile").map(c => ({
      fileId: attr(c, "FileId"),
      dest: attr(c, "DestinationName"),
    }));
    expect(copies.sort((a, b) => a.fileId!.localeCompare(b.fileId!))).toEqual([
      { fileId: "BunExe_arm64", dest: "bunx.exe" },
      { fileId: "BunExe_x64", dest: "bunx.exe" },
      { fileId: "BunExe_x64_baseline", dest: "bunx.exe" },
    ]);
  });

  test("wires the DetectCpu DLL CA before CostFinalize with an override guard", () => {
    const bin = findBy(wxs, "Binary", "Id", "DetectCpuDll");
    expect(attr(bin, "SourceFile")).toBe("$(DetectCpuDll)");

    const ca = findBy(wxs, "CustomAction", "Id", "DetectCpu");
    expect({
      BinaryRef: attr(ca, "BinaryRef"),
      DllEntry: attr(ca, "DllEntry"),
      Execute: attr(ca, "Execute"),
    }).toEqual({ BinaryRef: "DetectCpuDll", DllEntry: "DetectCpu", Execute: "immediate" });

    // Sequenced in both UI and Execute, after AppSearch (so a remembered
    // registry value wins) and guarded on NOT BUNVARIANT so an explicit
    // `msiexec ... BUNVARIANT=x64-baseline` skips detection entirely.
    const customs = elements(wxs, "Custom").filter(c => attr(c, "Action") === "DetectCpu");
    expect(customs).toHaveLength(2);
    for (const c of customs) {
      expect(attr(c, "After")).toBe("AppSearch");
      expect(attr(c, "Condition")).toBe("NOT BUNVARIANT");
    }

    // No script custom actions at all: VBScript/JScript are optional
    // components on Win11 24H2+ and are routinely GPO-blocked on the
    // enterprise fleets MSI deployment targets.
    for (const any of elements(wxs, "CustomAction")) {
      expect(attr(any, "Script")).toBeUndefined();
    }
    expect(stripXmlTrivia(wxs)).not.toMatch(/\bScript\s*=\s*"(vbscript|jscript)"/i);
  });

  test("rejects an unrecognised BUNVARIANT before touching the machine", () => {
    // LaunchConditions runs after AppSearch + DetectCpu, so by the time
    // it fires BUNVARIANT is always one of the three valid strings unless
    // the user supplied something else on the command line. An invalid
    // value must abort rather than produce a "successful" install with
    // PATH/BUN_INSTALL set and no bun.exe on disk.
    const launches = elements(wxs, "Launch");
    const guard = launches.find(l => (attr(l, "Condition") ?? "").includes("BUNVARIANT"));
    expect(guard).toBeDefined();
    const cond = attr(guard, "Condition")!;
    expect(cond).toContain("Installed OR"); // let repair/uninstall through
    for (const v of ["x64", "x64-baseline", "arm64"]) {
      expect(cond).toContain(`BUNVARIANT = &quot;${v}&quot;`);
    }
    expect(attr(guard, "Message")).toContain("x64, x64-baseline, arm64");
  });

  test("installs under ProgramFiles64\\Bun\\bin and appends it to system PATH", () => {
    const pf = elements(wxs, "StandardDirectory")[0];
    expect(attr(pf, "Id")).toBe("ProgramFiles64Folder");
    expect(attr(findBy(wxs, "Directory", "Id", "INSTALLFOLDER"), "Name")).toBe("Bun");
    expect(attr(findBy(wxs, "Directory", "Id", "BunBinFolder"), "Name")).toBe("bin");

    const env = findBy(wxs, "Environment", "Name", "PATH");
    expect({
      Action: attr(env, "Action"),
      Part: attr(env, "Part"),
      System: attr(env, "System"),
      Permanent: attr(env, "Permanent"),
      Value: attr(env, "Value"),
    }).toEqual({ Action: "set", Part: "last", System: "yes", Permanent: "no", Value: "[BunBinFolder]" });

    const bi = findBy(wxs, "Environment", "Name", "BUN_INSTALL");
    expect(attr(bi, "Value")).toBe("[INSTALLFOLDER]");
  });

  test("gates on Windows 10 1809 / build 17763 like install.ps1", () => {
    const launch = elements(wxs, "Launch").find(l => (attr(l, "Condition") ?? "").includes("WINDOWSBUILDNUMBER"));
    expect(attr(launch, "Condition")).toContain("WINDOWSBUILDNUMBER &gt;= 17763");

    const installPs1 = readFileSync(join(repoRoot, "src", "cli", "install.ps1"), "utf8");
    expect(installPs1).toMatch(/\$MinBuild\s*=\s*17763/);
  });

  test("exposes INSTALLFOLDER / BUNVARIANT / ADDTOPATH / SETBUNINSTALL as Secure public properties", () => {
    for (const id of ["INSTALLFOLDER", "BUNVARIANT", "ADDTOPATH", "SETBUNINSTALL"]) {
      const p = findBy(wxs, "Property", "Id", id);
      expect(attr(p, "Secure")).toBe("yes");
    }
    // WINDOWSBUILDNUMBER must *not* be Secure — it's read-only OS
    // introspection and marking it Secure would let a command-line
    // override pre-empt the RegistrySearch and bypass the min-build gate.
    expect(attr(findBy(wxs, "Property", "Id", "WINDOWSBUILDNUMBER"), "Secure")).toBeUndefined();

    const levelToggles = elements(wxs, "Level").map(l => ({
      Value: attr(l, "Value"),
      Condition: attr(l, "Condition"),
    }));
    expect(levelToggles).toEqual([
      { Value: "0", Condition: "ADDTOPATH = &quot;0&quot;" },
      { Value: "0", Condition: "SETBUNINSTALL = &quot;0&quot;" },
    ]);
  });

  test("writes HKLM\\Software\\Oven\\Bun including the detected Variant", () => {
    const key = elements(wxs, "RegistryKey")[0];
    expect({ Root: attr(key, "Root"), Key: attr(key, "Key") }).toEqual({
      Root: "HKLM",
      Key: "Software\\Oven\\Bun",
    });
    const valueNames = elements(wxs, "RegistryValue")
      .filter(v => attr(v, "Name") && !attr(v, "Name")?.endsWith("Installed") && !attr(v, "Name")?.endsWith("Set"))
      .map(v => attr(v, "Name"))
      .sort();
    expect(valueNames).toEqual(["BinDir", "InstallRoot", "Variant", "Version"]);
    expect(attr(findBy(wxs, "RegistryValue", "Name", "Variant"), "Value")).toBe("[BUNVARIANT]");
  });

  test("wires the branded UI bitmaps and ARP icon", () => {
    const vars = Object.fromEntries(elements(wxs, "WixVariable").map(v => [attr(v, "Id"), attr(v, "Value")]));
    expect(vars).toEqual({
      WixUIBannerBmp: "$(BunBannerBmp)",
      WixUIDialogBmp: "$(BunDialogBmp)",
      WixUILicenseRtf: "$(BunLicense)",
    });
    expect(attr(elements(wxs, "ui:WixUI")[0], "Id")).toBe("WixUI_InstallDir");
    expect(attr(elements(wxs, "Icon")[0], "SourceFile")).toBe("$(BunIcon)");
    expect(attr(findBy(wxs, "Property", "Id", "ARPPRODUCTICON"), "Value")).toBe("BunIcon");
    expect(attr(findBy(wxs, "Property", "Id", "ARPURLINFOABOUT"), "Value")).toBe("https://bun.com");
    expect(attr(findBy(wxs, "Property", "Id", "WIXUI_EXITDIALOGOPTIONALTEXT"), "Value")).toContain("bun --version");
  });
});

describe("packages/bun-msi/detect-cpu.c", () => {
  const c = readFileSync(join(msiDir, "detect-cpu.c"), "utf8");

  test("sets BUNVARIANT from IsWow64Process2 + IsProcessorFeaturePresent", () => {
    // Exported entry point the .wxs DllEntry references.
    expect(c).toMatch(/__declspec\(dllexport\)\s+UINT\s+__stdcall\s+DetectCpu\s*\(\s*MSIHANDLE/);
    // Native-machine detection that sees through x64-on-ARM64 emulation.
    expect(c).toContain("IsWow64Process2");
    expect(c).toContain("IMAGE_FILE_MACHINE_ARM64");
    // AVX2 probe — same feature index install.ps1 P/Invokes.
    expect(c).toMatch(/IsProcessorFeaturePresent\s*\(\s*PF_AVX2_INSTRUCTIONS_AVAILABLE\s*\)/);
    expect(c).toContain("#define PF_AVX2_INSTRUCTIONS_AVAILABLE 40");
    // All three outcomes and the property they set.
    expect(c).toContain('L"BUNVARIANT"');
    for (const v of ['L"arm64"', 'L"x64"', 'L"x64-baseline"']) expect(c).toContain(v);
    // Default is the runs-everywhere variant so a detection failure
    // never leaves the user with an illegal-instruction crash.
    expect(c).toMatch(/variant\s*=\s*L"x64-baseline";\s*\/\/\s*safest default/);
    // Respect an explicit override before probing.
    expect(c).toContain("MsiGetPropertyW");
  });

  test("stays in sync with install.ps1's AVX2 feature index", () => {
    const installPs1 = readFileSync(join(repoRoot, "src", "cli", "install.ps1"), "utf8");
    expect(installPs1).toMatch(/IsProcessorFeaturePresent\(40\)/);
  });
});

describe("packages/bun-msi/build-msi.ps1", () => {
  const ps1 = readFileSync(join(msiDir, "build-msi.ps1"), "utf8");

  test("declares the three payload parameters", () => {
    for (const p of ["$BunExeX64", "$BunExeX64Baseline", "$BunExeArm64", "$Version", "$Output"]) {
      expect(ps1).toContain(p);
    }
  });

  test("compiles detect-cpu.c with MSVC and checks the exit code", () => {
    expect(ps1).toContain("detect-cpu.c");
    expect(ps1).toMatch(/\bcl\b[^\n]*\/LD\b/);
    expect(ps1).toContain("msi.lib");
    expect(ps1).toMatch(/if\s*\(\s*\$LASTEXITCODE\s*-ne\s*0\s*\)\s*\{\s*throw\s*"cl failed/);
    // vswhere fallback so it works on a bare windows-latest runner.
    expect(ps1).toContain("vswhere.exe");
    expect(ps1).toContain("vcvars64.bat");
  });

  test("escapes non-ASCII license text as RTF \\uN keywords", () => {
    expect(ps1).toMatch(/\\u.*\$cp/);
    expect(ps1).toContain("if ($cp -gt 32767) { $cp -= 65536 }");
    expect(ps1).toContain("\\ansicpg1252");
    expect(ps1).not.toMatch(/Set-Content[^\n]*-Encoding\s+ASCII/);
  });

  test("renders both WixUI bitmaps from src/bun.ico in Bun brand colours", () => {
    expect(ps1).toMatch(/New-BunBitmap\s+-Width\s+493\s+-Height\s+312\b/);
    expect(ps1).toMatch(/New-BunBitmap\s+-Width\s+493\s+-Height\s+58\b/);
    expect(ps1).toContain("System.Drawing");
    expect(ps1).toContain("src\\bun.ico");
    // Match the FromArgb channel values themselves, not the inline
    // `# #fbf0df` comment — a palette edit that updated the bytes but
    // left the comment would otherwise pass silently.
    expect(ps1).toMatch(/FromArgb\(0xFB,\s*0xF0,\s*0xDF\)/); // #fbf0df
    expect(ps1).toMatch(/FromArgb\(0xF6,\s*0xDE,\s*0xCE\)/); // #f6dece
  });

  test("invokes wix build -arch x64 with every preprocessor var bun.wxs consumes", () => {
    const wxs = readFileSync(join(msiDir, "bun.wxs"), "utf8");
    const referenced = new Set([...stripXmlTrivia(wxs).matchAll(/\$\(((?:Bun|DetectCpu)\w*)\)/g)].map(m => m[1]));
    expect([...referenced].sort()).toEqual(
      [
        "BunBannerBmp",
        "BunDialogBmp",
        "BunExeArm64",
        "BunExeX64",
        "BunExeX64Baseline",
        "BunIcon",
        "BunLicense",
        "BunVersion",
        "DetectCpuDll",
      ].sort(),
    );
    for (const d of referenced) {
      expect(ps1).toContain(`-d "${d}=`);
    }
    expect(ps1).toContain("WixToolset.UI.wixext");
    // Always x64 — ARM64 Windows 11 runs it under emulation and
    // IsWow64Process2 sees through to the native machine.
    expect(ps1).toMatch(/-arch\s+x64\b/);
    expect(ps1).not.toMatch(/-arch\s+\$Arch\b/);
  });
});

describe(".github/workflows/release.yml msi job", () => {
  const yml = readFileSync(join(repoRoot, ".github", "workflows", "release.yml"), "utf8");
  // Pull just the `msi:` job block so assertions don't accidentally match
  // other jobs in the file. Jobs are 2-space-indented keys; the block ends
  // at the next 2-space key or EOF.
  const m = yml.match(/\n {2}msi:\n([\s\S]*?)(?=\n {2}\S|\s*$)/);
  const job = m ? m[0] : "";

  test("job exists, runs on windows-latest after sign, and is dispatch-gated", () => {
    expect(job).not.toBe("");
    expect(job).toMatch(/\bruns-on:\s*windows-latest\b/);
    expect(job).toMatch(/\bneeds:\s*sign\b/);
    expect(job).toContain("github.event_name != 'workflow_dispatch' || github.event.inputs.use-msi == 'true'");
    expect(yml).toMatch(/\n {6}use-msi:\n/);
    expect(job).toMatch(/permissions:\s*\n\s*contents:\s*write/);
  });

  test("downloads all three zips and builds a single bun-windows.msi", () => {
    for (const t of ["bun-windows-x64", "bun-windows-x64-baseline", "bun-windows-aarch64"]) {
      expect(job).toContain(t);
    }
    expect(job).toContain("gh release download");
    expect(job).toContain("packages\\bun-msi\\build-msi.ps1");
    for (const p of ["-BunExeX64", "-BunExeX64Baseline", "-BunExeArm64", "-Version", "-Output"]) {
      expect(job).toContain(p);
    }
    expect(job).toContain("gh release upload");
    expect(job).toContain('"bun-windows.msi"');
    // No per-target matrix — it's one universal installer now.
    expect(job).not.toMatch(/\bmatrix:\s*\n/);
  });
});
