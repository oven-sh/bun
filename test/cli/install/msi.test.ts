// Validates the Windows MSI packaging sources. These run on every platform
// because the .wxs/.ps1 files are plain text; an actual `wix build` only
// happens on Windows CI in the `windows-msi` Buildkite step.

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
    // that at build time on the windows-msi agent — but it stops
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

  test("Package metadata is wired to preprocessor vars", () => {
    const pkg = elements(wxs, "Package")[0];
    expect({
      Name: attr(pkg, "Name"),
      Manufacturer: attr(pkg, "Manufacturer"),
      Scope: attr(pkg, "Scope"),
      Version: attr(pkg, "Version"),
      UpgradeCode: attr(pkg, "UpgradeCode"),
      Compressed: attr(pkg, "Compressed"),
    }).toEqual({
      Name: "Bun",
      Manufacturer: "Oven",
      Scope: "perMachine",
      Version: "$(BunVersion)",
      UpgradeCode: "$(BunUpgradeCode)",
      Compressed: "yes",
    });
  });

  test("installs bun.exe and bunx.exe under ProgramFiles64\\Bun\\bin", () => {
    const pf = elements(wxs, "StandardDirectory")[0];
    expect(attr(pf, "Id")).toBe("ProgramFiles64Folder");

    const installDir = findBy(wxs, "Directory", "Id", "INSTALLFOLDER");
    expect(attr(installDir, "Name")).toBe("Bun");
    const binDir = findBy(wxs, "Directory", "Id", "BunBinFolder");
    expect(attr(binDir, "Name")).toBe("bin");

    const group = elements(wxs, "ComponentGroup")[0];
    expect(attr(group, "Id")).toBe("BunFiles");
    expect(attr(group, "Directory")).toBe("BunBinFolder");

    const fileNames = elements(wxs, "File")
      .map(f => attr(f, "Name"))
      .sort();
    expect(fileNames).toEqual(["bun.exe", "bunx.exe"]);
  });

  test("appends the bin folder to system PATH", () => {
    const env = findBy(wxs, "Environment", "Name", "PATH");
    expect({
      Action: attr(env, "Action"),
      Part: attr(env, "Part"),
      System: attr(env, "System"),
      Permanent: attr(env, "Permanent"),
      Value: attr(env, "Value"),
    }).toEqual({
      Action: "set",
      Part: "last",
      System: "yes",
      Permanent: "no",
      Value: "[BunBinFolder]",
    });
  });

  test("sets BUN_INSTALL from INSTALLFOLDER without a script CA", () => {
    const env = findBy(wxs, "Environment", "Name", "BUN_INSTALL");
    expect({
      Action: attr(env, "Action"),
      Part: attr(env, "Part"),
      System: attr(env, "System"),
      Permanent: attr(env, "Permanent"),
      Value: attr(env, "Value"),
    }).toEqual({
      Action: "set",
      Part: "all",
      System: "yes",
      Permanent: "no",
      Value: "[INSTALLFOLDER]",
    });

    // No script custom actions at all: VBScript/JScript are optional
    // components on Win11 24H2+ and are routinely GPO-blocked on the
    // enterprise fleets MSI deployment targets. A script CA here would
    // turn a cosmetic trailing '\' into a hard 1603/1721 install failure.
    const body = stripXmlTrivia(wxs);
    for (const ca of elements(body, "CustomAction")) {
      expect(attr(ca, "Script")).toBeUndefined();
      expect(attr(ca, "VBScriptCall")).toBeUndefined();
      expect(attr(ca, "JScriptCall")).toBeUndefined();
    }
    expect(body).not.toMatch(/\bScript\s*=\s*"(vbscript|jscript)"/i);
  });

  test("gates on Windows 10 1809 / build 17763 like install.ps1", () => {
    const launch = elements(wxs, "Launch")[0];
    expect(attr(launch, "Condition")).toContain("WINDOWSBUILDNUMBER &gt;= 17763");

    const installPs1 = readFileSync(join(repoRoot, "src", "cli", "install.ps1"), "utf8");
    expect(installPs1).toMatch(/\$MinBuild\s*=\s*17763/);
  });

  test("wires the branded UI bitmaps and ARP icon", () => {
    const vars = Object.fromEntries(elements(wxs, "WixVariable").map(v => [attr(v, "Id"), attr(v, "Value")]));
    expect(vars).toEqual({
      WixUIBannerBmp: "$(BunBannerBmp)",
      WixUIDialogBmp: "$(BunDialogBmp)",
      WixUILicenseRtf: "$(BunLicense)",
    });

    const ui = elements(wxs, "ui:WixUI")[0];
    expect(attr(ui, "Id")).toBe("WixUI_InstallDir");
    expect(attr(ui, "InstallDirectory")).toBe("INSTALLFOLDER");

    expect(attr(elements(wxs, "Icon")[0], "SourceFile")).toBe("$(BunIcon)");
    const arpIcon = findBy(wxs, "Property", "Id", "ARPPRODUCTICON");
    expect(attr(arpIcon, "Value")).toBe("BunIcon");
    const arpUrl = findBy(wxs, "Property", "Id", "ARPURLINFOABOUT");
    expect(attr(arpUrl, "Value")).toBe("https://bun.com");

    const exitText = findBy(wxs, "Property", "Id", "WIXUI_EXITDIALOGOPTIONALTEXT");
    expect(attr(exitText, "Value")).toContain("bun --version");
  });

  test("exposes INSTALLFOLDER / ADDTOPATH / SETBUNINSTALL as Secure public properties", () => {
    // INSTALLFOLDER comes from the <Directory> element but a command-line
    // override must still survive the client->elevated-service hop on a
    // per-machine install, so it needs to be in SecureCustomProperties.
    const installFolder = findBy(wxs, "Property", "Id", "INSTALLFOLDER");
    expect(attr(installFolder, "Secure")).toBe("yes");
    expect(attr(installFolder, "Value")).toBeUndefined(); // defined by Directory, not here

    const addToPath = findBy(wxs, "Property", "Id", "ADDTOPATH");
    expect({ Value: attr(addToPath, "Value"), Secure: attr(addToPath, "Secure") }).toEqual({
      Value: "1",
      Secure: "yes",
    });
    const setBunInstall = findBy(wxs, "Property", "Id", "SETBUNINSTALL");
    expect({ Value: attr(setBunInstall, "Value"), Secure: attr(setBunInstall, "Secure") }).toEqual({
      Value: "1",
      Secure: "yes",
    });

    // Each is wired to a sub-feature that disables at Level 0 when the
    // property is "0", so `msiexec /i ... ADDTOPATH=0` actually skips it.
    const pathFeature = findBy(wxs, "Feature", "Id", "PathEnv");
    expect(attr(pathFeature, "Level")).toBe("1");
    const envFeature = findBy(wxs, "Feature", "Id", "BunInstallEnv");
    expect(attr(envFeature, "Level")).toBe("1");

    const levelToggles = elements(wxs, "Level").map(l => ({
      Value: attr(l, "Value"),
      Condition: attr(l, "Condition"),
    }));
    expect(levelToggles).toEqual([
      { Value: "0", Condition: "ADDTOPATH = &quot;0&quot;" },
      { Value: "0", Condition: "SETBUNINSTALL = &quot;0&quot;" },
    ]);
  });

  test("writes HKLM\\Software\\Oven\\Bun for fleet inventory", () => {
    const key = elements(wxs, "RegistryKey")[0];
    expect({ Root: attr(key, "Root"), Key: attr(key, "Key") }).toEqual({
      Root: "HKLM",
      Key: "Software\\Oven\\Bun",
    });
    const valueNames = elements(wxs, "RegistryValue")
      .filter(v => attr(v, "Name") && !attr(v, "Name")?.endsWith("Installed") && !attr(v, "Name")?.endsWith("Set"))
      .map(v => attr(v, "Name"))
      .sort();
    expect(valueNames).toEqual(["BinDir", "InstallRoot", "Version"]);
  });

  test("defines MajorUpgrade and distinct per-arch UpgradeCodes", () => {
    const mu = elements(wxs, "MajorUpgrade")[0];
    expect(attr(mu, "AllowSameVersionUpgrades")).toBe("yes");
    expect(attr(mu, "DowngradeErrorMessage")).toContain("newer version of Bun");

    const guids = [...wxs.matchAll(/BunUpgradeCode\s*=\s*"([0-9a-f-]{36})"/gi)].map(m => m[1].toLowerCase());
    expect(guids).toHaveLength(2);
    expect(new Set(guids).size).toBe(2);
    for (const g of guids) {
      expect(g).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});

describe("packages/bun-msi/build-msi.ps1", () => {
  const ps1 = readFileSync(join(msiDir, "build-msi.ps1"), "utf8");

  test("escapes non-ASCII license text as RTF \\uN keywords", () => {
    // LICENSE.md contains smart quotes (U+2019). The naive approach of
    // dumping it as ASCII would mojibake them in the RichEdit control;
    // the script must emit \uN? so the stream stays 7-bit.
    expect(ps1).toMatch(/\\u.*\$cp/);
    expect(ps1).toContain("if ($cp -gt 32767) { $cp -= 65536 }");
    expect(ps1).toContain("\\ansicpg1252");
    // And must not be writing the raw body with an ASCII-lossy Set-Content.
    expect(ps1).not.toMatch(/Set-Content[^\n]*-Encoding\s+ASCII/);
  });

  test("declares the documented parameters", () => {
    expect(ps1).toMatch(/\[ValidateSet\("x64",\s*"arm64"\)\]\s*\r?\n\s*\[string\]\$Arch/);
    for (const p of ["$BunExe", "$Arch", "$Version", "$Output"]) {
      expect(ps1).toContain(p);
    }
  });

  test("renders both WixUI bitmaps from src/bun.ico in Bun brand colours", () => {
    expect(ps1).toMatch(/New-BunBitmap\s+-Width\s+493\s+-Height\s+312\b/);
    expect(ps1).toMatch(/New-BunBitmap\s+-Width\s+493\s+-Height\s+58\b/);
    expect(ps1).toContain("System.Drawing");
    expect(ps1).toContain("src\\bun.ico");
    // Brand gradient stops are literal so a palette drift on bun.com
    // doesn't silently change the installer.
    expect(ps1).toContain("#fbf0df");
    expect(ps1).toContain("#f6dece");
  });

  test("invokes wix build with every preprocessor var bun.wxs consumes", () => {
    const wxs = readFileSync(join(msiDir, "bun.wxs"), "utf8");
    const referenced = new Set([...wxs.matchAll(/\$\((Bun\w+)\)/g)].map(m => m[1]));
    // Derived preprocessor vars defined inside the .wxs don't come from -d.
    referenced.delete("BunUpgradeCode");
    expect([...referenced].sort()).toEqual(
      ["BunArch", "BunBannerBmp", "BunDialogBmp", "BunExe", "BunIcon", "BunLicense", "BunVersion", "BunxExe"].sort(),
    );
    for (const d of referenced) {
      expect(ps1).toContain(`-d "${d}=`);
    }
    expect(ps1).toContain("WixToolset.UI.wixext");
    expect(ps1).toContain("-arch $Arch");
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
    // Same gate shape as npm/docker/etc.: automatic on release/schedule,
    // opt-in on workflow_dispatch via the use-msi input.
    expect(job).toContain("github.event_name != 'workflow_dispatch' || github.event.inputs.use-msi == 'true'");
    expect(yml).toMatch(/\n {6}use-msi:\n/);
  });

  test("matrix covers every Windows release target with the right WiX arch", () => {
    const rows = [...job.matchAll(/-\s*target:\s*(\S+)\s*\n\s*arch:\s*(\S+)/g)].map(m => ({
      target: m[1],
      arch: m[2],
    }));
    expect(rows).toEqual([
      { target: "bun-windows-x64", arch: "x64" },
      { target: "bun-windows-x64-baseline", arch: "x64" },
      { target: "bun-windows-aarch64", arch: "arm64" },
    ]);
  });

  test("downloads the release zip, builds with build-msi.ps1, and uploads the MSI", () => {
    expect(job).toContain("gh release download");
    expect(job).toContain('"${{ matrix.target }}.zip"');
    expect(job).toContain("packages\\bun-msi\\build-msi.ps1");
    for (const p of ["-BunExe", "-Arch", "-Version", "-Output"]) {
      expect(job).toContain(p);
    }
    expect(job).toContain("gh release upload");
    expect(job).toContain('"${{ matrix.target }}.msi"');
    // contents: write is required for gh release upload.
    expect(job).toMatch(/permissions:\s*\n\s*contents:\s*write/);
  });
});
